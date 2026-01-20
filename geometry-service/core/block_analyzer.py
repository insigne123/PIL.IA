
"""
Block Analyzer Module
Analyses DXF Block Definitions to extract metadata (Area, Dimensions, BBox).
Enabled "Block Cubication" (e.g. 50 Light Fixtures * 0.36m2/each)
"""
import ezdxf
from ezdxf.entities import Hatch, LWPolyline, Polyline
import math
from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)

def analyze_blocks(doc) -> Dict[str, Any]:
    """
    Iterate over all BLOCK definitions in the DXF document.
    Compute:
    - Dimensions (Width, Height)
    - Geometry Area (from Hatches/Closed Polylines)
    - BBox Area
    
    Returns:
        Dict[block_name, {area: float, width: float, height: float, source: str}]
    """
    block_stats = {}
    
    if not doc.blocks:
        return block_stats
        
    for block in doc.blocks:
        name = block.name
        
        # Skip layout blocks and anonymous blocks mostly used for dimensions
        if name.startswith('*') or name.startswith('$'):
             continue
             
        # Initialize stats
        min_x, min_y = float('inf'), float('inf')
        max_x, max_y = float('-inf'), float('-inf')
        geo_area = 0.0
        has_geometry = False
        
        for entity in block:
            # 1. BBox Calculation
            try:
                # ezdxf 1.x has bounding_box method for most entities
                # For older versions or complex entities, might need manual calc
                if hasattr(entity, 'bounding_box'):
                    extents = entity.bounding_box(block)
                else:
                    # Fallback for simple entities
                    if entity.dxftype() == 'LINE':
                        extents = (min(entity.dxf.start.x, entity.dxf.end.x),
                                   min(entity.dxf.start.y, entity.dxf.end.y),
                                   max(entity.dxf.start.x, entity.dxf.end.x),
                                   max(entity.dxf.start.y, entity.dxf.end.y))
                    else:
                        extents = None
                        
                if extents:
                    min_x = min(min_x, extents.extmin.x if hasattr(extents, 'extmin') else extents[0])
                    min_y = min(min_y, extents.extmin.y if hasattr(extents, 'extmin') else extents[1])
                    max_x = max(max_x, extents.extmax.x if hasattr(extents, 'extmax') else extents[2])
                    max_y = max(max_y, extents.extmax.y if hasattr(extents, 'extmax') else extents[3])
                    has_geometry = True
            except Exception:
                pass

            # 2. Area Calculation (Accumulate closed geometry)
            try:
                if entity.dxftype() == 'HATCH':
                    # Use ezdxf helper if available, or simplified approximation
                    # Hatch area calculation is complex. 
                    # For now, we trust the hatch's area property if it exists? 
                    # ezdxf doesn't always compute it.
                    
                    # ezdxf >= 1.1 has area method for hatch?
                    if hasattr(entity, 'area'):
                         geo_area += entity.area
                         has_geometry = True
                    
                elif entity.dxftype() in ('LWPOLYLINE', 'POLYLINE'):
                     if entity.is_closed:
                         # Shoelace formula
                         points = list(entity.get_points(format='xy'))
                         if len(points) > 2:
                             s = 0.0
                             for i in range(len(points)):
                                 j = (i + 1) % len(points)
                                 s += points[i][0] * points[j][1]
                                 s -= points[j][0] * points[i][1]
                             geo_area += abs(s) * 0.5
                             has_geometry = True
            except Exception:
                pass
                
        if has_geometry:
            width = max(0, max_x - min_x)
            height = max(0, max_y - min_y)
            bbox_area = width * height
            
            # Decide best area to report
            # If we have explicit geometry area (Filled region), prefer it.
            # Else use BBox area (Rectangular approximation)
            
            final_area = geo_area if geo_area > 0.0001 else bbox_area
            source = 'geometry' if geo_area > 0.0001 else 'bbox'
            
            # Filter negligible blocks (points/lines only)
            if final_area > 0.0001:
                block_stats[name] = {
                    'area': final_area,
                    'width': width,
                    'height': height,
                    'source': source
                }
                
    logger.info(f"Analyzed {len(block_stats)} blocks for area intelligence.")
    return block_stats
