"""
Geometry Cleanup Module

Performs snap/merge of endpoints, collinear segment merging, and gap closing
to prepare geometry for region extraction.
"""
from typing import List, Tuple, Dict, Set
from dataclasses import dataclass
import math
from collections import defaultdict


@dataclass(slots=True)
class Point:
    x: float
    y: float
    
    def __hash__(self):
        return hash((round(self.x, 6), round(self.y, 6)))

    def distance_to(self, other: 'Point') -> float:
        return math.hypot(self.x - other.x, self.y - other.y)
    
    def __eq__(self, other):
        return (round(self.x, 6), round(self.y, 6)) == (round(other.x, 6), round(other.y, 6))
    
    def distance_to(self, other: 'Point') -> float:
        return math.sqrt((self.x - other.x)**2 + (self.y - other.y)**2)


@dataclass(slots=True)
class Segment:
    start: Point
    end: Point
    layer: str = ""
    entity_type: str = ""
    
    @property
    def length(self) -> float:
        return self.start.distance_to(self.end)
    
    @property
    def angle(self) -> float:
        """Return angle in radians (-π to π)"""
        return math.atan2(self.end.y - self.start.y, self.end.x - self.start.x)
    
    @property
    def midpoint(self) -> Point:
        return Point((self.start.x + self.end.x) / 2, (self.start.y + self.end.y) / 2)


def snap_vertices(segments: List[Segment], tolerance: float = 0.01) -> List[Segment]:
    """
    Snap vertices that are within tolerance to create connected geometry.
    Uses spatial clustering to efficiently find nearby points.
    
    Args:
        segments: List of line segments
        tolerance: Distance threshold for snapping (default 1cm)
    
    Returns:
        Segments with snapped vertices
    """
    if not segments:
        return segments
    
    # Extract all unique points
    all_points = []
    for seg in segments:
        all_points.extend([seg.start, seg.end])
    
    # Build spatial grid for efficient lookup
    grid: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    grid_size = tolerance * 2
    
    for i, pt in enumerate(all_points):
        cell = (int(pt.x / grid_size), int(pt.y / grid_size))
        grid[cell].append(i)
    
    # Find clusters of nearby points
    point_to_cluster: Dict[int, int] = {}
    cluster_centroids: Dict[int, Point] = {}
    cluster_id = 0
    
    for i, pt in enumerate(all_points):
        if i in point_to_cluster:
            continue
        
        # Find all points within tolerance
        cell = (int(pt.x / grid_size), int(pt.y / grid_size))
        nearby_indices = []
        
        # Check neighboring cells
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                neighbor_cell = (cell[0] + dx, cell[1] + dy)
                for j in grid[neighbor_cell]:
                    if pt.distance_to(all_points[j]) <= tolerance:
                        nearby_indices.append(j)
        
        # Merge into cluster
        cluster_points = [all_points[j] for j in nearby_indices]
        centroid_x = sum(p.x for p in cluster_points) / len(cluster_points)
        centroid_y = sum(p.y for p in cluster_points) / len(cluster_points)
        
        for j in nearby_indices:
            point_to_cluster[j] = cluster_id
        cluster_centroids[cluster_id] = Point(centroid_x, centroid_y)
        cluster_id += 1
    
    # Create new segments with snapped vertices
    snapped_segments = []
    point_index = 0
    
    for seg in segments:
        start_cluster = point_to_cluster[point_index]
        end_cluster = point_to_cluster[point_index + 1]
        
        new_start = cluster_centroids[start_cluster]
        new_end = cluster_centroids[end_cluster]
        
        # Only keep segment if start and end are different
        if start_cluster != end_cluster:
            snapped_segments.append(Segment(
                start=new_start,
                end=new_end,
                layer=seg.layer,
                entity_type=seg.entity_type
            ))
        
        point_index += 2
    
    return snapped_segments



