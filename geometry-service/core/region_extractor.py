"""
Region Extractor - Planar Graph Face Detection

Extracts closed regions (polygons) from line segments using graph theory.
This is the core algorithm that enables measuring areas from fragmented geometry.
"""
import networkx as nx
from shapely.geometry import Polygon, LineString, Point as ShapelyPoint
from shapely.ops import polygonize, unary_union, nearest_points
from shapely.strtree import STRtree
from shapely.geometry import MultiPoint
from typing import List, Tuple, Optional, Set
from dataclasses import dataclass, field
import math
from collections import defaultdict
import uuid


@dataclass
class Point:
    x: float
    y: float
    
    def __hash__(self):
        return hash((round(self.x, 5), round(self.y, 5)))
    
    def __eq__(self, other):
        return (round(self.x, 5), round(self.y, 5)) == (round(other.x, 5), round(other.y, 5))
    
    def to_tuple(self) -> Tuple[float, float]:
        return (self.x, self.y)


@dataclass
class Segment:
    start: Point
    end: Point
    layer: str = ""
    entity_type: str = ""


@dataclass
class Region:
    id: str
    vertices: List[Point]
    area: float
    perimeter: float
    centroid: Point
    shapely_polygon: Polygon = field(repr=False)
    layer: str = "Unknown"
    
    def contains_point(self, point: Point) -> bool:
        """Check if a point is inside this region"""
        sp = ShapelyPoint(point.x, point.y)
        return self.shapely_polygon.contains(sp)
    
    def distance_to_point(self, point: Point) -> float:
        """Get distance from point to nearest boundary"""
        sp = ShapelyPoint(point.x, point.y)
        return self.shapely_polygon.exterior.distance(sp)


def segments_to_linestrings(segments: List[Segment]) -> List[LineString]:
    """Convert segments to Shapely LineStrings"""
    linestrings = []
    for seg in segments:
        if seg.start.x != seg.end.x or seg.start.y != seg.end.y:
            linestrings.append(LineString([
                (seg.start.x, seg.start.y),
                (seg.end.x, seg.end.y)
            ]))
    return linestrings



# Valid layers for force closing
FORCE_CLOSE_LAYERS = {
    "FA_0.20": 0.20,             # Sobrelosa needs larger gap closing
    "a-arq-cielo falso": 0.20,   # Cielos often have gaps
    "a-arq-tabiques": 0.10,      # Walls
    "mb-elev 2": 0.20            # Membrane
}

def force_close_polygons(segments: List[Segment], tolerance: float = 0.05) -> List[Segment]:
    """
    Attempts to close small gaps between segments by adding bridging segments.
    Applies custom tolerance for problematic layers.
    """
    if not segments:
        return []

    # 1. Identify endpoints and apply layer-specific tolerance
    endpoints = set()
    layer_map = {} # Point -> max_tolerance needed

    for seg in segments:
        endpoints.add(seg.start)
        endpoints.add(seg.end)
        
        # Determine tolerance for this segment
        seg_tol = tolerance 
        norm_layer = seg.layer.lower()
        
        # Check explicit layers
        for layer_key, layer_val in FORCE_CLOSE_LAYERS.items():
            if layer_key.lower() in norm_layer:
                seg_tol = max(seg_tol, layer_val)
        
        # Map points to max needed tolerance
        layer_map[seg.start] = max(layer_map.get(seg.start, 0), seg_tol)
        layer_map[seg.end] = max(layer_map.get(seg.end, 0), seg_tol)

    # Use the maximum tolerance found as the grid cell size
    max_tol = max(layer_map.values()) if layer_map else tolerance
    cell_size = max_tol
    
    grid = defaultdict(list)
    points = list(endpoints)
    
    for p in points:
        idx_x = int(p.x / cell_size)
        idx_y = int(p.y / cell_size)
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                grid[(idx_x + dx, idx_y + dy)].append(p)

    new_segments = []
    processed_pairs = set()

    for p1 in points:
        idx_x = int(p1.x / cell_size)
        idx_y = int(p1.y / cell_size)
        
        potential_neighbors = grid[(idx_x, idx_y)]
        p1_tol = layer_map.get(p1, tolerance)

        for p2 in potential_neighbors:
            if p1 == p2:
                continue

            pair_id = tuple(sorted(((p1.x, p1.y), (p2.x, p2.y))))
            if pair_id in processed_pairs:
                continue

            dist = math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2)
            
            # Use the larger of the two point tolerances
            p2_tol = layer_map.get(p2, tolerance)
            effective_tol = max(p1_tol, p2_tol)

            if 0 < dist <= effective_tol:
                processed_pairs.add(pair_id)
                new_segments.append(Segment(
                    start=p1,
                    end=p2,
                    layer="AUTO_CLOSE",
                    entity_type="BRIDGE"
                ))

    if new_segments:
        print(f"[RegionExtractor] Added {len(new_segments)} bridges (Max Tol: {max_tol}m)")
        return segments + new_segments
    
    return segments


