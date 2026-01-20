"""
Text Associator - Match Excel items to regions via text labels

Uses fuzzy matching and Spatial Indexing to associate partidas with geometry.
"""
from typing import List, Optional, Tuple, Dict, Any
from dataclasses import dataclass
from difflib import SequenceMatcher
import re
import logging

from core.spatial_index import SpatialIndex
# Import Region/Point type hits only for static analysis if needed, 
# but we duck-type or use Any to avoid circular deps if RegionExtractor imports this.

logger = logging.getLogger(__name__)

from core.semantic_matcher import SemanticMatcher
# Singleton instance
matcher = SemanticMatcher()

from shapely.geometry import box, LineString
from shapely.strtree import STRtree
from shapely.geometry import Point as ShapelyPoint

def estimate_unclosed_area(
    center: Any, 
    segment_tree: Optional[STRtree], 
    segment_map: Dict[int, Any],
    search_radius: float = 4.0
) -> Optional[Any]:
    """
    P2.2: Fallback Estimator for Unclosed Rooms.
    If a text label is not inside any polygon, look for nearby walls/lines.
    Construct a bounding box of nearby geometry and use that area.
    """
    if not segment_tree:
        return None
        
    p = ShapelyPoint(center.x, center.y)
    
    # Query nearby segments (heuristic radius)
    # Search slightly larger area to catch walls
    search_box = box(center.x - search_radius, center.y - search_radius, 
                     center.x + search_radius, center.y + search_radius)
                     
    # Query tree
    try:
        candidates = segment_tree.query(search_box)
        # Handle index vs geom return (depending on shapely ver)
        # We assume segment_map maps id(geom) -> segment OR we just trust candidates are LineStrings
        
        relevant_geoms = []
        if hasattr(candidates, 'dtype') and candidates.dtype != 'object':
            # Indices path
            # We need the list of geoms used to build the tree.
            # Passed via closure or hack? STRtree keeps geometries usually.
            relevant_geoms = [segment_tree.geometries.take(i) for i in candidates]
        else:
            relevant_geoms = candidates
            
        if not relevant_geoms:
            return None
            
        # Calculate bounds of candidates
        min_x, min_y = float('inf'), float('inf')
        max_x, max_y = float('-inf'), float('-inf')
        count = 0
        
        for geom in relevant_geoms:
            # Check simple distance to center (improve accuracy vs box)
            if geom.distance(p) > search_radius:
                continue
                
            b = geom.bounds
            min_x = min(min_x, b[0])
            min_y = min(min_y, b[1])
            max_x = max(max_x, b[2])
            max_y = max(max_y, b[3])
            count += 1
            
        if count < 3: # Need at least 3 walls to guess a room
            return None
            
        width = max(0, max_x - min_x)
        height = max(0, max_y - min_y)
        area = width * height
        
        if area > 1000 or area < 1.0: # Sanity check (1m2 to 1000m2)
            return None
            
        # Create virtual region
        # Duck-typed object
        class VirtualRegion:
            pass
        vr = VirtualRegion()
        vr.id = "estimated_fallback"
        vr.area = area
        vr.perimeter = (width + height) * 2
        vr.layer = "Fallback Estimation"
        vr.shapely_polygon = box(min_x, min_y, max_x, max_y)
        return vr
        
    except Exception:
        pass
        
    return None


# Re-use existing structures where possible, or define minimal interfaces
@dataclass
class Label:
    text: str
    position: Any # Point-like object with x, y
    confidence: float = 1.0

@dataclass
class ExcelItem:
    id: str
    description: str
    unit: str
    expected_qty: Optional[float] = None

@dataclass
class Match:
    excel_item: ExcelItem
    region: Optional[Any] # region_extractor.Region
    label: Optional[Label]
    qty_calculated: float
    confidence: float
    match_reason: str

def normalize_text(text: str) -> str:
    """Normalize text for comparison"""
    if not text: return ""
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def fuzzy_match_score(text1: str, text2: str) -> float:
    """Calculate fuzzy match score between two texts"""
    t1 = normalize_text(text1)
    t2 = normalize_text(text2)
    
    if not t1 or not t2: return 0.0

    # Strict containment for short codes
    if len(t1) < 5 and t1 in t2: return 1.0
    if len(t2) < 5 and t2 in t1: return 1.0
    
    # Check for exact substring match
    if t1 in t2 or t2 in t1:
        return 0.9
    
    # Sequence matcher
    ratio = SequenceMatcher(None, t1, t2).ratio()
    
    # Boost for matching key terms
    words1 = set(t1.split())
    words2 = set(t2.split())
    common = words1 & words2
    if common:
        word_bonus = len(common) / max(len(words1), len(words2)) * 0.3
        ratio = min(1.0, ratio + word_bonus)
    
    return ratio

