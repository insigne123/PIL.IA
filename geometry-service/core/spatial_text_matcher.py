"""
Spatial Text Matcher

Associates text labels with geometric regions based on spatial proximity.
Used by semantic classifier to improve classification accuracy.

Key features:
- Proximity-based text-to-region association
- Relevance scoring by distance
- Spatial indexing for performance (optional Rtree)
"""

import logging
from typing import List, Dict, Tuple, Optional
from shapely.geometry import Polygon, Point, box
import numpy as np

logger = logging.getLogger(__name__)

# Try to import Rtree for spatial indexing (optional dependency)
try:
    from rtree import index
    HAS_RTREE = True
except ImportError:
    HAS_RTREE = False
    logger.warning("Rtree not available, falling back to brute-force spatial search")


class SpatialTextMatcher:
    """Associates text labels with geometric regions using spatial proximity"""
    
    def __init__(self, max_distance: float = 5.0, use_spatial_index: bool = True):
        """
        Args:
            max_distance: Maximum distance (in DXF units, typically meters) to associate text
            use_spatial_index: Use Rtree spatial index if available (faster for large datasets)
        """
        self.max_distance = max_distance
        self.use_spatial_index = use_spatial_index and HAS_RTREE
        self.idx = None
    
    def associate_texts_to_regions(
        self,
        regions: List[Dict],
        texts: List[Dict]
    ) -> List[Dict]:
        """
        Associate text labels to regions based on spatial proximity
        
        Args:
            regions: List of dicts with 'id', 'polygon' (Shapely Polygon or vertices list)
            texts: List of dicts with 'content', 'position' (x, y, z tuple)
        
        Returns:
            regions with added 'associated_texts' field containing relevant text labels
        """
        if not texts:
            logger.debug("No texts provided, skipping text association")
            return [{**r, 'associated_texts': []} for r in regions]
        
        # Build spatial index if requested
        if self.use_spatial_index:
            self._build_spatial_index(regions)
        
        results = []
        
        for region in regions:
            polygon = self._get_polygon(region)
            if not polygon or not polygon.is_valid:
                logger.warning(f"Invalid polygon for region {region.get('id', 'unknown')}, skipping")
                results.append({**region, 'associated_texts': []})
                continue
            
            # Find texts near this region
            associated = self._find_texts_for_region(polygon, texts, region.get('id'))
            
            results.append({
                **region,
                'associated_texts': associated
            })
        
        logger.info(
            f"Associated texts to {len(results)} regions. "
            f"Avg texts per region: {np.mean([len(r['associated_texts']) for r in results]):.1f}"
        )
        
        return results
    
    def _get_polygon(self, region: Dict) -> Optional[Polygon]:
        """Extract Shapely Polygon from region dict"""
        # Check if already a polygon
        if isinstance(region.get('polygon'), Polygon):
            return region['polygon']
        
        # Try to construct from vertices
        vertices = region.get('vertices')
        if vertices and len(vertices) >= 3:
            try:
                return Polygon(vertices)
            except Exception as e:
                logger.error(f"Failed to create polygon from vertices: {e}")
                return None
        
        # Try bounding box
        bbox = region.get('bounding_box')
        if bbox:
            try:
                return box(bbox['min_x'], bbox['min_y'], bbox['max_x'], bbox['max_y'])
            except Exception as e:
                logger.error(f"Failed to create polygon from bbox: {e}")
                return None
        
        return None
    
    def _build_spatial_index(self, regions: List[Dict]):
        """Build R-tree spatial index for regions"""
        if not HAS_RTREE:
            return
        
        self.idx = index.Index()
        
        for i, region in enumerate(regions):
            polygon = self._get_polygon(region)
            if polygon:
                bounds = polygon.bounds  # (minx, miny, maxx, maxy)
                self.idx.insert(i, bounds)
        
        logger.debug(f"Built spatial index with {len(regions)} regions")
    
    def _find_texts_for_region(
        self,
        polygon: Polygon,
        all_texts: List[Dict],
        region_id: str = None
    ) -> List[Dict]:
        """Find all texts within max_distance of a region"""
        centroid = polygon.centroid
        centroid_point = Point(centroid.x, centroid.y)
        
        associated_texts = []
        
        for text in all_texts:
            # Get text position
            pos = text.get('position')
            if not pos or len(pos) < 2:
                continue
            
            text_point = Point(pos[0], pos[1])
            
            # Calculate distance (three methods, in order of priority)
            
            # 1. Check if text is INSIDE region (distance = 0)
            if polygon.contains(text_point):
                distance = 0.0
                relationship = 'inside'
            
            # 2. Check distance to centroid
            elif centroid_point.distance(text_point) <= self.max_distance:
                distance = centroid_point.distance(text_point)
                relationship = 'near_centroid'
            
            # 3. Check distance to boundary
            else:
                distance = polygon.exterior.distance(text_point)
                if distance > self.max_distance:
                    continue  # Too far
                relationship = 'near_boundary'
            
            # Calculate relevance score (1.0 = inside, decreases with distance)
            if distance == 0:
                relevance = 1.0
            else:
                relevance = 1.0 / (1.0 + distance)
            
            associated_texts.append({
                'content': text.get('content', '').strip(),
                'distance': round(distance, 2),
                'relevance': round(relevance, 3),
                'relationship': relationship
            })
        
        # Sort by relevance (highest first)
        associated_texts.sort(key=lambda x: x['relevance'], reverse=True)
        
        # Limit to top 10 most relevant texts
        associated_texts = associated_texts[:10]
        
        if associated_texts:
            logger.debug(
                f"Region {region_id or 'unknown'}: Found {len(associated_texts)} texts, "
                f"top: '{associated_texts[0]['content'][:30]}' (rel={associated_texts[0]['relevance']:.2f})"
            )
        
        return associated_texts
    
    def get_stats(self, regions_with_texts: List[Dict]) -> Dict:
        """Get statistics about text associations"""
        total_regions = len(regions_with_texts)
        regions_with_texts_count = sum(1 for r in regions_with_texts if r.get('associated_texts'))
        total_associations = sum(len(r.get('associated_texts', [])) for r in regions_with_texts)
        
        return {
            'total_regions': total_regions,
            'regions_with_texts': regions_with_texts_count,
            'regions_without_texts': total_regions - regions_with_texts_count,
            'total_text_associations': total_associations,
            'avg_texts_per_region': total_associations / total_regions if total_regions > 0 else 0,
            'coverage_pct': (regions_with_texts_count / total_regions * 100) if total_regions > 0 else 0
        }


# Convenience function
def associate_texts(
    regions: List[Dict],
    texts: List[Dict],
    max_distance: float = 5.0
) -> Tuple[List[Dict], Dict]:
    """
    Associate texts to regions and return stats
    
    Args:
        regions: List of region dicts
        texts: List of text dicts
        max_distance: Maximum association distance
    
    Returns:
        (regions_with_texts, stats_dict)
    """
    matcher = SpatialTextMatcher(max_distance=max_distance)
    results = matcher.associate_texts_to_regions(regions, texts)
    stats = matcher.get_stats(results)
    
    logger.info(f"Text association stats: {stats}")
    
    return results, stats
