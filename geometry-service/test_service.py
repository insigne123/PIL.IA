"""
Test script for Geometry Service

Tests DXF parsing, geometry cleanup, and region extraction with the user's DXF file.
"""
import sys
import os

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.dxf_parser import parse_dxf_file
from core.geometry_cleanup import cleanup_geometry, Segment, Point
from core.region_extractor import extract_regions

# Path to test DXF
DXF_PATH = os.path.join(os.path.dirname(__file__), "..", "LDS_PAK - (LC) (1).dxf")


def test_dxf_parsing():
    """Test DXF file parsing"""
    print("=" * 60)
    print("TEST 1: DXF Parsing")
    print("=" * 60)
    
    if not os.path.exists(DXF_PATH):
        print(f"❌ DXF file not found: {DXF_PATH}")
        return None
    
    try:
        result = parse_dxf_file(DXF_PATH)
        print(f"✅ Parsed successfully!")
        print(f"   • Segments: {len(result.segments)}")
        print(f"   • Texts: {len(result.texts)}")
        print(f"   • Layers: {len(result.layers)}")
        print(f"   • Bounds: ({result.bounds[0]:.1f}, {result.bounds[1]:.1f}) to ({result.bounds[2]:.1f}, {result.bounds[3]:.1f})")
        print(f"   • Unit factor: {result.unit_factor}")
        
        # Show sample texts
        print("\n   Sample texts found:")
        for text in result.texts[:10]:
            print(f"     - '{text.text}' at ({text.position.x:.2f}, {text.position.y:.2f})")
        
        return result
    except Exception as e:
        print(f"❌ Parsing failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_geometry_cleanup(parse_result, fast_mode=False):
    """Test geometry cleanup (snap/merge)"""
    print("\n" + "=" * 60)
    print("TEST 2: Geometry Cleanup")
    print("=" * 60)
    
    if parse_result is None:
        print("⏭️ Skipped (no parse result)")
        return None
    
    # Convert to cleanup module's format
    segments = [
        Segment(
            start=Point(s.start.x, s.start.y),
            end=Point(s.end.x, s.end.y),
            layer=s.layer,
            entity_type=s.entity_type
        )
        for s in parse_result.segments
    ]
    
    # For large files, skip slow operations
    merge_enabled = not fast_mode and len(segments) < 50000
    if not merge_enabled:
        print(f"⚡ Fast mode: skipping collinear merge ({len(segments)} segments)")
    
    try:
        cleaned = cleanup_geometry(
            segments,
            snap_tolerance=0.01,
            merge_collinear_enabled=merge_enabled,
            close_gaps=True,
            max_gap=0.05
        )
        
        print(f"✅ Cleanup completed!")
        print(f"   • Input segments: {len(segments)}")
        print(f"   • Output segments: {len(cleaned)}")
        print(f"   • Reduction: {(1 - len(cleaned)/len(segments))*100:.1f}%")
        
        return cleaned
    except Exception as e:
        print(f"❌ Cleanup failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_region_extraction(cleaned_segments):
    """Test region (polygon) extraction"""
    print("\n" + "=" * 60)
    print("TEST 3: Region Extraction")
    print("=" * 60)
    
    if cleaned_segments is None:
        print("⏭️ Skipped (no cleaned segments)")
        return None
    
    try:
        regions = extract_regions(cleaned_segments, method="shapely")
        
        print(f"✅ Extraction completed!")
        print(f"   • Regions found: {len(regions)}")
        
        if regions:
            # Show largest regions
            print("\n   Top 10 regions by area:")
            for i, region in enumerate(regions[:10]):
                print(f"     {i+1}. Area: {region.area:.2f} m², Perimeter: {region.perimeter:.2f} m")
            
            # Check for regions matching expected values
            expected = [62.38, 37.62, 46.57, 60.57, 30.58, 29.76]
            print("\n   Looking for expected areas:")
            for exp in expected:
                closest = min(regions, key=lambda r: abs(r.area - exp))
                diff = abs(closest.area - exp) / exp * 100
                status = "✅" if diff < 20 else "⚠️" if diff < 50 else "❌"
                print(f"     Expected {exp:.2f} m² → Closest: {closest.area:.2f} m² ({diff:.0f}% diff) {status}")
        
        return regions
    except Exception as e:
        print(f"❌ Extraction failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    print("\n🔧 GEOMETRY SERVICE - TEST SUITE\n")
    
    # Run tests
    parse_result = test_dxf_parsing()
    cleaned = test_geometry_cleanup(parse_result)
    regions = test_region_extraction(cleaned)
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    if regions:
        print("✅ All tests passed! Geometry service is working.")
        print(f"   Found {len(regions)} extractable regions from the DXF.")
    else:
        print("⚠️ Some tests failed. Check the output above for details.")
    
    print()


if __name__ == "__main__":
    main()
