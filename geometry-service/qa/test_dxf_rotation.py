import unittest
import math
import sys
import os
import ezdxf

# Add parent directory to path to allow importing core
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from core.dxf_parser import explode_block, Segment, Point, TextBlock, BlockReference

class TestDxfParserRotation(unittest.TestCase):

    def setUp(self):
        self.doc = ezdxf.new()
        self.msp = self.doc.modelspace()

    def test_rotation(self):
        # Define a block named "TEST_BLOCK"
        block = self.doc.blocks.new(name="TEST_BLOCK")
        # Add a line from (0,0) to (10,0) in the block
        block.add_line((0, 0), (10, 0))

        # Insert the block rotated 90 degrees at (20,0)
        insert = self.msp.add_blockref("TEST_BLOCK", (20, 0), dxfattribs={'rotation': 90})

        segments, _ = explode_block(insert, self.doc)

        self.assertEqual(len(segments), 1)
        seg = segments[0]

        # Expected: Start(20,0), End(20, 10)
        self.assertAlmostEqual(seg.start.x, 20.0)
        self.assertAlmostEqual(seg.start.y, 0.0)
        self.assertAlmostEqual(seg.end.x, 20.0)
        self.assertAlmostEqual(seg.end.y, 10.0)

    def test_nested_block_rotation(self):
        # Inner Block: Line (0,0)-(10,0)
        inner = self.doc.blocks.new(name="INNER")
        inner.add_line((0,0), (10,0))

        # Outer Block: Insert INNER at (0, 5)
        outer = self.doc.blocks.new(name="OUTER")
        outer.add_blockref("INNER", (0, 5))

        # Model Space: Insert OUTER at (100, 0)
        insert_outer = self.msp.add_blockref("OUTER", (100, 0))

        segments, _ = explode_block(insert_outer, self.doc)

        self.assertEqual(len(segments), 1)
        seg = segments[0]

        # Expected:
        # INNER line (0,0)-(10,0) -> (0,5)-(10,5) in OUTER space
        # OUTER insert at (100,0) -> (100,5)-(110,5) in World space

        self.assertAlmostEqual(seg.start.x, 100.0)
        self.assertAlmostEqual(seg.start.y, 5.0)
        self.assertAlmostEqual(seg.end.x, 110.0)
        self.assertAlmostEqual(seg.end.y, 5.0)

    def test_nested_block_with_rotation(self):
        # Inner Block: Line (0,0)-(10,0)
        inner = self.doc.blocks.new(name="INNER_ROT")
        inner.add_line((0,0), (10,0))

        # Outer Block: Insert INNER at (0, 0) rotated 90 degrees
        outer = self.doc.blocks.new(name="OUTER_ROT")
        outer.add_blockref("INNER_ROT", (0, 0), dxfattribs={'rotation': 90})

        # Model Space: Insert OUTER at (100, 0) rotated 90 degrees
        insert_outer = self.msp.add_blockref("OUTER_ROT", (100, 0), dxfattribs={'rotation': 90})

        segments, _ = explode_block(insert_outer, self.doc)

        self.assertEqual(len(segments), 1)
        seg = segments[0]

        # Inner line (0,0)-(10,0)
        # Rotated 90 in Outer -> (0,0)-(0,10)
        # Rotated 90 in World (at 100,0) ->
        # (0,0) -> (100,0)
        # (0,10) -> x = 0*cos(90) - 10*sin(90) = -10
        #           y = 0*sin(90) + 10*cos(90) = 0
        #           Translated to (100,0) -> (90, 0)

        # So line should be from (100,0) to (90,0) (horizontal, pointing left)

        self.assertAlmostEqual(seg.start.x, 100.0)
        self.assertAlmostEqual(seg.start.y, 0.0)
        self.assertAlmostEqual(seg.end.x, 90.0)
        self.assertAlmostEqual(seg.end.y, 0.0)

if __name__ == '__main__':
    unittest.main()
