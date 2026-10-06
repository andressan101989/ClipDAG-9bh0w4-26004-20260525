from __future__ import annotations

import importlib.util
import pathlib
import sys
import unittest
from datetime import datetime, timedelta, timezone


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "algo6_train_model", ROOT / "scripts" / "algo6" / "train_model.py"
)
assert SPEC and SPEC.loader
TRAINER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = TRAINER
SPEC.loader.exec_module(TRAINER)


class Algo6TrainingPipelineTest(unittest.TestCase):
    def samples(self):
        start = datetime(2026, 1, 5, tzinfo=timezone.utc)
        rows = []
        for day in range(84):
            for sequence in range(20):
                positive = sequence % 2 == 0
                features = {name: 0.0 for name in TRAINER.FEATURES}
                features["explicit_interest_similarity"] = 0.9 if positive else 0.1
                features["completion_points"] = 8.0 if positive else -2.0
                features["behavioral_confidence"] = min(1.0, day / 84.0)
                rows.append(TRAINER.Sample(
                    sample_key=f"{day:03d}-{sequence:03d}",
                    at=start + timedelta(days=day, minutes=sequence),
                    features=features,
                    labels={head: positive for head in TRAINER.HEADS},
                ))
        return rows

    def test_exact_temporal_split_and_reproducible_calibrated_heads(self):
        train, validation, test = TRAINER._split(self.samples())
        self.assertEqual((len(train), len(validation), len(test)), (1120, 280, 280))
        self.assertLess(max(row.at for row in train), min(row.at for row in validation))
        self.assertLess(max(row.at for row in validation), min(row.at for row in test))

        first = {}
        second = {}
        for head in TRAINER.HEADS:
            first[head] = TRAINER._train_head(train, validation, test, head)
            second[head] = TRAINER._train_head(train, validation, test, head)
            payload, metrics = first[head]
            self.assertEqual(set(payload), {
                "intercept", "coefficients", "calibration_coefficient", "calibration_intercept"
            })
            self.assertEqual(set(payload["coefficients"]), set(TRAINER.FEATURES))
            self.assertTrue(metrics["eligible"])
            self.assertGreaterEqual(metrics["roc_auc"], 0.99)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
