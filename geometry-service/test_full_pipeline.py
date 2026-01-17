"""
Full Integration Test - Match Excel items to DXF regions

Tests the complete pipeline: DXF → Regions → Text Association → Measurement
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.dxf_parser import parse_dxf_file
from core.geometry_cleanup import cleanup_geometry, Segment, Point
from core.region_extractor import extract_regions, Region as ExtractorRegion
from core.text_associator import (
    associate_text_to_regions, 
    Label, 
    Region as AssociatorRegion,
    ExcelItem
)

# Paths
DXF_PATH = os.path.join(os.path.dirname(__file__), "..", "LDS_PAK - (LC) (1).dxf")

# Expected values from validation CSV
EXPECTED_ITEMS = [
    {"id": "1", "description": "TAB 01 - Tabique", "unit": "m2", "expected_qty": 62.38},
    {"id": "2", "description": "TAB 02 - Tabique", "unit": "m2", "expected_qty": 30.58},
    {"id": "3", "description": "TAB 03 - Tabique", "unit": "m2", "expected_qty": 29.76},
    {"id": "4", "description": "Cielo sala", "unit": "m2", "expected_qty": 37.62},
    {"id": "5", "description": "Sobrelosa de 8cm", "unit": "m2", "expected_qty": 60.57},
    {"id": "6", "description": "Impermeabilización membrana", "unit": "m2", "expected_qty": 46.57},
]


def run_full_pipeline():
    print("\n" + "=" * 70)
    print("FULL INTEGRATION TEST: Excel Items → DXF Regions → Quantities")
    print("=" * 70)
    
    # Step 1: Parse DXF
    print("\n📁 Step 1: Parsing DXF...")
    parse_result = parse_dxf_file(DXF_PATH)
    print(f"   ✅ {len(parse_result.segments)} segments, {len(parse_result.texts)} texts")
    
    # Step 2: Cleanup
    print("\n🧹 Step 2: Geometry Cleanup...")
    segments = [
        Segment(
            start=Point(s.start.x, s.start.y),
            end=Point(s.end.x, s.end.y),
            layer=s.layer,
            entity_type=s.entity_type
        )
        for s in parse_result.segments
    ]
    
    cleaned = cleanup_geometry(
        segments,
        snap_tolerance=0.01,
        merge_collinear_enabled=False,  # Skip for speed
        close_gaps=True,
        max_gap=0.05
    )
    print(f"   ✅ {len(cleaned)} segments after cleanup")
    
    # Step 3: Extract regions
    print("\n🔷 Step 3: Extracting Regions...")
    regions_raw = extract_regions(cleaned, method="shapely")
    print(f"   ✅ {len(regions_raw)} regions extracted")
    
    # Convert to text_associator format
    regions = []
    for r in regions_raw:
        regions.append(AssociatorRegion(
            id=r.id,
            vertices=[Point(v.x, v.y) for v in r.vertices],
            area=r.area,
            perimeter=r.perimeter,
            centroid=Point(r.centroid.x, r.centroid.y)
        ))
    
    # Step 4: Convert texts to labels
    print("\n📝 Step 4: Converting {0} texts to labels...".format(len(parse_result.texts)))
    labels = []
    for t in parse_result.texts:
        labels.append(Label(
            text=t.text,
            position=Point(t.position.x, t.position.y),
            confidence=1.0
        ))
    
    # Show some relevant labels
    relevant_keywords = ['TAB', 'CIELO', 'PISO', 'MURO', 'SALA', 'SOBRE']
    relevant_labels = [l for l in labels if any(kw in l.text.upper() for kw in relevant_keywords)]
    print(f"   Found {len(relevant_labels)} relevant labels:")
    for l in relevant_labels[:15]:
        print(f"     - '{l.text}' at ({l.position.x:.2f}, {l.position.y:.2f})")
    
    # Step 5: Match Excel items to regions
    print("\n🔗 Step 5: Matching Excel Items to Regions...")
    excel_items = [ExcelItem(**item) for item in EXPECTED_ITEMS]
    
    matches = associate_text_to_regions(
        regions=regions,
        labels=labels,
        excel_items=excel_items,
        text_match_threshold=0.4,
        spatial_search_radius=5.0  # 5 meter search radius
    )
    
    # Step 6: Report results
    print("\n" + "=" * 70)
    print("📊 RESULTS")
    print("=" * 70)
    
    print(f"\n{'Item':<40} {'Expected':>10} {'Calculated':>12} {'Diff':>8} {'Status':>8}")
    print("-" * 80)
    
    correct_count = 0
    for match in matches:
        item = match.excel_item
        expected = item.expected_qty
        calculated = match.qty_calculated
        
        if expected and expected > 0:
            diff = abs(calculated - expected) / expected * 100
            if diff <= 20:
                status = "✅"
                correct_count += 1
            elif diff <= 50:
                status = "⚠️"
            else:
                status = "❌"
        else:
            diff = 0
            status = "?"
        
        print(f"{item.description:<40} {expected:>10.2f} {calculated:>12.2f} {diff:>7.0f}% {status:>8}")
        
        if match.label:
            print(f"   └─ Matched via: '{match.label.text}'")
    
    print("-" * 80)
    print(f"\n✅ Correct (within 20%): {correct_count}/{len(matches)}")
    
    # Show top regions that might be the missing ones
    print("\n📐 Top 20 Regions by Area (for reference):")
    for i, r in enumerate(sorted(regions, key=lambda x: x.area, reverse=True)[:20]):
        print(f"   {i+1:2}. {r.area:8.2f} m²")
    
    return matches


if __name__ == "__main__":
    run_full_pipeline()