def merge_collinear(segments: List[Segment], angle_tolerance: float = 0.5) -> List[Segment]:
    """
    Merge collinear segments that are connected and within angle tolerance.
    """
    from shapely.strtree import STRtree
    from shapely.geometry import LineString
    
    if not segments:
        return segments
    
    # Optimization: Skip for very large datasets if mostly short segments?
    # No, we need it. Use STRtree.
    
    # Convert to shapely line strings for indexing
    shapely_lines = []
    for i, seg in enumerate(segments):
        shapely_lines.append(LineString([(seg.start.x, seg.start.y), (seg.end.x, seg.end.y)]))
    
    # Check if STRtree is available/working
    try:
        tree = STRtree(shapely_lines)
    except Exception as e:
        print(f"[Cleanup] STRtree init failed: {e}. Skipping collinear merge.")
        return segments

    angle_tolerance_rad = math.radians(angle_tolerance)
    merged = []
    used = set()
    
    for i, seg1 in enumerate(segments):
        if i in used:
            continue
        
        # Normalize angle
        angle1 = seg1.angle % math.pi
        
        # Find chain
        chain = [seg1]
        used.add(i)
        
        # Queue of segments to check (BFS for connected collinear)
        # Actually, simpler: just find all overlapping/touching in tree, filter by angle
        # But we need to chain them (A touches B, B touches C -> A-B-C)
        
        # Iterative expansion
        current_chain_indices = {i}
        queue = [i]
        
        while queue:
            curr_idx = queue.pop(0)
            curr_seg = segments[curr_idx]
            curr_angle = curr_seg.angle % math.pi
            curr_geom = shapely_lines[curr_idx]
            
            # Query tree for spatial candidates (touching/overlapping)
            # STRtree query returns indices
            candidates = tree.query(curr_geom)
            
            for cand_idx in candidates:
                if cand_idx in used or cand_idx in current_chain_indices:
                    continue
                
                seg2 = segments[cand_idx]
                
                # Check Angle
                angle2 = seg2.angle % math.pi
                angle_diff = abs(curr_angle - angle2)
                if angle_diff > math.pi / 2:
                    angle_diff = math.pi - angle_diff
                
                if angle_diff > angle_tolerance_rad:
                    continue
                
                # Check endpoint connectivity (strict)
                # STRtree is bounding box, check exact intersection
                # We assume snap_vertices ran before, so endpoints match exactly
                s1, e1 = curr_seg.start, curr_seg.end
                s2, e2 = seg2.start, seg2.end
                
                connected = (s1 == s2 or s1 == e2 or e1 == s2 or e1 == e2)
                
                if connected:
                    chain.append(seg2)
                    used.add(cand_idx)
                    current_chain_indices.add(cand_idx)
                    queue.append(cand_idx)

        # Merge chain
        all_points = []
        for seg in chain:
            all_points.extend([seg.start, seg.end])
            
        if len(chain) == 1:
            merged.append(chain[0])
        else:
             # Find most distant pair in chain points
             # Optimization: project to 1D line defined by first segment
             # p_proj = p.x * cos(a) + p.y * sin(a)
             # Sort by projection
             a = chain[0].angle
             cos_a, sin_a = math.cos(a), math.sin(a)
             
             sorted_points = sorted(all_points, key=lambda p: p.x * cos_a + p.y * sin_a)
             start_pt = sorted_points[0]
             end_pt = sorted_points[-1]
             
             merged.append(Segment(
                start=start_pt,
                end=end_pt,
                layer=chain[0].layer,
                entity_type="MERGED"
             ))

    return merged


