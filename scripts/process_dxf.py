import sys
import json
import ezdxf
import math
from ezdxf.math import Vec3
from collections import defaultdict
import uuid

# Helper to calculate polygon area (Shoelace formula)
def calculate_polygon_area(vertices):
    n = len(vertices)
    if n < 3: return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += vertices[i].x * vertices[j].y
        area -= vertices[j].x * vertices[i].y
    return abs(area) / 2.0

# Conversion factors to Metros
UNIT_FACTORS = {
    1: 0.0254,      # Inches
    2: 0.3048,      # Feet
    4: 0.001,       # Millimeters
    5: 0.01,        # Centimeters
    6: 1.0,         # Meters
    0: 1.0          # Unitless (assume meters)
}

def get_unit_factor(doc):
    try:
        # Check header variable $INSUNITS
        if '$INSUNITS' in doc.header:
            units = doc.header['$INSUNITS']
            # If units is 0 (Unspecified), try to guess or default to Meters
            # Many architects draw in Meters but leave units as 0 or 4 (mm) incorrectly.
            # But let's trust the declared unit first, or fallback to 1.0
            return UNIT_FACTORS.get(units, 1.0), units
    except:
        pass
    return 1.0, 0

def process_entity(entity, stats, items, unit_factor):
    layer = entity.dxf.layer.lower()
    
    # Pre-calculate scaling factors
    len_factor = unit_factor
    area_factor = unit_factor * unit_factor
    
    # --- AREAS (Hatch, Closed Polyline) ---
    if entity.dxftype() == 'HATCH':
        area_raw = entity.area if hasattr(entity, 'area') else 0
        area_si = area_raw * area_factor
        
        if area_si > 0:
            stats[layer]['area'] += area_si
            stats[layer]['count'] += 1
            
            items.append({
                "id": str(uuid.uuid4()),
                "type": "area",
                "layer_raw": entity.dxf.layer,
                "layer_normalized": layer,
                "value_si": area_si, 
                "value_raw": area_raw,
                "evidence": "HATCH",
                "color": entity.dxf.color # Index 1-255
            })

    elif entity.dxftype() in ('LWPOLYLINE', 'POLYLINE'):
        is_closed = entity.is_closed
        points = list(entity.vertices())
        
        # Calculate Length
        length_raw = 0.0
        # Try to use ezdxf helper or manual
        if hasattr(entity, 'length'): 
             length_raw = entity.length - 0 # Force float?
        else:
             # Basic implementation for polylines if entity.length missing in old ezdxf
             # Skipping complex manual calc for brevity unless needed
             pass
        
        length_si = length_raw * len_factor
        stats[layer]['length'] += length_si
        
        # Calculate Area if Closed
        if is_closed and len(points) >= 3:
            # Normalize points
            clean_points = []
            for p in points:
                if isinstance(p, (tuple, list)):
                    clean_points.append(Vec3(p[0], p[1], 0))
                else:
                    clean_points.append(p)
            
            area_raw = calculate_polygon_area(clean_points)
            area_si = area_raw * area_factor
            
            if area_si > 0:
                stats[layer]['area'] += area_si
                items.append({
                    "id": str(uuid.uuid4()),
                    "type": "area",
                    "layer_raw": entity.dxf.layer,
                    "layer_normalized": layer,
                    "value_si": area_si,
                    "value_raw": area_raw,
                    "evidence": "POLYLINE",
                    "color": entity.dxf.color
                })

    # --- LENGTHS (Line, Arc, Spline) ---
    elif entity.dxftype() == 'LINE':
        length_raw = entity.dxf.start.distance(entity.dxf.end)
        length_si = length_raw * len_factor
        
        stats[layer]['length'] += length_si
        stats[layer]['count'] += 1
        
        items.append({
            "id": str(uuid.uuid4()),
            "type": "length",
            "layer_raw": entity.dxf.layer,
            "layer_normalized": layer,
            "value_si": length_si,
            "value_raw": length_raw,
            "evidence": "LINE",
            "color": entity.dxf.color
        })

    # --- BLOCKS (Insert) ---
    elif entity.dxftype() == 'INSERT':
        stats[layer]['blocks'] += 1
        block_name = entity.dxf.name
        
        items.append({
            "id": str(uuid.uuid4()),
            "type": "block",
            "name_raw": block_name,
            "layer_raw": entity.dxf.layer,
            "layer_normalized": layer,
            "value_si": 1,
            "value_raw": 1,
            "evidence": "INSERT",
            "color": entity.dxf.color
        })
        
    # --- TEXT (Text, MText) ---
    elif entity.dxftype() in ('TEXT', 'MTEXT'):
        text = entity.dxf.text if hasattr(entity.dxf, 'text') else ""
        if text:
            items.append({
                "id": str(uuid.uuid4()),
                "type": "text",
                "name_raw": text,
                "layer_raw": entity.dxf.layer,
                "layer_normalized": layer,
                "value_si": 0,
                "evidence": entity.dxftype(),
                "position": { 
                    "x": entity.dxf.insert.x * len_factor, 
                    "y": entity.dxf.insert.y * len_factor 
                }
            })

def process_dxf(file_path):
    try:
        doc = ezdxf.readfile(file_path)
        msp = doc.modelspace()
        
        # Get Unit Scaling Factor
        unit_factor, unit_code = get_unit_factor(doc)
        
        # Log factor (via stderr to not pollute stdout JSON)
        sys.stderr.write(f"Detected Units: {unit_code}, Factor to Meters: {unit_factor}\n")
        
        stats = defaultdict(lambda: {'area': 0.0, 'length': 0.0, 'count': 0, 'blocks': 0})
        items = []

        for entity in msp:
            process_entity(entity, stats, items, unit_factor)
            
        result = {
            "status": "success",
            "stats": stats,
            "items": items,
            "metadata": {
                "dxf_version": doc.dxfversion,
                "units_code": unit_code,
                "conversion_factor": unit_factor,
                "total_entities": len(items)
            }
        }
        
        print(json.dumps(result))

        
    except Exception as e:
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No file path provided"}))
        sys.exit(1)
        
    process_dxf(sys.argv[1])