def snap_undershoots(segments: List[Segment], tolerance: float = 0.15) -> List[Segment]:
    """
    P2.1: Graph Loop Builder (Noding Strategy)
    Snaps hanging endpoints to the nearest edge (T-Junctions).
    This fixes undershoots where a wall stops just short of another wall.
    """
    if not segments:
        return []
        
    # Create LineStrings for query
    # We map id(LineString) -> Segment to modify
    linestrings = []
    seg_map = {}
    
    for seg in segments:
        ls = LineString([(seg.start.x, seg.start.y), (seg.end.x, seg.end.y)])
        linestrings.append(ls)
        seg_map[id(ls)] = seg
        
    try:
        tree = STRtree(linestrings)
    except Exception:
        # Fallback if STRtree fails or empty
        return segments

    # Collect all endpoints
    endpoints = []
    for seg in segments:
        endpoints.append((seg.start, seg))
        endpoints.append((seg.end, seg))
        
    snapped_count = 0
    
    for pt, owner_seg in endpoints:
        p_shape = ShapelyPoint(pt.x, pt.y)
        
        # Query nearest geometries
        # STRtree.query returns indices or geometries depending on version
        # ezdxf/shapely usage might vary. assuming modern shapely
        try:
            nearest_geoms = tree.query(p_shape)
            # If query returns indices (shapely 2.0)
            if nearest_geoms.dtype != 'object': # numpy array of indices
                 nearest_geoms = [linestrings[i] for i in nearest_geoms]
        except:
             # Old shapely returns list of geoms directly
             pass

        # Find actual nearest point
        best_dist = tolerance
        best_point = None
        
        for geom in nearest_geoms:
            # Skip own segment
            if seg_map.get(id(geom)) == owner_seg:
                continue
                
            # Distance to segment (edge)
            dist = geom.distance(p_shape)
            
            if dist > 0.0001 and dist < best_dist:
                proj_dist = geom.project(p_shape)
                proj_pt = geom.interpolate(proj_dist)
                
                # Verify we are not snapping to an endpoint of the target (that is handled by force_close)
                # We want T-Junctions (mid-point snaps)
                # But allowing endpoint snap is fine too if force_close missed it
                
                best_dist = dist
                best_point = proj_pt

        if best_point:
            # Update coordinate in place (or match)
            pt.x = best_point.x
            pt.y = best_point.y
            snapped_count += 1
            
    # logger.info(f"Snapped {snapped_count} undershoots")
    return segments


def extract_regions_shapely(segments: List[Segment]) -> List[Region]:
    """
    Extract regions using Shapely's polygonize function.
    This is faster but may miss some complex cases.
    """
    # FIX 11.2: Force close small gaps (Endpoint->Endpoint)
    segments = force_close_polygons(segments, tolerance=0.10) 
    
    # P2.1: Graph Loop Builder (Endpoint->Edge)
    segments = snap_undershoots(segments, tolerance=0.15)

    linestrings = segments_to_linestrings(segments)
    
    if not linestrings:
        return []
    
    # Union all lines to handle overlaps
    merged = unary_union(linestrings)
    
    # Polygonize
    polygons = list(polygonize(merged))
    
    regions = []
    for poly in polygons:
        if poly.is_valid and poly.area > 0.01:  # Min 0.01 m²
            centroid = poly.centroid
            vertices = [Point(x, y) for x, y in poly.exterior.coords[:-1]]
            
            regions.append(Region(
                id=str(uuid.uuid4())[:8],
                vertices=vertices,
                area=poly.area,
                perimeter=poly.length,
                centroid=Point(centroid.x, centroid.y),
                shapely_polygon=poly
            ))
    
    return regions