def find_matching_labels(
    item: ExcelItem,
    labels: List[Label],
    threshold: float = 0.5
) -> List[Tuple[Label, float]]:
    excel_description_norm = normalize_text(item.description)
    if not excel_description_norm: 
        return []

    # Prepare candidates list for SemanticMatcher
    # We need to map text back to Label objects
    # This might be slow if we do it for every item against 1000 labels.
    # SemanticMatcher.match takes list of strings.
    
    # Optimization: Filter labels first by simple containment or length?
    # Or just passthrough.
    
    candidate_texts = [l.text for l in labels if l.text]
    
    # Use SemanticMatcher
    # returns [(text, score, strategy)]
    results = matcher.match(item.description, candidate_texts, threshold=threshold)
    
    # Map back to Label objects
    # Creating a map text->[Label] (since duplicates exist)
    label_map = {}
    for l in labels:
        if l.text not in label_map:
            label_map[l.text] = []
        label_map[l.text].append(l)
        
    label_matches = []
    seen_labels = set()
    
    for text, score, strategy in results:
        # Get all labels with this text
        lbls = label_map.get(text, [])
        for lbl in lbls:
            if id(lbl) not in seen_labels:
                label_matches.append((lbl, score))
                seen_labels.add(id(lbl))
                
    return label_matches


