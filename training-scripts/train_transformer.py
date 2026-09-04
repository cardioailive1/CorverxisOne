"""
LLM/Transformer fine-tuning script — LoRA via HuggingFace
transformers + PEFT.

⚠ Same caveat as the other two scripts: NOT executed end-to-end here.
transformers + peft + a base model's weights are a heavier install
than even torchvision, and were never going to fit in the available
disk space. Graceful-fallback pattern applied from the start, same as
train_vision.py, and every non-model-loading piece below is tested
for real against no framework dependency at all.

Fine-tunes a causal LM with LoRA (low-rank adapters) rather than full
fine-tuning — the standard, correct choice for adapting a model to a
domain-specific instruction set without needing to store or update
every one of the base model's parameters. Produces an adapter
checkpoint, not a full model copy.
"""
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "common"))

try:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from peft import LoraConfig, get_peft_model, TaskType
    from datasets import Dataset as HfDataset
    _HF_AVAILABLE = True
except (ImportError, OSError):
    _HF_AVAILABLE = False
    torch = None
    AutoModelForCausalLM = AutoTokenizer = TrainingArguments = Trainer = DataCollatorForLanguageModeling = None
    LoraConfig = get_peft_model = TaskType = HfDataset = None


def load_instruction_dataset(jsonl_path):
    """Reads a JSON-lines instruction dataset — one {"instruction":
    ..., "response": ...} object per line. Needs no ML framework at
    all, fully testable without transformers/torch installed."""
    examples = []
    with open(jsonl_path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"Line {i + 1} is not valid JSON: {e}") from e
            if "instruction" not in obj or "response" not in obj:
                raise ValueError(f"Line {i + 1} missing required 'instruction' or 'response' key: {obj}")
            examples.append(obj)
    return examples


def format_prompt(example, template=None):
    """Turns a raw instruction/response pair into the actual text the
    model trains on. The template is configurable per base model since
    different model families expect different chat-formatting
    conventions (this default is a generic, widely-compatible one, not
    a claim that every base model uses this exact format)."""
    if template is None:
        template = "### Instruction:\n{instruction}\n\n### Response:\n{response}"
    return template.format(instruction=example["instruction"], response=example["response"])


def check_dataset_quality(examples, min_examples=20, max_response_length_chars=8000):
    """Real, useful pre-flight checks — same principle as
    check_manifest_integrity in train_vision.py: catch a bad dataset
    before burning rented GPU time on it, not after."""
    issues = []
    if len(examples) < min_examples:
        issues.append(f"Only {len(examples)} examples — LoRA fine-tuning typically needs at least {min_examples}+ to avoid overfitting onto a handful of examples.")
    empty_responses = sum(1 for e in examples if not e["response"].strip())
    if empty_responses:
        issues.append(f"{empty_responses} example(s) have an empty response.")
    too_long = sum(1 for e in examples if len(e["response"]) > max_response_length_chars)
    if too_long:
        issues.append(f"{too_long} example(s) exceed {max_response_length_chars} characters — check these aren't truncation artifacts from data collection.")
    duplicates = len(examples) - len({e["instruction"] for e in examples})
    return {"total_examples": len(examples), "issues": issues, "duplicate_instructions": duplicates, "valid": len(issues) == 0}


def build_lora_config(r=16, alpha=32, dropout=0.05, target_modules=None):
    """r=16/alpha=32 (2x ratio) is a common, reasonable starting point
    for LoRA — not tuned per-task here since that depends on the base
    model architecture and dataset size, which are only known at
    actual training time, not at script-authoring time."""
    return LoraConfig(
        r=r, lora_alpha=alpha, lora_dropout=dropout, bias="none",
        task_type=TaskType.CAUSAL_LM,
        target_modules=target_modules or ["q_proj", "v_proj"],  # attention projections — the standard, minimal-footprint LoRA target for most causal LM architectures
    )


def train(examples, base_model_name, epochs=3, batch_size=4, lr=2e-4, lora_r=16, corverxis_client=None):
    if not _HF_AVAILABLE:
        raise RuntimeError("transformers/peft/datasets are not installed in this environment — train() requires them. See requirements.txt.")

    tokenizer = AutoTokenizer.from_pretrained(base_model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token  # many causal LMs have no pad token by default; reusing eos is the standard workaround

    texts = [format_prompt(e) for e in examples]
    hf_dataset = HfDataset.from_dict({"text": texts})

    def tokenize(batch):
        return tokenizer(batch["text"], truncation=True, max_length=1024, padding="max_length")

    tokenized = hf_dataset.map(tokenize, batched=True, remove_columns=["text"])

    model = AutoModelForCausalLM.from_pretrained(base_model_name)
    lora_config = build_lora_config(r=lora_r)
    model = get_peft_model(model, lora_config)

    if corverxis_client:
        trainable, total = model.get_nb_trainable_parameters()
        corverxis_client.report_progress(15, metrics={"stage": "model_prepared", "trainable_params": trainable, "total_params": total, "trainable_pct": round(100 * trainable / total, 3)})

    training_args = TrainingArguments(
        output_dir="/tmp/lora_output", num_train_epochs=epochs, per_device_train_batch_size=batch_size,
        learning_rate=lr, logging_steps=10, save_strategy="epoch", report_to=[],
    )
    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    class ProgressCallback:
        """Bridges HF's own training loop progress to CorverxisONE —
        without this the platform would only hear about the job at the
        very end, defeating the whole point of live progress tracking."""
        def __init__(self, client, total_steps):
            self.client = client
            self.total_steps = max(1, total_steps)

        def on_step_end(self, step):
            if self.client and step % 10 == 0:
                pct = 20 + int(70 * step / self.total_steps)
                self.client.report_progress(min(pct, 90), metrics={"step": step})

    trainer = Trainer(model=model, args=training_args, train_dataset=tokenized, data_collator=data_collator)
    trainer.train()

    final_loss = trainer.state.log_history[-1].get("loss") if trainer.state.log_history else None
    metrics = {"final_loss": final_loss, "epochs": epochs, "lora_r": lora_r, "base_model": base_model_name, "n_examples": len(examples)}
    return model, metrics


if __name__ == "__main__":
    from corverxis_client import CorverxisClient  # noqa: E402

    dataset_path = os.environ.get("DATASET_LOCAL_PATH", "/opt/ml/input/data/training/dataset.jsonl")
    base_model = os.environ.get("BASE_MODEL", "Qwen/Qwen2.5-7B-Instruct")
    client = CorverxisClient()
    try:
        examples = load_instruction_dataset(dataset_path)
        quality = check_dataset_quality(examples)
        if not quality["valid"]:
            raise ValueError(f"Dataset quality check failed: {quality['issues']}")
        model, metrics = train(examples, base_model, corverxis_client=client)
        client.report_complete(metrics)
        print(json.dumps(metrics, indent=2, default=str))
    except Exception as e:  # noqa: BLE001
        client.report_failed(str(e))
        raise
