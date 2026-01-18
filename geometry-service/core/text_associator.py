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
    """
    Find labels that match the Excel item description.
    """
    matches = []
    
    for label in labels:
        score = fuzzy_match_score(item.description, label.text)
        if score >= threshold:
            matches.append((label, score))
    
    matches.sort(key=lambda x: x[1], reverse=True)
    return matches

def associate_text_to_regions(
    regions: List[Any], # List[region_extractor.Region]
    labels: List[Label],
    excel_items: List[ExcelItem],
    text_match_threshold: float = 0.5,
    spatial_search_radius: float = 2.0
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
    
    for item in excel_items:
        # Skip titles/summary
        if not item.description or len(item.description) < 3:
            continue
            
        # Step 1: Find matching labels (Text Match)
        matching_labels = find_matching_labels(item, labels, threshold=text_match_threshold)
        
        best_match = None
        best_score = 0.0
        
        for label, text_score in matching_labels:
            # Step 2: Spatial Query using Index (Zone Match)
            # Find which region CONTAINS this label
            zone = spatial_index.find_zone(label.position.x, label.position.y)
            
            region_match = None
            strategy = "none"
            spatial_score = 0.0
            
            if zone:
                # STRICT CONTAINMENT FOUND!
                # We need to find the original Region object that corresponds to this zone
                # The zone contains 'polygon' which is the shapely object.
                # Let's simple heuristic: find the region with this ID/polygon
                # (Optimization: SpatialIndex could return index or ID directly)
                
                # For now, simplest way:
                for r in regions:
                    if hasattr(r, 'shapely_polygon') and r.shapely_polygon == zone['polygon']:
                        region_match = r
                        strategy = "inside_zone"
                        spatial_score = 1.0
                        break
            
            # Fallback: Nearest Neighbor (if no containment)
            if not region_match:
                # Iterate regions to find nearest (Legacy/Backup)
                # Only do this if we really need to, or if containment failed
                # For efficiency, we might skip this if the index is trusted
                pass 
                
            if region_match:
                # Combined Score
                # Text score is paramount, but spatial validates it
                combined = text_score * 0.6 + spatial_score * 0.4
                
                # Boost for expected area match
                if item.expected_qty and item.expected_qty > 0:
                    ratio = region_match.area / item.expected_qty
                    if 0.8 <= ratio <= 1.2:
                        combined += 0.2
                
                if combined > best_score:
                    best_score = combined
                    best_match = (region_match, label, strategy)

        # Step 3: Create Match
        if best_match:
            region, label, strategy = best_match
            
            # Unit logic
            qty = region.area # Default
            if item.unit and item.unit.lower() in ['ml', 'm', 'metro lineal']:
                 qty = region.perimeter
            
            matches.append(Match(
                excel_item=item,
                region=region,
                label=label,
                qty_calculated=round(qty, 2),
                confidence=best_score,
                match_reason=f"Matched '{label.text}' via {strategy}"
            ))
        else:
             matches.append(Match(
                excel_item=item,
                region=None,
                label=None,
                qty_calculated=0,
                confidence=0,
                match_reason="No spatial match found"
            ))
            
    return matches
