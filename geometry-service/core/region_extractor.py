"""
Region Extractor - Planar Graph Face Detection

Extracts closed regions (polygons) from line segments using graph theory.
This is the core algorithm that enables measuring areas from fragmented geometry.
"""
import networkx as nx
from shapely.geometry import Polygon, LineString, Point as ShapelyPoint
from shapely.ops import polygonize, unary_union
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


def extract_regions_shapely(segments: List[Segment]) -> List[Region]:
    """
    Extract regions using Shapely's polygonize function.
    This is faster but may miss some complex cases.
    """
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
    
    # Sort by area (largest first)
    regions.sort(key=lambda r: r.area, reverse=True)
    
    print(f"[RegionExtractor] Extracted {len(regions)} valid regions")
    
    return regions


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
