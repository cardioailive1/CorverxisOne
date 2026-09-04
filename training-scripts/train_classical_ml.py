"""
Golden Batch training script — Classical ML (Random Forest).

Trains a regressor mapping machining parameters (spindle speed, feed
rate, coolant pressure) to outcome (scrap rate), using real historical
MES work-order data. Then searches a grid of candidate parameter
combinations and returns the one the model predicts will minimize
scrap — this IS the actual mechanism that produces the
recommendedParams / predictedImprovement values a Golden Batch
deployment attaches to a GoldenBatchRecommendation (see
src/routes/lab.js's PROCESS_OPTIMIZATION deployment branch).

This never applies the recommendation automatically — it only
produces the candidate values a human reviews, matching the
platform-wide "recommendation to trial, not an automatic change" rule.
"""
import sys
import os
import json
import itertools
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "common"))


def train_scrap_model(df, feature_cols, target_col="scrap_rate", test_size=0.2, random_state=42):
    """Trains the actual model. Returns the fitted model plus real
    validation metrics — not fabricated numbers, computed against a
    genuine held-out split."""
    X = df[feature_cols]
    y = df[target_col]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=random_state)

    model = RandomForestRegressor(n_estimators=200, max_depth=8, min_samples_leaf=3, random_state=random_state)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    metrics = {
        "mae": float(mean_absolute_error(y_test, y_pred)),
        "r2": float(r2_score(y_test, y_pred)),
        "n_train": len(X_train),
        "n_test": len(X_test),
    }
    return model, metrics


def find_optimal_parameters(model, feature_cols, param_ranges, baseline_scrap_rate, n_grid_points=8):
    """Searches a grid of candidate parameter combinations and returns
    the one the trained model predicts minimizes scrap — this is the
    literal "recommendation" a Golden Batch deployment surfaces, not a
    hand-picked example value."""
    grids = {f: np.linspace(lo, hi, n_grid_points) for f, (lo, hi) in param_ranges.items()}
    combos = list(itertools.product(*[grids[f] for f in feature_cols]))
    candidates = pd.DataFrame(combos, columns=feature_cols)

    predictions = model.predict(candidates)
    best_idx = int(np.argmin(predictions))
    best_params = candidates.iloc[best_idx].to_dict()
    best_predicted_scrap = float(predictions[best_idx])

    scrap_delta_pct = ((best_predicted_scrap - baseline_scrap_rate) / baseline_scrap_rate) * 100 if baseline_scrap_rate else None

    return {
        "recommendedParams": {k: round(float(v), 3) for k, v in best_params.items()},
        "predictedImprovement": {
            "predictedScrapRate": round(best_predicted_scrap, 4),
            "scrapRateDeltaPct": round(scrap_delta_pct, 2) if scrap_delta_pct is not None else None,
        },
    }


def run(dataset_df, feature_cols, param_ranges, corverxis_client=None):
    """Full entrypoint — what the training container actually calls.
    Reports real progress at each real stage, not simulated ticks."""
    if corverxis_client:
        corverxis_client.report_progress(10, metrics={"stage": "training"})

    baseline_scrap_rate = float(dataset_df["scrap_rate"].mean())
    model, metrics = train_scrap_model(dataset_df, feature_cols)

    if corverxis_client:
        corverxis_client.report_progress(70, metrics={"stage": "searching_optimal_parameters", **metrics})

    recommendation = find_optimal_parameters(model, feature_cols, param_ranges, baseline_scrap_rate)

    final_metrics = {**metrics, "baselineScrapRate": round(baseline_scrap_rate, 4), **recommendation}

    if corverxis_client:
        corverxis_client.report_complete(final_metrics)

    return model, final_metrics


if __name__ == "__main__":
    # Container entrypoint path — reads config from the same env vars
    # the AWS/GCP/RunPod connectors inject at job submission.
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "common"))
    from corverxis_client import CorverxisClient  # noqa: E402

    dataset_path = os.environ.get("DATASET_LOCAL_PATH", "/opt/ml/input/data/training/dataset.csv")
    feature_cols = json.loads(os.environ.get("FEATURE_COLUMNS", '["spindleSpeedRpm","feedRateMmRev","coolantPsi"]'))
    param_ranges = json.loads(os.environ.get(
        "PARAM_RANGES",
        '{"spindleSpeedRpm":[1800,3000],"feedRateMmRev":[0.08,0.25],"coolantPsi":[600,1000]}',
    ))

    client = CorverxisClient()
    try:
        df = pd.read_csv(dataset_path)
        model, metrics = run(df, feature_cols, param_ranges, corverxis_client=client)
        print(json.dumps(metrics, indent=2))
    except Exception as e:  # noqa: BLE001
        client.report_failed(str(e))
        raise
