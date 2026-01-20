
import sys
import os

# Add geometry-service to path
sys.path.append(os.path.join(os.getcwd(), 'geometry-service'))

print("Verifying modules...")

try:
    from core.dxf_parser import DxfRegion, ParseResult, parse_dxf_file
    print("✅ dxf_parser imported")
except ImportError as e:
    print(f"❌ dxf_parser failed: {e}")
except Exception as e:
    print(f"❌ dxf_parser error: {e}")

try:
    from core.region_extractor import snap_undershoots, extract_regions_shapely
    print("✅ region_extractor imported")
except ImportError as e:
    print(f"❌ region_extractor failed: {e}")

try:
    from core.spatial_index import SpatialIndex
    print("✅ spatial_index imported")
except ImportError as e:
    print(f"❌ spatial_index failed: {e}")

try:
    from core.text_associator import associate_text_to_regions, estimate_unclosed_area
    print("✅ text_associator imported")
except ImportError as e:
    print(f"❌ text_associator failed: {e}")

try:
    from core.semantic_matcher import SemanticMatcher
    sm = SemanticMatcher()
    print(f"✅ semantic_matcher imported (LLM Enabled: {sm.use_llm})")
except ImportError as e:
    print(f"❌ semantic_matcher failed: {e}")

print("Verification complete.")
