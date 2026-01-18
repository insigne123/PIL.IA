
"""
Test Spatial Logic
Verifies that the new SpatialIndex correctly links Text to Regions.
"""
from core.spatial_index import SpatialIndex
from core.text_associator import associate_text_to_regions, Label, ExcelItem
from shapely.geometry import Polygon
from dataclasses import dataclass
import logging

# Mock Region class mimicking region_extractor.Region
@dataclass
class MockRegion:
    id: str
    shapely_polygon: Polygon
    layer: str
    area: float
    perimeter: float
    
    @property
    def centroid(self):
        return self.shapely_polygon.centroid

def test_spatial_association():
    print("Testing Spatial Association Logic...")
    
    # 1. Create Mock Geometry (The "Floor")
    # A 10x10 square at 0,0 -> Area 100
    floor_poly = Polygon([(0,0), (10,0), (10,10), (0,10)])
    floor_region = MockRegion(
        id="region_1",
        shapely_polygon=floor_poly,
        layer="mb-auxiliar",
        area=100.0,
        perimeter=40.0
    )
    
    # 2. Create Mock Regions List
    regions = [floor_region]
    
    # 3. Create Mock Labels
    # "SALA DE VENTAS" is inside logic (at 5,5)
    # "EXTERIOR" is outside (at 15,15)
    labels = [
        Label(text="SALA DE VENTAS", position=type('obj', (object,), {'x': 5, 'y': 5})),
        Label(text="PATIO EXTERIOR", position=type('obj', (object,), {'x': 15, 'y': 15}))
    ]
    
    # 4. Create Excel Items to Match
    excel_items = [
        ExcelItem(id="1", description="Pavimento Sala de Ventas", unit="m2"),
        ExcelItem(id="2", description="Pavimento Patio", unit="m2")
    ]
    
    # 5. Run Association
    matches = associate_text_to_regions(regions, labels, excel_items)
    
    # 6. Verify Results
    
    # Case A: Inside Match
    sala_match = next(m for m in matches if m.excel_item.id == "1")
    print(f"\nCase A (Inside): {sala_match.match_reason}")
    print(f"Calculated Qty: {sala_match.qty_calculated}")
    
    if "via inside_zone" in sala_match.match_reason and sala_match.qty_calculated == 100.0:
        print("✅ SUCCESS: Correctly matched Text inside Polygon using Spatial Index.")
    else:
        print(f"❌ FAILURE: Expected inside_zone match with 100m2. Got: {sala_match.match_reason} / {sala_match.qty_calculated}")
    
    # Case B: Outside/No Match
    patio_match = next(m for m in matches if m.excel_item.id == "2")
    print(f"\nCase B (Outside): {patio_match.match_reason}")
    
    if patio_match.region is None:
        print("✅ SUCCESS: Correctly ignored text outside polygon.")
    else:
        print(f"❌ FAILURE: Should not have matched outside text. Got: {patio_match.match_reason}")

if __name__ == "__main__":
    test_spatial_association()