def close_small_gaps(segments: List[Segment], max_gap: float = 0.05) -> List[Segment]:
    """
    Extend segments to close small gaps, creating closed polygons.
    
    Args:
        segments: List of line segments
        max_gap: Maximum gap to close (default 5cm)
    
    Returns:
        Segments with small gaps closed via new connecting segments
    """
    if not segments:
        return segments
    
    # Find all endpoints
    endpoints = []
    for i, seg in enumerate(segments):
        endpoints.append((seg.start, i, 'start'))
        endpoints.append((seg.end, i, 'end'))
    
    # Find "dangling" endpoints (only connected to one segment)
    point_connections: Dict[Tuple[float, float], List[Tuple[int, str]]] = defaultdict(list)
    for pt, seg_idx, end_type in endpoints:
        key = (round(pt.x, 4), round(pt.y, 4))
        point_connections[key].append((seg_idx, end_type))
    
    dangling = []
    for key, connections in point_connections.items():
        if len(connections) == 1:
            seg_idx, end_type = connections[0]
            pt = segments[seg_idx].start if end_type == 'start' else segments[seg_idx].end
            dangling.append((pt, seg_idx))
    
    # Find pairs of dangling endpoints that are close
    additional_segments = []
    
    # Optimization: Use STRtree for spatial query
    from shapely.strtree import STRtree
    from shapely.geometry import Point as ShapelyPoint

    if not dangling:
        return segments + additional_segments

    # Create Shapely points for search
    dangle_points = [ShapelyPoint(pt.x, pt.y) for pt, _ in dangling]
    
    try:
        tree = STRtree(dangle_points)
    except Exception:
        # Fallback if tree fails
        return segments 
        
    used_dangles = set()
    
    for i, (pt1, seg1) in enumerate(dangling):
        if i in used_dangles:
            continue
            
        pt1_geom = dangle_points[i]
        
        # Query tree for candidates within max_gap
        # STRtree query is bbox based, but for points bbox is point.
        # We need to buffer or just check all results.
        # buffer(max_gap) is expensive.
        # STRtree interaction: query(geom). 
        # tree.query(geom) returns indices of geometries that intersect geom's envelope.
        
        # To find points within distance, query with buffered point
        search_area = pt1_geom.buffer(max_gap)
        candidate_indices = tree.query(search_area)
        
        for j in candidate_indices:
            if j <= i or j in used_dangles:
                continue
            
            # Check actul segment (don't connect same segment ends - handled by dangling check which splits ends)
            # Actually dangling check allowed both ends of same segment IF both are dangling.
            (pt2, seg2) = dangling[j]
            
            if seg1 == seg2:
                continue
                
            dist = pt1.distance_to(pt2)
            if dist <= max_gap and dist > 0.001:
                additional_segments.append(Segment(
                    start=pt1,
                    end=pt2,
                    layer="GAP_CLOSE",
                    entity_type="GAP_CLOSE"
                ))
                used_dangles.add(i)
                used_dangles.add(j)
                break

    return segments + additional_segments


def cleanup_geometry(
    segments: List[Segment],
    snap_tolerance: float = 0.01,
    merge_collinear_enabled: bool = True,
    close_gaps: bool = True,
    max_gap: float = 0.05
) -> List[Segment]:
    """
    Main cleanup function - applies all geometry cleanup operations.
    
    Args:
        segments: Raw input segments
        snap_tolerance: Vertex snapping tolerance (meters)
        merge_collinear_enabled: Whether to merge collinear segments
        close_gaps: Whether to auto-close small gaps
        max_gap: Maximum gap size to close (meters)
    
    Returns:
        Cleaned geometry ready for region extraction
    """
    print(f"[Cleanup] Starting with {len(segments)} segments")
    
    # Step 1: Snap vertices
    result = snap_vertices(segments, tolerance=snap_tolerance)
    print(f"[Cleanup] After snapping: {len(result)} segments")
    
    # Step 2: Merge collinear segments
    if merge_collinear_enabled:
        result = merge_collinear(result, angle_tolerance=0.5)
        print(f"[Cleanup] After merging collinear: {len(result)} segments")
    
    # Step 3: Close small gaps
    if close_gaps:
        result = close_small_gaps(result, max_gap=max_gap)
        print(f"[Cleanup] After closing gaps: {len(result)} segments")
    
    # Filter out zero-length segments
    result = [seg for seg in result if seg.length > 0.001]
    print(f"[Cleanup] Final: {len(result)} segments")
    
    return result
