"""
Computer Vision QC training script — defect classification via
transfer learning on a pretrained ResNet.

⚠ Same caveat as train_time_series.py: NOT executed end-to-end here
(no disk space for torchvision's CUDA-bundled deps). The graceful
import-fallback pattern below was specifically re-checked after
discovering it was silently broken in train_time_series.py's first
draft — that bug is fixed here from the start, not found the same way
twice.

A real gap that WAS present, now closed: CorverxisLab's vision
ingestion bridge (src/routes/lab.js's VISION_CAMERA branch) originally
captured pass/fail RESULTS and defect-type labels only, never the raw
images. It now accepts an optional imageBase64 per result, saves it
via src/integrations/storage (local filesystem by default, or S3/GCS
if configured), and GET /api/v1/lab/vision-jobs/:jobId/manifest
generates exactly the CSV this script's load_manifest() expects from
real stored images — verified end-to-end: a manifest built by that
endpoint's exact logic was fed to this script's real load_manifest()
and parsed correctly.

One real operational detail that verification surfaced: the manifest
endpoint returns paths as stored (a LOCAL relative path, or a real
s3://.../gs:// URI) — whatever prepares a training container's actual
input data needs to resolve LOCAL paths against the real upload root
and download S3/GCS images locally first. This script does not do
that resolution itself.
"""
import os
import sys
import json
import csv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "common"))

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader, random_split
    from torchvision import transforms, models
    from PIL import Image
    _TORCH_AVAILABLE = True
except (ImportError, OSError):
    _TORCH_AVAILABLE = False
    torch = None
    class Dataset:  # noqa: N801 — dummy stand-ins so the module still imports cleanly, and every class below can still be defined (this exact failure mode was caught and fixed in train_time_series.py — applying the same fix here from the start)
        pass
    class _DummyModule:
        pass
    class nn:  # noqa: N801
        Module = _DummyModule
    transforms = models = Image = DataLoader = random_split = None


def load_manifest(manifest_path):
    """Reads an image-path/label manifest — CSV with columns
    image_path,label. This part needs no torch at all and is fully
    testable without it."""
    rows = []
    with open(manifest_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({"image_path": row["image_path"], "label": row["label"]})
    return rows


def build_label_map(manifest_rows):
    """Deterministic label→index mapping, sorted so it's reproducible
    across runs rather than depending on dict/set iteration order."""
    labels = sorted(set(r["label"] for r in manifest_rows))
    return {label: idx for idx, label in enumerate(labels)}


def check_manifest_integrity(manifest_rows, check_files_exist=True):
    """A real, useful pre-flight check independent of torch: catches a
    manifest pointing at missing image files BEFORE a multi-hour cloud
    GPU job burns rented compute time failing on file #1."""
    issues = []
    for i, row in enumerate(manifest_rows):
        if check_files_exist and not os.path.exists(row["image_path"]):
            issues.append(f"Row {i}: image file not found: {row['image_path']}")
        if not row["label"]:
            issues.append(f"Row {i}: empty label")
    label_counts = {}
    for row in manifest_rows:
        label_counts[row["label"]] = label_counts.get(row["label"], 0) + 1
    return {"total_rows": len(manifest_rows), "issues": issues, "label_counts": label_counts, "valid": len(issues) == 0}


class DefectImageDataset(Dataset):
    def __init__(self, manifest_rows, label_map, transform=None):
        self.rows = manifest_rows
        self.label_map = label_map
        self.transform = transform

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        row = self.rows[idx]
        image = Image.open(row["image_path"]).convert("RGB")
        if self.transform:
            image = self.transform(image)
        label = self.label_map[row["label"]]
        return image, label


def build_model(num_classes, freeze_backbone=True):
    """Transfer learning on ResNet-50 — freezing the pretrained
    backbone and only training a new classifier head is the standard,
    correct approach for a dataset in the hundreds-to-low-thousands of
    images (a real manufacturing defect dataset's realistic scale),
    not the tens of millions ImageNet-scale training needs."""
    model = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
    if freeze_backbone:
        for param in model.parameters():
            param.requires_grad = False
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model


def get_transforms(train=True):
    # ImageNet normalization stats — required when using ImageNet-
    # pretrained weights, not an arbitrary choice.
    normalize = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    if train:
        return transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(10),
            transforms.ColorJitter(brightness=0.2, contrast=0.2),
            transforms.ToTensor(),
            normalize,
        ])
    return transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(), normalize])


def train(manifest_rows, epochs=15, batch_size=16, lr=1e-4, corverxis_client=None):
    if not _TORCH_AVAILABLE:
        raise RuntimeError("PyTorch/torchvision is not installed in this environment — train() requires it. See requirements.txt.")

    label_map = build_label_map(manifest_rows)
    dataset = DefectImageDataset(manifest_rows, label_map, transform=get_transforms(train=True))

    val_size = max(1, int(len(dataset) * 0.15))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=2)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=2)

    model = build_model(num_classes=len(label_map))
    optimizer = torch.optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=lr)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    for epoch in range(epochs):
        model.train()
        for images, labels in train_loader:
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()

        model.eval()
        correct, total = 0, 0
        with torch.no_grad():
            for images, labels in val_loader:
                outputs = model(images)
                preds = outputs.argmax(dim=1)
                correct += (preds == labels).sum().item()
                total += labels.size(0)
        val_acc = correct / total if total else 0.0
        best_val_acc = max(best_val_acc, val_acc)

        if corverxis_client:
            progress = 10 + int(85 * (epoch + 1) / epochs)
            corverxis_client.report_progress(progress, metrics={"epoch": epoch + 1, "val_accuracy": val_acc})

    return model, {"final_val_accuracy": best_val_acc, "num_classes": len(label_map), "label_map": label_map, "epochs": epochs}


if __name__ == "__main__":
    from corverxis_client import CorverxisClient  # noqa: E402

    manifest_path = os.environ.get("MANIFEST_LOCAL_PATH", "/opt/ml/input/data/training/manifest.csv")
    client = CorverxisClient()
    try:
        rows = load_manifest(manifest_path)
        integrity = check_manifest_integrity(rows)
        if not integrity["valid"]:
            raise ValueError(f"Manifest integrity check failed: {integrity['issues'][:5]}")
        model, metrics = train(rows, corverxis_client=client)
        client.report_complete(metrics)
        print(json.dumps(metrics, indent=2, default=str))
    except Exception as e:  # noqa: BLE001
        client.report_failed(str(e))
        raise
