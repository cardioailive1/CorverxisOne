"""
Real ETL for vision inspection data. Unlike sensor data (a continuous
signal to window), vision results are already discrete per-part
records — the ETL work here is aggregation, class-balance checking,
and defect-type label encoding, not windowing.
"""
import pandas as pd
from collections import Counter


def clean_results(results):
    """Stage: CLEANING. Drops malformed records (no result, negative
    confidence/cycle time — these indicate a corrupted or malformed
    push from an inspection station, not a real reading)."""
    df = pd.DataFrame(results)
    if df.empty:
        return df, {"rows_in": 0, "rows_dropped": 0}

    before = len(df)
    df = df.dropna(subset=["result"])
    df = df[df["result"].isin(["PASS", "FAIL"])]
    if "confidence" in df.columns:
        df = df[(df["confidence"] >= 0) & (df["confidence"] <= 1)]
    if "cycleMs" in df.columns:
        df = df[df["cycleMs"] >= 0]
    dropped = before - len(df)

    return df.reset_index(drop=True), {"rows_in": before, "rows_dropped": dropped}


def check_class_balance(df):
    """A defect classifier trained on 98% PASS / 2% FAIL will report
    great accuracy while being useless — this surfaces that risk
    explicitly rather than letting a training script silently proceed
    on badly imbalanced data."""
    if df.empty:
        return {"pass_count": 0, "fail_count": 0, "imbalance_ratio": None, "warning": "no data"}

    counts = df["result"].value_counts().to_dict()
    pass_n = counts.get("PASS", 0)
    fail_n = counts.get("FAIL", 0)
    ratio = (pass_n / fail_n) if fail_n > 0 else float("inf")

    warning = None
    if fail_n == 0:
        warning = "No FAIL examples at all — a classifier cannot learn to detect defects it has never seen."
    elif ratio > 10:
        warning = f"Severe class imbalance ({ratio:.1f}:1 pass:fail) — consider oversampling FAIL cases or collecting more defect examples before training."
    elif ratio > 4:
        warning = f"Moderate class imbalance ({ratio:.1f}:1 pass:fail) — worth watching; accuracy alone will be a misleading metric at this ratio."

    return {"pass_count": pass_n, "fail_count": fail_n, "imbalance_ratio": ratio, "warning": warning}


def encode_defect_labels(df):
    """Stage: FEATURE_ENGINEERING. Multi-label defect types (a FAIL can
    have several defectTypes at once) get one-hot encoded — the real
    encoding a vision classifier's output layer needs, not a single
    class index."""
    if df.empty or "defectTypes" not in df.columns:
        return df, []

    all_types = set()
    for types in df["defectTypes"].dropna():
        if isinstance(types, list):
            all_types.update(types)
    all_types = sorted(all_types)

    for t in all_types:
        df[f"defect_{t.replace(' ', '_').replace('/', '_')}"] = df["defectTypes"].apply(
            lambda types, t=t: 1 if isinstance(types, list) and t in types else 0
        )
    return df, all_types


def run_etl(results):
    cleaned, clean_stats = clean_results(results)
    balance = check_class_balance(cleaned)
    encoded, defect_columns = encode_defect_labels(cleaned)
    return encoded, {**clean_stats, "class_balance": balance, "defect_types_found": defect_columns}
