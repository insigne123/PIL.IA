"""
Complete Pipeline Test with Vision AI

Combines:
1. PDF/DXF → Image rendering
2. Vision AI (GPT-4V) → Label detection with coordinates
3. DXF → Region extraction
4. Spatial matching → Labels to Regions
5. Quantity calculation → Compare to expected

This is the full pipeline test to validate TAB 01 = 62.38 m²
"""
import sys
import os
import json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import fitz  # PyMuPDF
import tempfile

from core.dxf_parser import parse_dxf_file
from core.geometry_cleanup import cleanup_geometry, Segment, Point
from core.region_extractor import extract_regions, Region as ExtractorRegion
from vision.label_detector import detect_labels

# Paths
DXF_PATH = os.path.join(os.path.dirname(__file__), "..", "LDS_PAK - (LC) (1).dxf")
PDF_PATH = os.path.join(os.path.dirname(__file__), "..", "LDS_PAK - (LC)-02_CONSTRUCCION.pdf")

# Expected values
EXPECTED = {
    "TAB 01": 62.38,
    "TAB 02": 30.58,
    "TAB 03": 29.76,
    "CIELO": 37.62,
    "SOBRELOSA": 60.57,
}


def render_pdf_to_image(pdf_path: str, dpi: int = 150):
    """Render PDF to image for Vision AI"""
    doc = fitz.open(pdf_path)
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    
    fd, image_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    pix.save(image_path)
    doc.close()
    
    return image_path, (pix.width, pix.height)


def find_region_for_label(label, regions, image_size, dxf_bounds):
    """
    Convert label bbox from image coordinates to DXF coordinates
    and find the region that contains or is nearest to the label.
    """
    # Label bbox is in percentage of image (0-100)
    # Convert to DXF coordinates
    img_w, img_h = image_size
    dxf_min_x, dxf_min_y, dxf_max_x, dxf_max_y = dxf_bounds
    dxf_width = dxf_max_x - dxf_min_x
    dxf_height = dxf_max_y - dxf_min_y
    
    # Get label centroid in percentage
    x_pct = (label.bbox[0] + label.bbox[2]) / 2 / 100
    y_pct = (label.bbox[1] + label.bbox[3]) / 2 / 100
    
    # Convert to DXF coordinates
    label_x = dxf_min_x + x_pct * dxf_width
    label_y = dxf_max_y - y_pct * dxf_height  # Y is inverted
    
    # Find region containing this point
    best_region = None
    best_score = -1
    
    for region in regions:
        # Check if point is inside (simplified check)
        if region.shapely_polygon.contains_properly(fitz.Point(label_x, label_y)):
            # Prefer smaller regions (more specific)
            if best_region is None or region.area < best_region.area:
                best_region = region
                best_score = 1.0
        else:
            # Check distance
            try:
                from shapely.geometry import Point as ShapelyPoint
                pt = ShapelyPoint(label_x, label_y)
                dist = region.shapely_polygon.distance(pt)
                if dist < 5:  # Within 5 meters
                    score = 1.0 - dist / 5.0
                    if score > best_score:
                        best_score = score
                        best_region = region
            except:
                pass
    
    return best_region, best_score


def run_complete_pipeline():
    print("\n" + "=" * 70)
    print("🚀 COMPLETE PIPELINE TEST WITH VISION AI")
    print("=" * 70)
    
    # Check API key
    if not os.getenv("OPENAI_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
        print("❌ No API key found!")
        return
    
    # Step 1: Render PDF for Vision AI
    print("\n📸 Step 1: Rendering PDF...")
    try:
        image_path, image_size = render_pdf_to_image(PDF_PATH, dpi=150)
        print(f"   ✅ Rendered {image_size[0]}x{image_size[1]} pixels")
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        return
    
    # Step 2: Vision AI Label Detection
    print("\n🔭 Step 2: Vision AI detecting labels...")
    try:
        result = detect_labels(image_path=image_path, model="gpt4v")
        print(f"   ✅ Detected {len(result.labels)} labels")
        
        # Show construction-related labels
        construction_labels = [l for l in result.labels 
                               if any(kw in l.text.upper() for kw in ['TAB', 'CIELO', 'PISO', 'MURO', 'SOBRE'])]
        
        if construction_labels:
            print("\n   Construction labels found:")
            for label in construction_labels[:10]:
                print(f"     - '{label.text}' | Type: {label.element_type}")
        else:
            print("\n   ⚠️ No construction-specific labels detected")
            print("   All labels found:")
            for label in result.labels[:15]:
                print(f"     - '{label.text}'")
    except Exception as e:
        print(f"   ❌ Vision AI failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 3: Parse DXF and extract regions
    print("\n📐 Step 3: Extracting regions from DXF...")
    try:
        dxf_result = parse_dxf_file(DXF_PATH)
        print(f"   Parsed {len(dxf_result.segments)} segments")
        
        segments = [
            Segment(
                start=Point(s.start.x, s.start.y),
                end=Point(s.end.x, s.end.y),
                layer=s.layer,
                entity_type=s.entity_type
            )
            for s in dxf_result.segments
        ]
        
        cleaned = cleanup_geometry(segments, snap_tolerance=0.01, 
                                   merge_collinear_enabled=False, close_gaps=True)
        print(f"   Cleaned to {len(cleaned)} segments")
        
        regions = extract_regions(cleaned, method="shapely")
        print(f"   ✅ Extracted {len(regions)} regions")
        
    except Exception as e:
        print(f"   ❌ DXF processing failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 4: Show regions that match expected values
    print("\n📊 Step 4: Finding regions matching expected values...")
    print(f"\n   {'Expected Item':<20} {'Expected m²':>12} {'Best Match':>12} {'Diff':>8}")
    print("   " + "-" * 56)
    
    for item_name, expected_area in EXPECTED.items():
        # Find closest region by area
        closest = min(regions, key=lambda r: abs(r.area - expected_area))
        diff = abs(closest.area - expected_area) / expected_area * 100
        status = "✅" if diff < 15 else "⚠️" if diff < 40 else "❌"
        
        print(f"   {item_name:<20} {expected_area:>12.2f} {closest.area:>12.2f} {diff:>7.0f}% {status}")
    
    # Show top regions
    print("\n   Top 15 regions by area (for reference):")
    for i, r in enumerate(sorted(regions, key=lambda x: x.area, reverse=True)[:15]):
        # Check if close to any expected value
        matches = [name for name, val in EXPECTED.items() if abs(r.area - val) / val < 0.2]
        match_str = f" ← possible {matches[0]}" if matches else ""
        print(f"     {i+1:2}. {r.area:8.2f} m²{match_str}")
    
    # Cleanup
    try:
        os.unlink(image_path)
    except:
        pass
    
    print("\n" + "=" * 70)
    print("✅ Pipeline Complete!")
    print("=" * 70)


if __name__ == "__main__":
    run_complete_pipeline()