def build_planar_graph(segments: List[Segment]) -> nx.Graph:
    """
    Build a planar graph from line segments.
    Nodes are vertices, edges are segments.
    """
    G = nx.Graph()
    
    for seg in segments:
        start = (round(seg.start.x, 5), round(seg.start.y, 5))
        end = (round(seg.end.x, 5), round(seg.end.y, 5))
        
        if start != end:
            G.add_edge(start, end, segment=seg)
    
    return G


def find_all_cycles(G: nx.Graph, max_length: int = 50) -> List[List[Tuple[float, float]]]:
    """
    Find all simple cycles (closed loops) in the graph.
    Uses cycle_basis for efficiency.
    """
    try:
        # Get fundamental cycles
        cycles = list(nx.cycle_basis(G))
        
        # Filter by length
        cycles = [c for c in cycles if len(c) <= max_length]
        
        return cycles
    except:
        return []


def cycle_to_polygon(cycle: List[Tuple[float, float]]) -> Optional[Polygon]:
    """Convert a cycle (list of nodes) to a Shapely Polygon"""
    if len(cycle) < 3:
        return None
    
    try:
        coords = list(cycle) + [cycle[0]]  # Close the ring
        poly = Polygon(coords)
        
        if poly.is_valid and poly.area > 0:
            return poly
        else:
            # Try to fix invalid polygon
            fixed = poly.buffer(0)
            if fixed.is_valid and fixed.area > 0:
                return fixed
    except:
        pass
    
    return None