def associate_text_to_regions(
    regions: List[Any], # List[region_extractor.Region]
    labels: List[Label],
    excel_items: List[ExcelItem],
    text_match_threshold: float = 0.5,

    spatial_search_radius: float = 2.0,
    segments: List[Any] = None, # NEW: For Fallback Estimator
    default_height: float = 2.4 # NEW: Fallback height for Linear Area items
) -> List[Match]:
    """
    Main function to associate Excel items with regions via text labels.
    Now uses SPATIAL INDEX for robust containment checks.
    """
    matches = []
    
    # 1. Build Spatial Index from Regions
    # We need to adapt the regions to the format expected by SpatialIndex
    # SpatialIndex expects: List[Tuple[Polygon, layer, handle]]
    poly_list = []
    for r in regions:
        # region_extractor.Region has .shapely_polygon
        if hasattr(r, 'shapely_polygon'):
            poly_list.append((r.shapely_polygon, r.layer, r.id))
    
    spatial_index = SpatialIndex(poly_list)
    
    # Create lookup map for O(1) access
    region_id_map = {r.id: r for r in regions}

    for item in excel_items:
        # Skip titles/summary
        if not item.get('description') or len(item.get('description')) < 3:
            continue
            
        # Step 1: Find matching labels (Text Match)
        matching_labels = find_matching_labels(item, labels, threshold=text_match_threshold)
        
        best_match = None
        best_score = 0.0
        
        # DEBUG TRACE for problematic items
        debug_item = "sobrelosa" in item.description.lower()
        if debug_item:
            print(f"[TextAssociator] Tracing '{item.description}' (ID: {item.id})")
            print(f"  - Found {len(matching_labels)} text candidate labels")
            for l, s in matching_labels[:5]:
                print(f"    * '{l.text}' (Score: {s:.2f}) at {l.position}")

        # Step 2: Aggregate ALL valid matches (1-to-Many)
        valid_matches = []
        matched_region_ids = set()
        
        for label, text_score in matching_labels:
            # Spatial Query using Index (Zone Match)
            zone = spatial_index.find_zone(label.position.x, label.position.y)
            
            region_match = None
            strategy = "none"
            spatial_score = 0.0
            
            if zone:
                region_match = region_id_map.get(zone.get('handle'))
                if region_match:
                    strategy = "inside_zone"
                    spatial_score = 1.0 

            # Proximity Check
            if not region_match:
                nearby_zone = spatial_index.find_nearest_zone(label.position.x, label.position.y, max_distance=0.5)
                if nearby_zone:
                     region_match = region_id_map.get(nearby_zone.get('handle'))
                     if region_match:
                        strategy = "proximity"
                        spatial_score = 0.8
            
            # Fallback Estimator
            if not region_match and segments:
                if 'segment_tree' not in locals():
                    seg_geoms = [LineString([(s.start.x, s.start.y), (s.end.x, s.end.y)]) 
                                for s in segments if hasattr(s, 'start')]
                    if seg_geoms:
                        segment_tree = STRtree(seg_geoms)
                    else:
                        segment_tree = None
                
                if segment_tree:
                    fallback_region = estimate_unclosed_area(
                        label.position, 
                        segment_tree, 
                        {},
                        search_radius=5.0
                    )
                    if fallback_region:
                        region_match = fallback_region
                        strategy = "fallback_estimator"
                        spatial_score = 1.0 # High confidence if geometry found

            # Nearest Neighbor Fallback
            if not region_match:
                nearest_zone = spatial_index.find_nearest_zone(
                    label.position.x, label.position.y, max_distance=spatial_search_radius
                )
                if nearest_zone:
                    region_match = region_id_map.get(nearest_zone.get('handle'))
                    if region_match:
                        strategy = "nearest_neighbor"
                        dist = nearest_zone.get("distance", 0)
                        spatial_score = max(0.5, 1.0 - (dist / spatial_search_radius)) 
            
            if region_match:
                # Combined Score
                combined = text_score * 0.6 + spatial_score * 0.4
                
                # Check confidence threshold (e.g. 0.6)
                if combined >= 0.6:
                    # Avoid double counting the same region for the same item
                    # (e.g. two labels "Sala" in the same room)
                    if region_match.id not in matched_region_ids:
                        matched_region_ids.add(region_match.id)
                        valid_matches.append((region_match, label, strategy, combined))

        # Step 3: Sum Quantities
        if valid_matches:
            total_qty = 0.0
            match_details = []
            
            # Use the first match's label for display/debug or concatenate?
            # We'll use the highest confidence one for the 'Label' field, but sum qty.
            best_single_match = max(valid_matches, key=lambda x: x[3])
            primary_label = best_single_match[1]
            primary_region = best_single_match[0]
            
            detected_height = default_height # Reset for this item
            
            # Determine Height Once (Optimization)
            # ... (Reuse height logic if needed, but applied to each region if distinct?)
            # For simplicity, we calculate QTY for each region and sum.
            
            for region, lbl, strat, score in valid_matches:
                 # Unit logic per region
                 sub_qty = region.area
                 
                 # Detect Height for this specific region match? 
                 # Or use item-global detection? Let's use item-global default for now 
                 # or simple logic:
                 
                 if item.unit and item.unit.lower() in ['m2', 'm²', 'metro cuadrado']:
                     if sub_qty < 0.01 and region.perimeter > 0:
                         # Linear element (Wall) -> Area
                         # Check keywords for Horizontal
                         desc = item.description.lower()
                         horizontal_keywords = ['cielo', 'pisos', 'pavimento', 'losa', 'radier', 'sobrelosa', 'vitrina']
                         is_horizontal = any(k in desc for k in horizontal_keywords)
                         
                         if is_horizontal:
                             if hasattr(region, 'shapely_polygon'):
                                 sub_qty = region.shapely_polygon.convex_hull.area
                         else:
                             sub_qty = region.perimeter * default_height # Use default for speed in agg
                 
                 elif item.unit:
                    u = item.unit.lower()
                    if u in ['ml', 'm', 'metro lineal']:
                        sub_qty = region.perimeter
                    elif u in ['un', 'u', 'unidad', 'c/u', 'num', 'gl']:
                        sub_qty = 1.0
                 
                 total_qty += sub_qty
                 match_details.append(f"{lbl.text}({strat})")

            matches.append(Match(
                excel_item=item,
                region=primary_region, # Representative region
                label=primary_label,
                qty_calculated=round(total_qty, 2),
                confidence=best_single_match[3],  # Confidence of best match
                match_reason=f"Aggregated {len(valid_matches)} regions: {', '.join(match_details[:3])}..."
            ))
    
        else:
            matches.append(Match(
                excel_item=item,
                region=None,
                label=None,
                qty_calculated=0.0,
                confidence=0.0,
                match_reason="No spatial match found"
            ))

    return matches
