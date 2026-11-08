"""Offline regression tests for the HW-827 bridge's statistical algorithm."""
import math
import unittest
from main import BpmRange, calculate_range, make_reading, parse_bpm


class PulseBridgeTests(unittest.TestCase):
    def test_parses_arduino_and_json(self):
        self.assertEqual(parse_bpm("Heart Rate: 78 BPM"), 78)
        self.assertEqual(parse_bpm('{"bpm": 83}'), 83)
        self.assertIsNone(parse_bpm("no pulse detected"))
        self.assertIsNone(parse_bpm("BPM: 0"))

    def test_initial_seven_samples(self):
        mean, std, low, high, removed = calculate_range([70, 72, 74, 73, 71, 75, 190])
        self.assertEqual(removed, 190)
        self.assertAlmostEqual(mean, 72.5)
        self.assertEqual(low, math.floor(mean - std))
        self.assertEqual(high, math.ceil(mean + std))

    def test_rolling_five_recalculates_each_new_sample(self):
        state = BpmRange()
        for bpm in [70, 72, 74, 73, 71, 75, 190]:
            state.add_sample(bpm)
        self.assertEqual(state.current_bpm(), 72.5)
        first_range = (state.bpm_min, state.bpm_max)
        state.add_sample(82)
        m, _, lo, hi, _ = calculate_range([73, 71, 75, 190, 82])
        self.assertEqual((state.bpm_min, state.bpm_max), (lo, hi))
        self.assertEqual(state.current_bpm(), round(m, 1))
        self.assertNotEqual(first_range, (lo, hi))
        reading = make_reading(state.current_bpm(), lo, hi)
        self.assertEqual(reading["bpmMin"], lo)
        self.assertEqual(reading["bpmMax"], hi)
        self.assertLessEqual(lo, reading["bpm"])
        self.assertGreaterEqual(hi, reading["bpm"])

    def test_precalibration_has_null_bounds(self):
        state = BpmRange()
        state.add_sample(80)
        self.assertEqual(state.current_bpm(), 80)
        self.assertIsNone(state.bpm_min)
        self.assertIsNone(state.bpm_max)


if __name__ == "__main__":
    unittest.main()
