#!/usr/bin/env python3
"""Train a deterministic ALGO-6 candidate; never promote it.

The script consumes only the service-only, point-in-time-correct V2 sample RPC.
It exits successfully without producing a model when the readiness authority is
not READY.  Validation is used solely for Platt calibration and selection;
the final two-week test slice remains untouched until final evaluation.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, precision_recall_curve, roc_auc_score
from supabase import create_client

RANDOM_SEED = 6122026
FEATURE_CONTRACT = "organic-ranking-features-personalization-v2"
LABEL_CONTRACT = "algo6-l6-label-contract-v1"
HEADS = ("long_watch", "completion", "early_exit", "rewatch", "save", "like")
FEATURES = (
    "freshness_points", "follow_points", "like_points", "comment_points",
    "save_points", "completion_points", "rewatch_points", "exploration_points",
    "same_session_points", "short_watch_points", "completed_points", "repeat_points",
    "creator_affinity_points", "l3_quality_points", "creator_burst_penalty",
    "duplicate_penalty", "l3_adjustment", "positive_creator_points",
    "negative_creator_penalty", "creator_session_repeat_penalty",
    "l4_context_adjustment", "l5_semantic_positive_points",
    "l5_semantic_negative_penalty", "l5_semantic_adjustment",
    "explicit_interest_similarity", "explicit_interest_points",
    "preferred_language_points", "content_region_points", "explicit_seed_weight",
    "behavioral_confidence",
)


@dataclass(frozen=True)
class Sample:
    sample_key: str
    at: datetime
    features: dict[str, float]
    labels: dict[str, bool | None]


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc)


def _load_samples(client: Any) -> list[Sample]:
    rows: list[Sample] = []
    after_at: str | None = None
    after_key: str | None = None
    while True:
        response = client.rpc("get_algo6_l6_training_samples_v1", {
            "p_after_created_at": after_at,
            "p_after_sample_key": after_key,
            "p_limit": 5000,
        }).execute().data
        if response.get("feature_contract_version") != FEATURE_CONTRACT:
            raise RuntimeError("training sample feature contract mismatch")
        if response.get("label_contract_version") != LABEL_CONTRACT:
            raise RuntimeError("training sample label contract mismatch")
        page = response.get("rows") or []
        for row in page:
            raw_features = row.get("features") or {}
            if set(raw_features) != set(FEATURES):
                raise RuntimeError("training sample feature schema mismatch")
            rows.append(Sample(
                sample_key=row["sample_key"],
                at=_parse_timestamp(row["impression_at"]),
                features={key: float(raw_features.get(key) or 0.0) for key in FEATURES},
                labels={key: row.get("labels", {}).get(key) for key in HEADS},
            ))
        if len(page) < 5000:
            break
        after_at = page[-1]["impression_at"]
        after_key = page[-1]["sample_key"]
    rows.sort(key=lambda row: (row.at, row.sample_key))
    return rows


def _split(rows: list[Sample]) -> tuple[list[Sample], list[Sample], list[Sample]]:
    if not rows:
        raise RuntimeError("ready dataset unexpectedly empty")
    window_end = rows[-1].at.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    window_start = window_end - timedelta(weeks=12)
    validation_start = window_start + timedelta(weeks=8)
    test_start = validation_start + timedelta(weeks=2)
    eligible = [row for row in rows if window_start <= row.at < window_end]
    train = [row for row in eligible if row.at < validation_start]
    validation = [row for row in eligible if validation_start <= row.at < test_start]
    test = [row for row in eligible if row.at >= test_start]
    if not train or not validation or not test:
        raise RuntimeError("approved 8/2/2 temporal split is not populated")
    return train, validation, test


def _matrix(rows: list[Sample], head: str) -> tuple[np.ndarray, np.ndarray]:
    eligible = [row for row in rows if row.labels[head] is not None]
    x = np.asarray([[row.features[key] for key in FEATURES] for row in eligible], dtype=np.float64)
    y = np.asarray([int(bool(row.labels[head])) for row in eligible], dtype=np.int64)
    if len(np.unique(y)) != 2:
        raise RuntimeError(f"{head} lacks both classes in temporal slice")
    return x, y


def _metrics(y: np.ndarray, probabilities: np.ndarray) -> dict[str, float]:
    precision, recall, _ = precision_recall_curve(y, probabilities)
    pr_auc = float(abs(np.trapezoid(precision, recall)))
    return {
        "log_loss": float(log_loss(y, probabilities, labels=[0, 1])),
        "brier": float(brier_score_loss(y, probabilities)),
        "roc_auc": float(roc_auc_score(y, probabilities)),
        "pr_auc": pr_auc,
        "positive_count": int(y.sum()),
        "negative_count": int(len(y) - y.sum()),
    }


def _train_head(train: list[Sample], validation: list[Sample], test: list[Sample], head: str):
    x_train, y_train = _matrix(train, head)
    x_validation, y_validation = _matrix(validation, head)
    x_test, y_test = _matrix(test, head)

    base = LogisticRegression(
        penalty="l2", C=1.0, solver="lbfgs", max_iter=2000,
        random_state=RANDOM_SEED, n_jobs=1,
    )
    base.fit(x_train, y_train)
    validation_scores = base.decision_function(x_validation).reshape(-1, 1)
    # A one-feature logistic model is explicit Platt/sigmoid calibration.
    platt = LogisticRegression(
        penalty=None, solver="lbfgs", max_iter=2000,
        random_state=RANDOM_SEED, n_jobs=1,
    )
    platt.fit(validation_scores, y_validation)
    test_scores = base.decision_function(x_test).reshape(-1, 1)
    probabilities = platt.predict_proba(test_scores)[:, 1]
    metrics = _metrics(y_test, probabilities)
    prevalence = float(y_test.mean())
    naive = np.full_like(probabilities, prevalence, dtype=np.float64)
    metrics["naive_log_loss"] = float(log_loss(y_test, naive, labels=[0, 1]))
    metrics["eligible"] = bool(
        math.isfinite(metrics["log_loss"])
        and metrics["roc_auc"] >= 0.50
        and metrics["log_loss"] <= metrics["naive_log_loss"]
    )
    payload = {
        "intercept": float(base.intercept_[0]),
        "coefficients": {name: float(value) for name, value in zip(FEATURES, base.coef_[0], strict=True)},
        "calibration_coefficient": float(platt.coef_[0][0]),
        "calibration_intercept": float(platt.intercept_[0]),
    }
    return payload, metrics


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not secret:
        raise RuntimeError("server-only Supabase credentials are required")
    client = create_client(url, secret)
    readiness = client.rpc("get_algo6_l6_training_readiness_v2").execute().data
    if not readiness.get("training_entry_ready"):
        print("TRAINING_ENTRY_READY=false; no candidate produced")
        return 0

    samples = _load_samples(client)
    train, validation, test = _split(samples)
    payload_heads: dict[str, Any] = {}
    metrics_heads: dict[str, Any] = {}
    for head in HEADS:
        payload_heads[head], metrics_heads[head] = _train_head(train, validation, test, head)

    promotion_eligible = all(bool(metrics["eligible"]) for metrics in metrics_heads.values())
    head_metrics = {
        "promotion_eligible": promotion_eligible,
        "split": {"train_weeks": 8, "validation_weeks": 2, "test_weeks": 2},
        "heads": metrics_heads,
    }
    model_payload = {
        "architecture": "calibrated-multi-head-logistic-v1",
        "feature_order": list(FEATURES),
        "heads": payload_heads,
    }
    digest = hashlib.sha256(json.dumps(
        {"metrics": head_metrics, "payload": model_payload}, sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()[:16]
    model_version = f"algo6-l6-{test[-1].at:%Y%m%d}-{digest}"
    result = client.rpc("register_algo6_model_candidate_v1", {
        "p_model_version": model_version,
        "p_training_window_start": train[0].at.isoformat(),
        "p_training_window_end": test[-1].at.isoformat(),
        "p_training_sample_count": len(samples),
        "p_head_metrics": head_metrics,
        "p_model_payload": model_payload,
        "p_rejected": not promotion_eligible,
    }).execute().data
    status = "candidate" if promotion_eligible else "rejected"
    print(json.dumps({"model_id": result, "model_version": model_version, "status": status}, sort_keys=True))
    return 0 if promotion_eligible else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # secrets and sample content are intentionally omitted.
        print(f"ALGO-6 training failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
