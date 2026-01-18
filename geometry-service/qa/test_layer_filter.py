
import unittest
from core.layer_filter import should_keep_layer, filter_segments
from dataclasses import dataclass

@dataclass
class MockSegment:
    layer: str
    start: object = None
    end: object = None

class TestLayerFilter(unittest.TestCase):
    def test_whitelist(self):
        # These should PASS
        self.assertTrue(should_keep_layer("A-WALL"))
        self.assertTrue(should_keep_layer("A-DOOR"))
        self.assertTrue(should_keep_layer("MB-AUXILIAR"))
        self.assertTrue(should_keep_layer("0")) # Generic fallback
        self.assertTrue(should_keep_layer("RANDOM_LAYER")) # Conservative: Unknowns are kept

    def test_blacklist(self):
        # These should FAIL (be filtered out)
        self.assertFalse(should_keep_layer("A-FURN"))
        self.assertFalse(should_keep_layer("I-MUEBLE"))
        self.assertFalse(should_keep_layer("L-PLANT"))
        self.assertFalse(should_keep_layer("A-TEXT"))
        self.assertFalse(should_keep_layer("A-ANNO-DIMS"))
        self.assertFalse(should_keep_layer("DEFPOINTS"))

    def test_filter_list(self):
        segments = [
            MockSegment("A-WALL"),
            MockSegment("A-FURN"),
            MockSegment("MB-FLOOR"),
            MockSegment("A-VEG")
        ]
        kept = filter_segments(segments)
        self.assertEqual(len(kept), 2)
        self.assertEqual(kept[0].layer, "A-WALL")
        self.assertEqual(kept[1].layer, "MB-FLOOR")

if __name__ == "__main__":
    unittest.main()