def extract_regions_networkx(segments: List[Segment], max_cycle_length: int = 50) -> List[Region]:
    """
    Extract regions using NetworkX graph cycle detection.
    More robust for complex geometries but slower.
    """
    G = build_planar_graph(segments)
    
    print(f"[RegionExtractor] Graph has {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    
    cycles = find_all_cycles(G, max_length=max_cycle_length)
    print(f"[RegionExtractor] Found {len(cycles)} cycles")
    
    regions = []
    seen_areas = set()  # To avoid duplicates
    
    for cycle in cycles:
        poly = cycle_to_polygon(cycle)
        if poly is None:
            continue
        
        # Skip duplicates (same area within tolerance)
        area_key = round(poly.area, 2)
        if area_key in seen_areas:
            continue
        seen_areas.add(area_key)
        
        # Skip very small or very large regions
        if poly.area < 0.1 or poly.area > 10000:  # 0.1 m² to 10000 m²
            continue
        
        centroid = poly.centroid
        vertices = [Point(x, y) for x, y in poly.exterior.coords[:-1]]
        
        regions.append(Region(
            id=str(uuid.uuid4())[:8],
            vertices=vertices,
            area=poly.area,
            perimeter=poly.length,
            centroid=Point(centroid.x, centroid.y),
            shapely_polygon=poly
        ))
    
    return regions


def score_region(
    region: Region,
    label_position: Optional[Point] = None,
    expected_area: Optional[float] = None
) -> float:
    """
    Score a region based on multiple factors.
    Higher score = more likely to be the correct region for a given label.
    """
    score = 0.0
    
    # Factor 1: Label position (40% weight)
    if label_position:
        if region.contains_point(label_position):
            score += 0.4  # Label is inside
        else:
            dist = region.distance_to_point(label_position)
            # Decay: 0.3 at distance 0, approaching 0 at distance 5m
            score += max(0, 0.3 * (1 - dist / 5.0))
    
    # Factor 2: Area similarity (30% weight)
    if expected_area and expected_area > 0:
        ratio = region.area / expected_area
        if 0.8 <= ratio <= 1.2:
            score += 0.3  # Within 20%
        elif 0.5 <= ratio <= 2.0:
            score += 0.15  # Within 50-200%
        elif 0.2 <= ratio <= 5.0:
            score += 0.05
    
    # Factor 3: Geometric regularity (20% weight)
    # Prefer rectangular-ish shapes (common in architecture)
    try:
        convex_hull = region.shapely_polygon.convex_hull
        convexity = region.area / convex_hull.area if convex_hull.area > 0 else 0
        score += convexity * 0.2
    except:
        pass
    
    # Factor 4: Size sanity (10% weight)
    # Typical room sizes
    if 1.0 <= region.area <= 200.0:
        score += 0.1
    elif 0.5 <= region.area <= 500.0:
        score += 0.05
    
    return score


def extract_regions(
    segments: List[Segment],
    method: str = "shapely",
    min_area: float = 0.1,
    max_area: float = 10000.0
) -> List[Region]:
    """
    Main function to extract regions from line segments.
    
    Args:
        segments: List of line segments (after cleanup)
        method: "shapely" (faster) or "networkx" (more robust)
        min_area: Minimum area to keep (m²)
        max_area: Maximum area to keep (m²)
    
    Returns:
        List of Region objects
    """
    print(f"[RegionExtractor] Extracting regions from {len(segments)} segments using {method}")
    
    if method == "shapely":
        regions = extract_regions_shapely(segments)
    else:
        regions = extract_regions_networkx(segments)
    
    # Filter by area
    regions = [r for r in regions if min_area <= r.area <= max_area]
    
    # Assign layers to regions (heuristic: majority vote of boundary segments)
    try:
        assign_layers_to_regions(regions, segments)
    except Exception as e:
        print(f"[RegionExtractor] Layer assignment failed: {e}")
        # Continue without layers (default "Unknown")
    
    # Sort by area (largest first)
    regions.sort(key=lambda r: r.area, reverse=True)
    
    print(f"[RegionExtractor] Extracted {len(regions)} valid regions")
    
    return regions


def assign_layers_to_regions(regions: List[Region], segments: List[Segment]):
    """
    Assign a layer to each region based on the segments that form its boundary/interior.
    Uses a spatial index (or brute force for now) to find segments overlapping the region.
    """
    if not regions or not segments:
        return

    # Optimization: Sort segments by x coordinate for faster bounds check
    # or just brute force for < 10k items (fast enough in memory)
    
    # Pre-filter segments that have layers
    layered_segments = [s for s in segments if s.layer]
    
    for region in regions:
        # 1. Find segments that are "close" to the region boundary
        # A simple proximity check using the region's buffered boundary
        
        region_poly = region.shapely_polygon
        boundary = region_poly.boundary
        
        # Buffer slightly to catch segments that might have slight gaps (cleaned geometry)
        buffered_boundary = boundary.buffer(0.05) # 5cm tolerance
        
        candidates = []
        for seg in layered_segments:
            # Quick bounds check
            min_x = min(seg.start.x, seg.end.x)
            max_x = max(seg.start.x, seg.end.x)
            min_y = min(seg.start.y, seg.end.y)
            max_y = max(seg.start.y, seg.end.y)
            
            # Region bounds
            r_min_x, r_min_y, r_max_x, r_max_y = region_poly.bounds
            
            # Intersection test
            if (min_x > r_max_x or max_x < r_min_x or min_y > r_max_y or max_y < r_min_y):
                continue
                
            # Detailed check
            seg_line = LineString([(seg.start.x, seg.start.y), (seg.end.x, seg.end.y)])
            if buffered_boundary.intersects(seg_line):
                candidates.append(seg.layer)
        
        if candidates:
            # Majority vote
            from collections import Counter
            most_common = Counter(candidates).most_common(1)
            if most_common:
                region.layer = most_common[0][0]
        else:
            region.layer = "Unknown"


def find_best_region(
    regions: List[Region],
    label_position: Optional[Point] = None,
    expected_area: Optional[float] = None,
    min_score: float = 0.3
) -> Optional[Tuple[Region, float]]:
    """
    Find the best matching region for a given label/expected quantity.
    
    Returns:
        Tuple of (best_region, score) or None if no good match
    """
    if not regions:
        return None
    
    scored = []
    for region in regions:
        score = score_region(region, label_position, expected_area)
        if score >= min_score:
            scored.append((region, score))
    
    if not scored:
        return None
    
    # Return highest scoring
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[0]
