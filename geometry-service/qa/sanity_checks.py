"""
Sanity Checks Module

Validates extracted quantities against expected ranges and logical constraints.
"""
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from enum import Enum


class SeverityLevel(Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class SanityIssue:
    rule: str
    message: str
    severity: SeverityLevel
    value: float
    threshold: Optional[float] = None


@dataclass
class SanityResult:
    passed: bool
    issues: List[SanityIssue] = field(default_factory=list)
    
    @property
    def warnings(self) -> List[str]:
        return [i.message for i in self.issues if i.severity != SeverityLevel.INFO]


# Typical ranges by unit type (based on construction experience)
TYPICAL_RANGES = {
    # Área en m²
    "m2": {"min": 0.1, "max": 2000, "typical_min": 1, "typical_max": 500},
    "m²": {"min": 0.1, "max": 2000, "typical_min": 1, "typical_max": 500},
    
    # Longitud en metros
    "ml": {"min": 0.1, "max": 1000, "typical_min": 0.5, "typical_max": 200},
    "m": {"min": 0.1, "max": 1000, "typical_min": 0.5, "typical_max": 200},
    
    # Unidades
    "un": {"min": 1, "max": 1000, "typical_min": 1, "typical_max": 100},
    
    # Global (estimación general)
    "gl": {"min": 0.1, "max": 100, "typical_min": 1, "typical_max": 10},
}


def get_range_for_unit(unit: str) -> Dict[str, float]:
    """Get the expected range for a given unit"""
    unit_lower = unit.lower().strip()
    return TYPICAL_RANGES.get(unit_lower, TYPICAL_RANGES["m2"])


def check_absolute_range(quantity: float, unit: str) -> Optional[SanityIssue]:
    """Check if quantity is within absolute acceptable range"""
    ranges = get_range_for_unit(unit)
    
    if quantity < ranges["min"]:
        return SanityIssue(
            rule="absolute_min",
            message=f"Quantity {quantity:.2f} is below minimum ({ranges['min']})",
            severity=SeverityLevel.ERROR,
            value=quantity,
            threshold=ranges["min"]
        )
    
    if quantity > ranges["max"]:
        return SanityIssue(
            rule="absolute_max",
            message=f"Quantity {quantity:.2f} exceeds maximum ({ranges['max']})",
            severity=SeverityLevel.ERROR,
            value=quantity,
            threshold=ranges["max"]
        )
    
    return None


def check_typical_range(quantity: float, unit: str) -> Optional[SanityIssue]:
    """Check if quantity is within typical (expected) range"""
    ranges = get_range_for_unit(unit)
    
    if quantity < ranges["typical_min"]:
        return SanityIssue(
            rule="typical_min",
            message=f"Quantity {quantity:.2f} is unusually low (typical > {ranges['typical_min']})",
            severity=SeverityLevel.WARNING,
            value=quantity,
            threshold=ranges["typical_min"]
        )
    
    if quantity > ranges["typical_max"]:
        return SanityIssue(
            rule="typical_max",
            message=f"Quantity {quantity:.2f} is unusually high (typical < {ranges['typical_max']})",
            severity=SeverityLevel.WARNING,
            value=quantity,
            threshold=ranges["typical_max"]
        )
    
    return None


def check_expected_match(
    quantity: float,
    expected: Optional[float],
    tolerance: float = 0.2
) -> Optional[SanityIssue]:
    """Check if quantity matches expected value within tolerance"""
    if expected is None or expected <= 0:
        return None
    
    ratio = quantity / expected
    
    if ratio < (1 - tolerance) or ratio > (1 + tolerance):
        diff_percent = abs(ratio - 1) * 100
        severity = SeverityLevel.ERROR if diff_percent > 50 else SeverityLevel.WARNING
        
        return SanityIssue(
            rule="expected_match",
            message=f"Quantity {quantity:.2f} differs from expected {expected:.2f} by {diff_percent:.0f}%",
            severity=severity,
            value=quantity,
            threshold=expected
        )
    
    return None


def check_hatch_false_positive(
    quantity: float,
    drawing_area: Optional[float],
    source_type: str,
    threshold: float = 0.8
) -> Optional[SanityIssue]:
    """
    Check if a hatch-sourced quantity suspiciously covers most of the drawing.
    This often indicates a false positive (background hatch).
    """
    if source_type != "hatch" or drawing_area is None:
        return None
    
    if quantity > drawing_area * threshold:
        return SanityIssue(
            rule="hatch_false_positive",
            message=f"Hatch covers {(quantity/drawing_area)*100:.0f}% of drawing - likely false positive",
            severity=SeverityLevel.ERROR,
            value=quantity,
            threshold=drawing_area * threshold
        )
    
    return None


def check_region_vs_parent(
    item_area: float,
    parent_area: Optional[float]
) -> Optional[SanityIssue]:
    """
    Check that an item's area doesn't exceed its parent region.
    E.g., a wall finish can't be more than the room's perimeter.
    """
    if parent_area is None:
        return None
    
    if item_area > parent_area * 1.1:  # Allow 10% tolerance
        return SanityIssue(
            rule="exceeds_parent",
            message=f"Item area {item_area:.2f} exceeds parent area {parent_area:.2f}",
            severity=SeverityLevel.WARNING,
            value=item_area,
            threshold=parent_area
        )
    
    return None


@dataclass
class MatchContext:
    """Context information for sanity checking"""
    excel_item_id: str
    unit: str
    expected_qty: Optional[float] = None
    drawing_area: Optional[float] = None
    parent_area: Optional[float] = None
    source_type: str = "unknown"


def run_sanity_checks(match, context: Optional[MatchContext] = None) -> SanityResult:
    """
    Run all sanity checks on a match result.
    
    Args:
        match: Match object with qty_calculated
        context: Optional context for additional checks
    
    Returns:
        SanityResult with pass/fail and list of issues
    """
    issues = []
    
    # Extract values
    quantity = getattr(match, 'qty_calculated', 0)
    unit = getattr(match, 'unit', 'm2')
    
    if context:
        unit = context.unit or unit
        expected = context.expected_qty
        drawing_area = context.drawing_area
        source_type = context.source_type
    else:
        expected = getattr(match, 'expected_qty', None)
        drawing_area = None
        source_type = "unknown"
    
    # Run checks
    check1 = check_absolute_range(quantity, unit)
    if check1:
        issues.append(check1)
    
    check2 = check_typical_range(quantity, unit)
    if check2:
        issues.append(check2)
    
    check3 = check_expected_match(quantity, expected)
    if check3:
        issues.append(check3)
    
    if context:
        check4 = check_hatch_false_positive(quantity, drawing_area, source_type)
        if check4:
            issues.append(check4)
        
        check5 = check_region_vs_parent(quantity, context.parent_area)
        if check5:
            issues.append(check5)
    
    # Determine overall pass/fail
    has_errors = any(i.severity == SeverityLevel.ERROR for i in issues)
    
    return SanityResult(
        passed=not has_errors,
        issues=issues
    )
