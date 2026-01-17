"""
Geometry Cleanup Module

Performs snap/merge of endpoints, collinear segment merging, and gap closing
to prepare geometry for region extraction.
"""
from typing import List, Tuple, Dict, Set
from dataclasses import dataclass
import math
from collections import defaultdict


@dataclass
class Point:
    x: float
    y: float
    
    def __hash__(self):
        return hash((round(self.x, 6), round(self.y, 6)))
    
    def __eq__(self, other):
        return (round(self.x, 6), round(self.y, 6)) == (round(other.x, 6), round(other.y, 6))
    
    def distance_to(self, other: 'Point') -> float:
        return math.sqrt((self.x - other.x)**2 + (self.y - other.y)**2)


@dataclass
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
    Merge segments that are nearly collinear (same line, adjacent or overlapping).
    
    Args:
        segments: List of line segments
        angle_tolerance: Maximum angle difference in degrees to consider collinear
    
    Returns:
        Merged segments
    """
    if not segments:
        return segments
    
    angle_tolerance_rad = math.radians(angle_tolerance)
    merged = []
    used = set()
    
    for i, seg1 in enumerate(segments):
        if i in used:
            continue
        
        # Normalize angle to [0, π) for comparison (lines, not rays)
        angle1 = seg1.angle % math.pi
        
        # Find all collinear segments that share an endpoint
        chain = [seg1]
        used.add(i)
        
        changed = True
        while changed:
            changed = False
            for j, seg2 in enumerate(segments):
                if j in used:
                    continue
                
                angle2 = seg2.angle % math.pi
                angle_diff = abs(angle1 - angle2)
                if angle_diff > math.pi / 2:
                    angle_diff = math.pi - angle_diff
                
                if angle_diff > angle_tolerance_rad:
                    continue
                
                # Check if they share an endpoint
                endpoints1 = {(round(chain[-1].start.x, 4), round(chain[-1].start.y, 4)),
                              (round(chain[-1].end.x, 4), round(chain[-1].end.y, 4)),
                              (round(chain[0].start.x, 4), round(chain[0].start.y, 4)),
                              (round(chain[0].end.x, 4), round(chain[0].end.y, 4))}
                endpoints2 = {(round(seg2.start.x, 4), round(seg2.start.y, 4)),
                              (round(seg2.end.x, 4), round(seg2.end.y, 4))}
                
                if endpoints1 & endpoints2:
                    chain.append(seg2)
                    used.add(j)
                    changed = True
        
        # Merge chain into single segment (use extreme points)
        all_points = []
        for seg in chain:
            all_points.extend([seg.start, seg.end])
        
        # Project points onto line and find extremes
        if len(chain) == 1:
            merged.append(chain[0])
        else:
            # Find the two most distant points
            max_dist = 0
            best_pair = (chain[0].start, chain[0].end)
            for p1 in all_points:
                for p2 in all_points:
                    d = p1.distance_to(p2)
                    if d > max_dist:
                        max_dist = d
                        best_pair = (p1, p2)
            
            merged.append(Segment(
                start=best_pair[0],
                end=best_pair[1],
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
    used_dangles = set()
    
    for i, (pt1, seg1) in enumerate(dangling):
        if i in used_dangles:
            continue
        
        for j, (pt2, seg2) in enumerate(dangling):
            if j <= i or j in used_dangles:
                continue
            if seg1 == seg2:
                continue
            
            dist = pt1.distance_to(pt2)
            if dist <= max_gap and dist > 0.001:  # Don't connect already-connected points
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
