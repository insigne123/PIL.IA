
"""
Spatial Index Module
Links textual labels (Room Names) to geometric zones (Floor Polygons) using R-Tree.
"""
from typing import List, Optional, Tuple, Dict
from dataclasses import dataclass
from shapely.strtree import STRtree
from shapely.geometry import Polygon, Point as ShapelyPoint
from fitz import Point  # Helper, though we mostly use Shapely
import logging

logger = logging.getLogger(__name__)

@dataclass
class Zone:
    id: str            # Unique ID (e.g., handle/layer)
    name: str          # Name from associated text (e.g., "SALA DE VENTAS")
    polygon: Polygon   # Shapely Polygon
    layer: str         # Layer name
    area: float        # Area in m²
    confidence: float  # Validation confidence

class SpatialIndex:
    def __init__(self, polygons: List[Tuple[Polygon, str, str]]):
        """
        Args:
            polygons: List of (ShapelyPolygon, layer_name, entity_handle)
        """
        self.polygons = []
        self.polygons = []
        self.metadata = {}  # index -> (layer, handle)
        self.geom_map = {}  # id(geom) -> (layer, handle)
        
        valid_polys = []
        for i, (poly, layer, handle) in enumerate(polygons):
            if poly.is_valid and not poly.is_empty:
                valid_polys.append(poly)
                valid_polys.append(poly)
                self.metadata[len(valid_polys)-1] = (layer, handle)
                self.geom_map[id(poly)] = (layer, handle)
        
        self.tree = STRtree(valid_polys) if valid_polys else None
        self.geometries = valid_polys
        logger.info(f"SpatialIndex built with {len(valid_polys)} polygons.")

    def find_zone(self, point_x: float, point_y: float) -> Optional[Dict]:
        """
        Find the smallest polygon containing the point.
        """
        if not self.tree:
            return None
            
        pt = ShapelyPoint(point_x, point_y)
        
        # 1. Query tree for candidates (bounding box intersection)
        candidate_indices = self.tree.query(pt)
        
        # 2. Check strict containment
        matches = []
        for idx in candidate_indices:
            poly = self.geometries[idx]
            if poly.contains(pt):
                layer, handle = self.metadata[idx]
                matches.append({
                    "polygon": poly,
                    "layer": layer,
                    "handle": handle,
                    "area": poly.area
                })
        
        if not matches:
            return None
            
        # 3. Return smallest containing zone (most specific)
        # e.g. text inside a 'room' inside a 'building' -> return 'room'
        matches.sort(key=lambda x: x["area"])
        best = matches[0]
        
        return {
            "name": "Unknown",  # To be filled by caller using the Text content
            "layer": best["layer"],
            "area": best["area"],
            "polygon": best["polygon"]
        }

    def find_nearest_zone(self, point_x: float, point_y: float, max_distance: float = 5.0) -> Optional[Dict]:
        """
        Find the nearest polygon within max_distance.
        Used when strict containment fails.
        """
        if not self.tree:
            return None
            
        pt = ShapelyPoint(point_x, point_y)
        
        # 1. Use nearest neighbor search
        # Note: behavior depends on shapely version. 
        # For robustness, we can query a buffer if we're unsure, but nearest is standard.
        try:
            nearest_geom = self.tree.nearest(pt)
        except Exception:
            # Fallback for older shapely or empty tree
            return None
            
        if not nearest_geom:
            return None
            
        # 2. Check distance
        dist = nearest_geom.distance(pt)
        if dist > max_distance:
            return None
            
        # 3. Find metadata for this geometry
        meta = self.geom_map.get(id(nearest_geom))
        if not meta:
            return None
            
        layer, handle = meta
        
        return {
            "name": "Unknown",
            "layer": layer,
            "handle": handle, # Include handle
            "area": nearest_geom.area,
            "polygon": nearest_geom
        }
        
        # Optimization: Re-use self.metadata which is index -> ...
        # But nearest() returns geom. 
        # Let's search by equality (geometry object identity)
        
        match = None
        for idx, geom in enumerate(self.geometries):
             if geom is nearest_geom: # identity check should work if tree holds refs
                 layer, handle = self.metadata[idx]
                 match = {
                     "polygon": geom,
                     "layer": layer,
                     "handle": handle,
                     "area": geom.area,
                     "distance": dist
                 }
                 break
        
        return match
