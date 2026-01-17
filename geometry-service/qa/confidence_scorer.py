"""
Confidence Scorer Module

Computes final confidence scores for matches based on multiple factors.
"""
from typing import Optional
from dataclasses import dataclass


@dataclass
class ConfidenceFactors:
    text_match: float = 0.0      # Fuzzy text matching quality (0-1)
    spatial_match: float = 0.0   # Spatial association quality (0-1)
    geometry_quality: float = 0.0  # Region geometry quality (0-1)
    expected_match: float = 0.0  # How close to expected value (0-1)
    source_reliability: float = 0.5  # DXF/PDF quality indicator (0-1)
    sanity_passed: bool = True


def compute_text_match_factor(score: float) -> float:
    """Convert raw text match score to confidence factor"""
    if score >= 0.9:
        return 1.0
    elif score >= 0.7:
        return 0.8
    elif score >= 0.5:
        return 0.6
    else:
        return 0.3


def compute_spatial_match_factor(strategy: str, distance: float = 0.0) -> float:
    """Compute confidence based on spatial matching strategy"""
    if strategy == "inside":
        return 1.0
    elif strategy == "near_centroid":
        # Decay with distance
        return max(0.3, 1.0 - distance / 5.0)
    elif strategy == "directional":
        return 0.6
    else:
        return 0.3


def compute_geometry_quality_factor(region) -> float:
    """Evaluate region geometry quality"""
    if region is None:
        return 0.0
    
    score = 0.5  # Base score
    
    # Check convexity (architectural rooms tend to be convex-ish)
    try:
        if hasattr(region, 'shapely_polygon'):
            hull = region.shapely_polygon.convex_hull
            convexity = region.area / hull.area if hull.area > 0 else 0
            score += convexity * 0.3
        else:
            score += 0.1  # No polygon info
    except:
        pass
    
    # Check area is in reasonable range
    area = getattr(region, 'area', 0)
    if 1 <= area <= 200:
        score += 0.2
    elif 0.5 <= area <= 500:
        score += 0.1
    
    return min(1.0, score)


def compute_expected_match_factor(
    calculated: float,
    expected: Optional[float]
) -> float:
    """Compute confidence based on how close to expected value"""
    if expected is None or expected <= 0:
        return 0.5  # Neutral if no expectation
    
    ratio = calculated / expected
    
    if 0.9 <= ratio <= 1.1:
        return 1.0  # Within 10%
    elif 0.8 <= ratio <= 1.2:
        return 0.9  # Within 20%
    elif 0.7 <= ratio <= 1.4:
        return 0.7  # Within 30-40%
    elif 0.5 <= ratio <= 2.0:
        return 0.4  # Within 50-200%
    else:
        return 0.1  # Very different


def compute_confidence(
    match,
    sanity_result = None,
    factors: Optional[ConfidenceFactors] = None
) -> float:
    """
    Compute final confidence score for a match.
    
    Weights:
    - Text match: 20%
    - Spatial match: 25%
    - Geometry quality: 20%
    - Expected match: 25%
    - Source reliability: 10%
    
    Sanity failures apply a penalty.
    """
    if factors is None:
        factors = ConfidenceFactors()
    
    # Extract values from match if not provided
    if factors.text_match == 0 and hasattr(match, 'confidence'):
        factors.text_match = match.confidence
    
    if factors.geometry_quality == 0 and hasattr(match, 'region'):
        factors.geometry_quality = compute_geometry_quality_factor(match.region)
    
    if factors.expected_match == 0:
        calculated = getattr(match, 'qty_calculated', 0)
        expected = getattr(match, 'expected_qty', None)
        if expected is None and hasattr(match, 'excel_item'):
            expected = getattr(match.excel_item, 'expected_qty', None)
        factors.expected_match = compute_expected_match_factor(calculated, expected)
    
    # Weighted combination
    score = (
        factors.text_match * 0.20 +
        factors.spatial_match * 0.25 +
        factors.geometry_quality * 0.20 +
        factors.expected_match * 0.25 +
        factors.source_reliability * 0.10
    )
    
    # Sanity penalty
    if sanity_result and not sanity_result.passed:
        score *= 0.5
    elif sanity_result and sanity_result.issues:
        # Partial penalty for warnings
        warning_count = len([i for i in sanity_result.issues if i.severity.value == "warning"])
        if warning_count > 0:
            score *= (1 - warning_count * 0.1)
    
    return round(max(0, min(1, score)), 3)


def confidence_to_label(confidence: float) -> str:
    """Convert confidence score to human-readable label"""
    if confidence >= 0.8:
        return "high"
    elif confidence >= 0.5:
        return "medium"
    else:
        return "low"


def should_require_review(confidence: float, sanity_result = None) -> bool:
    """Determine if a match requires human review"""
    if confidence < 0.5:
        return True
    
    if sanity_result and not sanity_result.passed:
        return True
    
    return False
