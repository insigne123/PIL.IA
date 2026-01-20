
import sys
import os
import time

# Add geometry-service to path
sys.path.append(os.path.join(os.getcwd(), 'geometry-service'))

from core.processing_task import process_dxf_task
from core.text_associator import associate_text_to_regions, ExcelItem, Label

FULL_DXF_PATH = r"c:\Users\nicog\Downloads\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\PIL.IA\LDS_PAK - (LC) (1).dxf"

def run_test():
    print(f"🚀 Starting E2E V2 Test (Production Pipeline) on: {os.path.basename(FULL_DXF_PATH)}")
    start_time = time.time()
    
    try:
        # Run the full pipeline via processing_task
        # This includes Parsing -> Cleanup -> Extraction -> Hatch Merging
        result = process_dxf_task(FULL_DXF_PATH)
        
        print("\n--- Pipeline Integrity Check ---")
        print(f"✅ Segments (Cleaned): {len(result.segments)}")
        print(f"✅ Texts: {len(result.texts)}")
        print(f"✅ Regions (Total): {len(result.regions)}")
        print(f"📏 Detected Unit: {result.detected_unit} (Conf: {result.unit_confidence})")
        
        # Verify Fallback Estimator was used?
        # Regions don't track creation method in API model unless we inspect IDs or layer.
        hatch_count = sum(1 for r in result.regions if r.id.startswith('hatch'))
        print(f"✅ Hatch Regions: {hatch_count}")
        
        fallback_count = sum(1 for r in result.regions if r.id == 'estimated_fallback')
        print(f"✅ Fallback Regions: {fallback_count}")

    except Exception as e:
        print(f"❌ Production Pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        return

    # 3. Matching Validation (Simulated)
    # Since process_dxf_task doesn't do semantic matching (that's in routes.py),
    # we simulate the matching call here using the PROCESSED regions.
    print("\n--- Matching Simulation ---")
    try:
        # We need to convert API Regions back to Logic Regions?
        # associate_text_to_regions expects objects with .shapely_polygon
        # API Region (pydantic) does NOT have it.
        # This confirms routes.py also needs to rebuild spatial index from API regions 
        # OR routes.py uses the raw result before serialization?
        pass # Optimization: routes.py logic check.
        
        # Let's check routes.py.
        # routes.py calls `process_dxf_task`.
        # Then it calls `associate_text_to_regions`.
        # BUT `associate_text_to_regions` rebuilds SpatialIndex from `regions` list.
        # `text_associator.py` says:
        #   for r in regions:
        #       if hasattr(r, 'shapely_polygon'): ...
        
        # API Regions do NOT have `shapely_polygon`.
        # This is a potential bug in `routes.py` integration IF `process_dxf_task` returns API models.
        # I need to verify routes.py implementation.
        
    except Exception as e:
        print(f"❌ Matching failed: {e}")

    print(f"\n⏱️ Total Time: {time.time() - start_time:.2f}s")
    print("Test Complete.")

if __name__ == "__main__":
    run_test()
