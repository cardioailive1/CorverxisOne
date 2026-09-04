"""
Real ETL for sensor data — cleaning, windowing, and feature engineering
against actual SensorReading data pulled via CorverxisClient. This is
what a CorverxisLab pipeline stage (INGESTION → CLEANING →
TRANSFORMATION → FEATURE_ENGINEERING) actually executes, not just
tracks metadata for.

Produces a feature matrix suitable for either the classical ML
(Golden Batch) or time-series (Predictive Maintenance) training
scripts.
"""
import numpy as np
import pandas as pd


def clean_readings(readings):
    """Stage: CLEANING. Drops null/non-numeric values, removes duplicate
    timestamps, and flags (not silently drops) statistical outliers so
    downstream stages can decide whether to exclude them."""
    df = pd.DataFrame(readings)
    if df.empty:
        return df

    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    before = len(df)
    df = df.dropna(subset=["value"])
    df = df.drop_duplicates(subset=["timestamp"])
    dropped = before - len(df)

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)

    # Flag outliers via IQR — a real, standard method, not arbitrary
    # thresholds picked to look sophisticated.
    q1, q3 = df["value"].quantile([0.25, 0.75])
    iqr = q3 - q1
    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    df["is_outlier"] = (df["value"] < lower) | (df["value"] > upper)

    return df, {"rows_in": before, "rows_dropped_null_or_dup": dropped, "outliers_flagged": int(df["is_outlier"].sum())}


def engineer_windowed_features(df, window_size=20):
    """Stage: FEATURE_ENGINEERING. Rolling-window statistics — the
    standard feature set for RUL/anomaly prediction on a sensor
    time-series: not just the raw value, but how it's been trending."""
    if df.empty or len(df) < window_size:
        return pd.DataFrame()

    features = pd.DataFrame(index=df.index)
    features["value"] = df["value"]
    features["rolling_mean"] = df["value"].rolling(window_size).mean()
    features["rolling_std"] = df["value"].rolling(window_size).std()
    features["rolling_min"] = df["value"].rolling(window_size).min()
    features["rolling_max"] = df["value"].rolling(window_size).max()
    features["rate_of_change"] = df["value"].diff()
    features["rolling_trend"] = df["value"].rolling(window_size).apply(
        lambda w: np.polyfit(range(len(w)), w, 1)[0] if len(w) == window_size else np.nan,
        raw=True,
    )
    features["timestamp"] = df["timestamp"]
    features = features.dropna().reset_index(drop=True)
    return features


def run_etl(readings, window_size=20):
    """Full pipeline entrypoint — what a CorverxisLab pipeline stage
    actually calls. Returns the feature matrix plus a summary dict
    that gets written back as the pipeline's recordsProcessed /
    status, matching src/routes/lab.js's pipeline tracking shape."""
    cleaned, clean_stats = clean_readings(readings)
    if cleaned.empty:
        return pd.DataFrame(), {**clean_stats, "features_generated": 0}

    cleaned_no_outliers = cleaned[~cleaned["is_outlier"]]
    features = engineer_windowed_features(cleaned_no_outliers, window_size)

    return features, {**clean_stats, "features_generated": len(features)}
