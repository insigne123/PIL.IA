"""
Pydantic models for API request/response
"""
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Tuple


class Point(BaseModel):
    x: float
    y: float


class Segment(BaseModel):
    start: Point
    end: Point
    layer: Optional[str] = None
    entity_type: str = "LINE"


class TextBlock(BaseModel):
    text: str
    position: Point
    layer: Optional[str] = None
    height: Optional[float] = None


class Label(BaseModel):
    text: str
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2
    element_type: Optional[str] = None  # WALL, CEILING, FLOOR, etc.
    confidence: float = 1.0


class Region(BaseModel):
    id: str
    vertices: List[Point]
    area: float
    perimeter: float
    centroid: Point
    layer: Optional[str] = None


class ExcelItem(BaseModel):
    id: str
    description: str
    unit: str
    expected_qty: Optional[float] = None
    row_index: Optional[int] = None


class Match(BaseModel):
    id: str
    excel_item_id: str
    excel_item_description: str
    region_id: Optional[str] = None
    label_text: Optional[str] = None
    qty_calculated: float
    unit: str
    confidence: float
    match_reason: str
    warnings: List[str] = []


class Bounds(BaseModel):
    min_x: float
    min_y: float
    max_x: float
    max_y: float


# Request/Response models

class ExtractResponse(BaseModel):
    matches: List[Match]
    unmatched_items: List[Dict[str, Any]]
    warnings: List[str]
    processing_time_ms: int


class ParseDxfResponse(BaseModel):
    segments: List[Segment]
    texts: List[TextBlock]
    layers: List[str]
    bounds: Bounds
    regions: List[Region] = []


class ParsePdfResponse(BaseModel):
    segments: List[Segment]
    texts: List[TextBlock]
    pages: int


class DetectLabelsResponse(BaseModel):
    labels: List[Label]
    model_used: str
