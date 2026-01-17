"""
Text Associator - Match Excel items to regions via text labels

Uses fuzzy matching and spatial proximity to associate partidas with geometry.
"""
from typing import List, Optional, Tuple, Dict
from dataclasses import dataclass
import re
from difflib import SequenceMatcher


@dataclass
class Point:
    x: float
    y: float


@dataclass
class Label:
    text: str
    position: Point
    confidence: float = 1.0


@dataclass
class Region:
    id: str
    vertices: List[Point]
    area: float
    perimeter: float
    centroid: Point
    
    def contains_point(self, point: Point) -> bool:
        """Simple point-in-polygon check using ray casting"""
        n = len(self.vertices)
        inside = False
        j = n - 1
        
        for i in range(n):
            xi, yi = self.vertices[i].x, self.vertices[i].y
            xj, yj = self.vertices[j].x, self.vertices[j].y
            
            if ((yi > point.y) != (yj > point.y)) and \
               (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
        
        return inside


@dataclass
class ExcelItem:
    id: str
    description: str
    unit: str
    expected_qty: Optional[float] = None


@dataclass
class Match:
    excel_item: ExcelItem
    region: Optional[Region]
    label: Optional[Label]
    qty_calculated: float
    confidence: float
    match_reason: str


def normalize_text(text: str) -> str:
    """Normalize text for comparison"""
    text = text.lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def fuzzy_match_score(text1: str, text2: str) -> float:
    """Calculate fuzzy match score between two texts"""
    t1 = normalize_text(text1)
    t2 = normalize_text(text2)
    
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
    Returns list of (label, score) tuples sorted by score descending.
    """
    matches = []
    
    for label in labels:
        score = fuzzy_match_score(item.description, label.text)
        if score >= threshold:
            matches.append((label, score))
    
    matches.sort(key=lambda x: x[1], reverse=True)
    return matches


def find_regions_for_label(
    label: Label,
    regions: List[Region],
    max_distance: float = 2.0
) -> List[Tuple[Region, str, float]]:
    """
    Find regions associated with a label using multiple strategies.
    
    Returns:
        List of (region, strategy, score) tuples
    """
    candidates = []
    
    for region in regions:
        # Strategy 1: Label inside region
        if region.contains_point(label.position):
            candidates.append((region, 'inside', 1.0))
            continue
        
        # Strategy 2: Label near region centroid
        dist_to_centroid = ((label.position.x - region.centroid.x)**2 + 
                           (label.position.y - region.centroid.y)**2)**0.5
        if dist_to_centroid <= max_distance:
            proximity_score = 1.0 - (dist_to_centroid / max_distance)
            candidates.append((region, 'near_centroid', proximity_score))
    
    # Sort by score
    candidates.sort(key=lambda x: x[2], reverse=True)
    return candidates


def associate_text_to_regions(
    regions: List[Region],
    labels: List[Label],
    excel_items: List[ExcelItem],
    text_match_threshold: float = 0.5,
    spatial_search_radius: float = 2.0
) -> List[Match]:
    """
    Main function to associate Excel items with regions via text labels.
    
    Process:
    1. For each Excel item, find matching text labels (fuzzy)
    2. For each matching label, find associated regions (spatial)
    3. Score and select best region
    4. Calculate quantity based on region geometry
    """
    matches = []
    
    for item in excel_items:
        # Skip titles and summary rows
        if not item.description or len(item.description) < 3:
            continue
        
        # Step 1: Find matching labels
        matching_labels = find_matching_labels(item, labels, threshold=text_match_threshold)
        
        best_match = None
        best_score = 0
        
        for label, text_score in matching_labels:
            # Step 2: Find regions for this label
            region_candidates = find_regions_for_label(
                label, regions, max_distance=spatial_search_radius
            )
            
            if not region_candidates:
                continue
            
            # Step 3: Score candidates
            for region, strategy, spatial_score in region_candidates:
                # Combined score
                combined = text_score * 0.5 + spatial_score * 0.5
                
                # Boost if area matches expected
                if item.expected_qty and item.expected_qty > 0:
                    ratio = region.area / item.expected_qty
                    if 0.8 <= ratio <= 1.2:
                        combined += 0.2
                    elif 0.5 <= ratio <= 2.0:
                        combined += 0.1
                
                if combined > best_score:
                    best_score = combined
                    best_match = (region, label, strategy)
        
        # Step 4: Create match result
        if best_match:
            region, label, strategy = best_match
            
            # Calculate quantity based on unit
            if item.unit.lower() in ['m2', 'm²', 'metro cuadrado']:
                qty = region.area
            elif item.unit.lower() in ['ml', 'm', 'metro lineal']:
                qty = region.perimeter
            else:
                qty = region.area  # Default to area
            
            matches.append(Match(
                excel_item=item,
                region=region,
                label=label,
                qty_calculated=round(qty, 2),
                confidence=best_score,
                match_reason=f"Matched via label '{label.text}' ({strategy})"
            ))
        else:
            # No match found
            matches.append(Match(
                excel_item=item,
                region=None,
                label=None,
                qty_calculated=0,
                confidence=0,
                match_reason="No matching label/region found"
            ))
    
    return matches
