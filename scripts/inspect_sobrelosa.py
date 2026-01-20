
import ezdxf
import sys
import pandas as pd

def inspect_layer(dxf_path, target_layer):
    try:
        doc = ezdxf.readfile(dxf_path)
        msp = doc.modelspace()
        
        print(f"--- Inspecting Layer: {target_layer} ---")
        
        entities = msp.query(f'*[layer=="{target_layer}"]')
        print(f"Total Entities: {len(entities)}")
        
        types = {}
        closed_polys = 0
        open_polys = 0
        
        for e in entities:
            etype = e.dxftype()
            types[etype] = types.get(etype, 0) + 1
            
            if etype in ['LWPOLYLINE', 'POLYLINE']:
                if e.is_closed:
                    closed_polys += 1
                else:
                    open_polys += 1
                    
        print("Entity Types:")
        for t, c in types.items():
            print(f"  {t}: {c}")
            
        print(f"Polylines: Closed={closed_polys}, Open={open_polys}")
        
        # Check for other candidates
        print("\n--- Searching for 'losa' in other layers ---")
        for layer in doc.layers:
            if 'losa' in layer.dxf.name.lower():
                print(f"Found candidate: {layer.dxf.name}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_layer(sys.argv[1], "FA_0.20")
