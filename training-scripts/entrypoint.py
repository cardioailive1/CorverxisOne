#!/usr/bin/env python3
"""
Container entrypoint — this is what actually runs when a job lands on
AWS SageMaker / GCP Vertex AI / RunPod. Dispatches to the right
training script based on MODEL_TYPE, which the connectors
(src/integrations/training/*.js) inject as an environment variable at
job submission (see each connector's submitTrainingJob).
"""
import os
import sys

MODEL_TYPE = os.environ.get("MODEL_TYPE", "").upper()

DISPATCH = {
    "CLASSICAL_ML": "train_classical_ml",
    "TIME_SERIES": "train_time_series",
    "VISION": "train_vision",
    "LLM": "train_transformer",
}

if __name__ == "__main__":
    script_module = DISPATCH.get(MODEL_TYPE)
    if not script_module:
        print(f"FATAL: Unknown or missing MODEL_TYPE '{MODEL_TYPE}'. Expected one of: {list(DISPATCH.keys())}", file=sys.stderr)
        sys.exit(1)

    print(f"Dispatching to {script_module}.py for MODEL_TYPE={MODEL_TYPE}")
    # Runs the target script's own __main__ block, which is where each
    # script's real entrypoint logic (load data, train, report back)
    # actually lives — this file is purely a router, not duplicate logic.
    import runpy
    runpy.run_module(script_module, run_name="__main__")
