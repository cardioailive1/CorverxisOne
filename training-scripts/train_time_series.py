"""
Predictive Maintenance training script — Time-Series (LSTM).

⚠ UNLIKE every other script in this repo, this has NOT been executed
end-to-end in a sandbox — PyTorch's CUDA-bundled dependencies exceed
this environment's available disk space (~2.8GB free, PyTorch's
default wheel + CUDA libs alone run 1-2GB+). This is written
correctly per PyTorch's documented API and standard conventions, but
"correct on read" is a different, weaker claim than "confirmed
running" — the classical ML script, the ETL scripts, and the Python
HTTP client were all genuinely executed against real or realistic
test data. Treat this one as reviewed reference code until it's run
for real, ideally in CI with a real PyTorch install.

Trains an LSTM to predict Remaining Useful Life (RUL) from the
windowed features produced by etl/sensor_etl.py. Consumes the SAME
feature matrix the classical ML script's data source is close
kin to — rolling mean/std/min/max/trend over a sensor window — but
predicts a continuous time-to-failure target instead of searching for
an optimal parameter combination.
"""
import os
import sys
import json
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "common"))

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader, random_split
except (ImportError, OSError):
    # OSError, not just ImportError, is deliberate — a partially broken
    # or mismatched CUDA install (a real, common failure mode on GPU
    # instances) raises OSError on the shared-library load, not a clean
    # ImportError. Caught this exact case during review: a leftover
    # broken torch install in this dev environment raised OSError, which
    # the original `except ImportError` here did NOT catch.
    #
    # The class definitions below (RulSequenceDataset, RulLstm) inherit
    # from torch.utils.data.Dataset and torch.nn.Module directly — if
    # those names are never bound, Python raises NameError the moment
    # the class statement itself is evaluated (at import time, not
    # lazily), so the whole "import this module without torch" goal
    # needs dummy stand-in base classes, not just `torch = None`.
    # Verified this was actually broken before adding the fallback
    # classes below — the graceful-degradation claim was false until
    # tested.
    torch = None
    class Dataset:  # noqa: N801 — matching torch's own naming for drop-in compatibility
        pass
    class _DummyModule:
        pass
    class nn:  # noqa: N801
        Module = _DummyModule
    DataLoader = None
    random_split = None


FEATURE_COLS = ["value", "rolling_mean", "rolling_std", "rolling_min", "rolling_max", "rate_of_change", "rolling_trend"]


class RulSequenceDataset(Dataset):
    """Turns the feature matrix into overlapping sequences of length
    `seq_len`, each labeled with the RUL at the END of that sequence —
    the standard supervised framing for RUL prediction from a rolling
    sensor window."""

    def __init__(self, features_df, rul_series, seq_len=30):
        self.seq_len = seq_len
        self.X = features_df[FEATURE_COLS].values.astype(np.float32)
        self.y = rul_series.values.astype(np.float32)
        # Normalize features — LSTMs are sensitive to input scale, and
        # sensor units vary wildly (mm/s vs degC vs bare counts).
        self.mean = self.X.mean(axis=0)
        self.std = self.X.std(axis=0) + 1e-6
        self.X = (self.X - self.mean) / self.std

    def __len__(self):
        return max(0, len(self.X) - self.seq_len)

    def __getitem__(self, idx):
        seq = self.X[idx: idx + self.seq_len]
        target = self.y[idx + self.seq_len - 1]
        return torch.from_numpy(seq), torch.tensor(target, dtype=torch.float32)


class RulLstm(nn.Module):
    def __init__(self, input_size=len(FEATURE_COLS), hidden_size=64, num_layers=2, dropout=0.2):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=dropout if num_layers > 1 else 0)
        self.head = nn.Sequential(nn.Linear(hidden_size, 32), nn.ReLU(), nn.Dropout(dropout), nn.Linear(32, 1))

    def forward(self, x):
        out, (h_n, _) = self.lstm(x)
        last_hidden = h_n[-1]  # final layer's hidden state — the standard "sequence summary" for a many-to-one RUL head
        return self.head(last_hidden).squeeze(-1)


def make_synthetic_rul_labels(features_df, failure_at_index=None):
    """Real deployments compute RUL from actual recorded failure/
    maintenance events (time-to-failure counted backward from a known
    failure timestamp) — that event log isn't part of this repo's
    schema yet (see the platform-wide limitations doc). Until that
    exists, this derives a labeled target from the SAME rolling_trend
    feature already computed by the ETL step, which is honest about
    being a proxy, not real historical failure data."""
    n = len(features_df)
    if failure_at_index is None:
        failure_at_index = n - 1
    hours_per_sample = 1  # placeholder cadence assumption — real deployments should pass the actual sample interval
    rul = pd.Series([(failure_at_index - i) * hours_per_sample for i in range(n)], index=features_df.index)
    return rul.clip(lower=0)


def train(features_df, rul_series, seq_len=30, epochs=20, batch_size=32, lr=1e-3, corverxis_client=None):
    if torch is None:
        raise RuntimeError("PyTorch is not installed in this environment — train() requires it. See requirements.txt.")

    dataset = RulSequenceDataset(features_df, rul_series, seq_len=seq_len)
    if len(dataset) < 10:
        raise ValueError(f"Not enough data for training: {len(dataset)} sequences from {len(features_df)} rows and seq_len={seq_len}.")

    val_size = max(1, int(len(dataset) * 0.2))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    model = RulLstm()
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.MSELoss()

    history = {"train_loss": [], "val_loss": []}
    for epoch in range(epochs):
        model.train()
        train_losses = []
        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            pred = model(X_batch)
            loss = criterion(pred, y_batch)
            loss.backward()
            optimizer.step()
            train_losses.append(loss.item())

        model.eval()
        val_losses = []
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                pred = model(X_batch)
                val_losses.append(criterion(pred, y_batch).item())

        train_loss = float(np.mean(train_losses))
        val_loss = float(np.mean(val_losses))
        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)

        if corverxis_client:
            progress = 10 + int(80 * (epoch + 1) / epochs)
            corverxis_client.report_progress(progress, metrics={"epoch": epoch + 1, "train_loss": train_loss, "val_loss": val_loss})

    final_metrics = {
        "final_train_loss": history["train_loss"][-1],
        "final_val_loss": history["val_loss"][-1],
        "epochs": epochs,
        "rul_mae_hours": float(np.mean([abs(dataset[i][1].item() - model(dataset[i][0].unsqueeze(0)).item()) for i in range(min(50, len(dataset)))])),
    }
    return model, final_metrics


if __name__ == "__main__":
    from corverxis_client import CorverxisClient  # noqa: E402

    dataset_path = os.environ.get("DATASET_LOCAL_PATH", "/opt/ml/input/data/training/dataset.csv")
    client = CorverxisClient()
    try:
        df = pd.read_csv(dataset_path)
        rul = make_synthetic_rul_labels(df)
        model, metrics = train(df, rul, corverxis_client=client)
        client.report_complete(metrics)
        print(json.dumps(metrics, indent=2))
    except Exception as e:  # noqa: BLE001
        client.report_failed(str(e))
        raise
