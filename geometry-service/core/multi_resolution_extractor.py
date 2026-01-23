"""
Multi-Resolution Region Extractor

Extracts geometric regions at multiple levels of detail to handle different
types of items appropriately:

- COARSE (>10m²): Large areas like floors, slabs, large rooms
- MEDIUM (1-10m²): Medium areas like small rooms, wall sections
- FINE (<1m²): Small details like fixtures, openings, patches

This prevents large floor slabs from matching to tiny detail regions and vice versa.
"""

import logging
from typing import List, Dict, Tuple
from shapely.geometry import MultiLineString, LineString, Polygon, shape
from shapely.ops import unary_union, polygonize
import numpy as np

logger = logging.getLogger(__name__)


class MultiResolutionExtractor:
    """Extracts regions at multiple resolution levels"""
    
    def __init__(
        self,
        coarse_threshold: float = 10.0,
        medium_threshold: float = 1.0,
        coarse_tolerance: float = 0.1,
        medium_tolerance: float = 0.01,
        fine_tolerance: float = 0.001
    ):
        """
        Args:
            coarse_threshold: Min area for coarse regions (m²)
            medium_threshold: Min area for medium regions (m²)
            coarse_tolerance: Buffer tolerance for coarse extraction (m)
            medium_tolerance: Buffer tolerance for medium extraction (m)
            fine_tolerance: Buffer tolerance for fine extraction (m)
        """
        self.coarse_threshold = coarse_threshold
        self.medium_threshold = medium_threshold
        self.coarse_tolerance = coarse_tolerance
        self.medium_tolerance = medium_tolerance
        self.fine_tolerance = fine_tolerance
    
    def extract_multi_resolution(
        self,
        segments: List,
        layer: str
    ) -> Dict[str, List[Dict]]:
        """
        Extract regions at all three resolutions
        
        Args:
            segments: List of line segments (shapely LineStrings or coordinate lists)
            layer: Layer name for logging
        
        Returns:
            Dict with keys 'coarse', 'medium', 'fine', each containing list of region dicts
        """
        if not segments:
            logger.warning(f"No segments provided for layer {layer}")
            return {'coarse': [], 'medium': [], 'fine': []}
        
        # Convert to shapely LineStrings if needed
        line_strings = []
        for seg in segments:
            if isinstance(seg, LineString):
                line_strings.append(seg)
            elif isinstance(seg, (list, tuple)) and len(seg) >= 2:
                try:
                    line_strings.append(LineString(seg))
                except Exception as e:
                    logger.warning(f"Failed to create LineString: {e}")
                    continue
        
        if not line_strings:
            logger.warning(f"No valid line strings for layer {layer}")
            return {'coarse': [], 'medium': [], 'fine': []}
        
        logger.info(f"Extracting multi-resolution regions for layer {layer} ({len(line_strings)} segments)")
        
        # Extract at each resolution
        coarse_regions = self._extract_at_resolution(
            line_strings, 'coarse', self.coarse_tolerance, self.coarse_threshold, layer
        )
        
        medium_regions = self._extract_at_resolution(
            line_strings, 'medium', self.medium_tolerance, self.medium_threshold, layer
        )
        
        fine_regions = self._extract_at_resolution(
            line_strings, 'fine', self.fine_tolerance, 0.0, layer  # No area threshold for fine
        )
        
        logger.info(
            f"Layer {layer}: Extracted {len(coarse_regions)} coarse, "
            f"{len(medium_regions)} medium, {len(fine_regions)} fine regions"
        )
        
        return {
            'coarse': coarse_regions,
            'medium': medium_regions,
            'fine': fine_regions
        }
    
    def _extract_at_resolution(
        self,
        line_strings: List[LineString],
        resolution: str,
        tolerance: float,
        min_area: float,
        layer: str
    ) -> List[Dict]:
        """Extract regions at a specific resolution level"""
        try:
            # Create MultiLineString
            multi_ls = MultiLineString(line_strings)
            
            # Buffer to close small gaps
            if tolerance > 0:
                buffered = multi_ls.buffer(tolerance)
            else:
                buffered = multi_ls
            
            # Try to extract polygons
            if hasattr(buffered, 'geoms'):
                polygons = list(buffered.geoms)
            elif isinstance(buffered, Polygon):
                polygons = [buffered]
            else:
                # Try polygonize as fallback
                polygons = list(polygonize(line_strings))
            
            # Filter by area and convert to dicts
            regions = []
            for i, poly in enumerate(polygons):
                if not isinstance(poly, Polygon) or not poly.is_valid:
                    continue
                
                area = poly.area
                
                # Filter by minimum area
                if area < min_area:
                    continue
                
                # Additional filtering by resolution
                if resolution == 'coarse' and area < self.coarse_threshold:
                    continue
                elif resolution == 'medium' and (area < self.medium_threshold or area >= self.coarse_threshold):
                    continue
                elif resolution == 'fine' and area >= self.medium_threshold:
                    continue
                
                # Extract bounding box
                bounds = poly.bounds  # (minx, miny, maxx, maxy)
                
                # Extract vertices
                try:
                    vertices = list(poly.exterior.coords)
                except Exception:
                    vertices = []
                
                # Calculate centroid
                centroid = poly.centroid
                
                regions.append({
                    'id': f"{layer}_{resolution}_{i}",
                    'layer': layer,
                    'resolution': resolution,
                    'area': round(area, 4),
                    'vertices': vertices,
                    'bounding_box': {
                        'min_x': bounds[0],
                        'min_y': bounds[1],
                        'max_x': bounds[2],
                        'max_y': bounds[3]
                    },
                    'centroid': {
                        'x': centroid.x,
                        'y': centroid.y
                    },
                    'polygon': poly  # Keep shapely object for further processing
                })
            
            return regions
            
        except Exception as e:
            logger.error(f"Failed to extract {resolution} regions for layer {layer}: {e}")
            return []
    
    def merge_resolutions(
        self,
        multi_res_regions: Dict[str, List[Dict]],
        prefer_resolution: str = 'coarse'
    ) -> List[Dict]:
        """
        Merge regions from all resolutions, removing duplicates
        
        Args:
            multi_res_regions: Dict from extract_multi_resolution
            prefer_resolution: Which resolution to prefer for overlaps ('coarse', 'medium', 'fine')
        
        Returns:
            Merged list of regions with duplicates removed
        """
        # Priority order based on preference
        if prefer_resolution == 'coarse':
            priority = ['coarse', 'medium', 'fine']
        elif prefer_resolution == 'fine':
            priority = ['fine', 'medium', 'coarse']
        else:
            priority = ['medium', 'coarse', 'fine']
        
        merged = []
        seen_areas = set()
        
        for res in priority:
            for region in multi_res_regions.get(res, []):
                area_key = (region['layer'], round(region['area'], 2))
                
                if area_key not in seen_areas:
                    merged.append(region)
                    seen_areas.add(area_key)
        
        logger.info(f"Merged regions: {len(merged)} unique regions from {sum(len(v) for v in multi_res_regions.values())} total")
        
        return merged


# Convenience function
def extract_regions_multi_res(
    segments: List,
    layer: str,
   coarse_threshold: float = 10.0,
    medium_threshold: float = 1.0
) -> Dict[str, List[Dict]]:
    """
    Extract regions at multiple resolutions
    
    Args:
        segments: Line segments
        layer: Layer name
        coarse_threshold: Minimum area for coarse regions
        medium_threshold: Minimum area for medium regions
    
    Returns:
        Dict with 'coarse', 'medium', 'fine' keys
    """
    extractor = MultiResolutionExtractor(
        coarse_threshold=coarse_threshold,
        medium_threshold=medium_threshold
    )
    return extractor.extract_multi_resolution(segments, layer)
