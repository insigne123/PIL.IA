"""
DXF Parser using ezdxf

Extracts geometry (segments, arcs, polylines) and text labels from DXF files.
Handles block explosion and unit normalization.
"""
import ezdxf
from ezdxf.entities import Line, LWPolyline, Polyline, Arc, Circle, Text, MText, Insert
from typing import List, Tuple, Optional
from dataclasses import dataclass
import math
import logging

# Configure logger locally if not already done
logger = logging.getLogger(__name__)

@dataclass(slots=True)
class Point:
    x: float
    y: float


@dataclass(slots=True)
class Segment:
    start: Point
    end: Point
    layer: str
    entity_type: str


@dataclass(slots=True)
class TextBlock:
    text: str
    position: Point
    layer: str
    height: float


@dataclass
class ParseResult:
    segments: List[Segment]
    texts: List[TextBlock]
    layers: List[str]
    bounds: Tuple[float, float, float, float]  # min_x, min_y, max_x, max_y
    unit_factor: float  # Factor to convert to meters


def get_unit_factor(doc) -> float:
    """
    Get conversion factor to meters based on $INSUNITS header
    """
    try:
        insunits = doc.header.get('$INSUNITS', 0)
        # Common unit codes:
        # 0 = Unitless, 1 = Inches, 2 = Feet, 4 = Millimeters, 5 = Centimeters, 6 = Meters
        factors = {
            0: 1.0,        # Assume meters if unitless
            1: 0.0254,     # Inches
            2: 0.3048,     # Feet
            4: 0.001,      # Millimeters
            5: 0.01,       # Centimeters
            6: 1.0,        # Meters
        }
        return factors.get(insunits, 1.0)
    except:
        return 1.0


def extract_line_segments(entity, transform=None) -> List[Segment]:
    """Extract line segments from various entity types"""
    segments = []
    layer = entity.dxf.layer if hasattr(entity.dxf, 'layer') else "0"
    
    if isinstance(entity, Line):
        start = entity.dxf.start
        end = entity.dxf.end
        segments.append(Segment(
            start=Point(start.x, start.y),
            end=Point(end.x, end.y),
            layer=layer,
            entity_type="LINE"
        ))
    
    elif isinstance(entity, LWPolyline):
        points = list(entity.get_points(format='xy'))
        for i in range(len(points) - 1):
            segments.append(Segment(
                start=Point(points[i][0], points[i][1]),
                end=Point(points[i+1][0], points[i+1][1]),
                layer=layer,
                entity_type="LWPOLYLINE"
            ))
        # Close if closed polyline
        if entity.closed and len(points) > 2:
            segments.append(Segment(
                start=Point(points[-1][0], points[-1][1]),
                end=Point(points[0][0], points[0][1]),
                layer=layer,
                entity_type="LWPOLYLINE"
            ))
    
    elif isinstance(entity, Arc):
        # Approximate arc with line segments
        center = entity.dxf.center
        radius = entity.dxf.radius
        start_angle = math.radians(entity.dxf.start_angle)
        end_angle = math.radians(entity.dxf.end_angle)
        
        # Number of segments based on arc length
        arc_length = radius * abs(end_angle - start_angle)
        num_segments = max(8, int(arc_length / 0.1))  # At least 8, max 10cm per segment
        
        angles = [start_angle + (end_angle - start_angle) * i / num_segments 
                  for i in range(num_segments + 1)]
        
        for i in range(len(angles) - 1):
            x1 = center.x + radius * math.cos(angles[i])
            y1 = center.y + radius * math.sin(angles[i])
            x2 = center.x + radius * math.cos(angles[i+1])
            y2 = center.y + radius * math.sin(angles[i+1])
            segments.append(Segment(
                start=Point(x1, y1),
                end=Point(x2, y2),
                layer=layer,
                entity_type="ARC"
            ))
    
    elif isinstance(entity, Circle):
        # Approximate circle with line segments
        center = entity.dxf.center
        radius = entity.dxf.radius
        num_segments = max(16, int(2 * math.pi * radius / 0.1))
        
        for i in range(num_segments):
            angle1 = 2 * math.pi * i / num_segments
            angle2 = 2 * math.pi * (i + 1) / num_segments
            x1 = center.x + radius * math.cos(angle1)
            y1 = center.y + radius * math.sin(angle1)
            x2 = center.x + radius * math.cos(angle2)
            y2 = center.y + radius * math.sin(angle2)
            segments.append(Segment(
                start=Point(x1, y1),
                end=Point(x2, y2),
                layer=layer,
                entity_type="CIRCLE"
            ))
    
    return segments


def extract_text(entity) -> Optional[TextBlock]:
    """Extract text content and position"""
    layer = entity.dxf.layer if hasattr(entity.dxf, 'layer') else "0"
    
    if isinstance(entity, Text):
        pos = entity.dxf.insert
        return TextBlock(
            text=entity.dxf.text,
            position=Point(pos.x, pos.y),
            layer=layer,
            height=entity.dxf.height
        )
    
    elif isinstance(entity, MText):
        pos = entity.dxf.insert
        return TextBlock(
            text=entity.plain_text(),
            position=Point(pos.x, pos.y),
            layer=layer,
            height=entity.dxf.char_height
        )
    
    return None


def explode_block(insert: Insert, doc, depth: int = 0, max_depth: int = 10) -> Tuple[List[Segment], List[TextBlock]]:
    """Recursively explode block references with depth limit"""
    segments = []
    texts = []
    
    if depth > max_depth:
        logger.warning(f"Max recursion depth ({max_depth}) reached for block {insert.dxf.name}")
        return segments, texts
    
    try:
        block = doc.blocks.get(insert.dxf.name)
        if not block:
            return segments, texts
        
        # Get transformation matrix
        # TODO: Apply proper transformation (rotation, scale, position)
        offset_x = insert.dxf.insert.x
        offset_y = insert.dxf.insert.y
        scale_x = insert.dxf.xscale
        scale_y = insert.dxf.yscale
        
        for entity in block:
            if isinstance(entity, Insert):
                # Recursive block explosion
                sub_segs, sub_texts = explode_block(entity, doc, depth + 1, max_depth)
                segments.extend(sub_segs)
                texts.extend(sub_texts)
            elif isinstance(entity, (Line, LWPolyline, Polyline, Arc, Circle)):
                entity_segs = extract_line_segments(entity)
                # Apply block transformation
                for seg in entity_segs:
                    seg.start.x = seg.start.x * scale_x + offset_x
                    seg.start.y = seg.start.y * scale_y + offset_y
                    seg.end.x = seg.end.x * scale_x + offset_x
                    seg.end.y = seg.end.y * scale_y + offset_y
                segments.extend(entity_segs)
            elif isinstance(entity, (Text, MText)):
                text = extract_text(entity)
                if text:
                    text.position.x = text.position.x * scale_x + offset_x
                    text.position.y = text.position.y * scale_y + offset_y
                    texts.append(text)
    except Exception as e:
        logger.error(f"Failed to explode block {insert.dxf.name}: {e}")
    
    return segments, texts


def parse_dxf_file(file_path: str) -> ParseResult:
    """
    Main function to parse DXF file and extract all geometry
    """
    try:
        doc = ezdxf.readfile(file_path)
    except Exception as e:
        raise ValueError(f"Failed to read DXF file: {e}")
    
    unit_factor = get_unit_factor(doc)
    msp = doc.modelspace()
    
    all_segments: List[Segment] = []
    all_texts: List[TextBlock] = []
    layers = set()
    
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')
    
    for entity in msp:
        layers.add(entity.dxf.layer if hasattr(entity.dxf, 'layer') else "0")
        
        if isinstance(entity, Insert):
            # Block reference - explode it
            segs, texts = explode_block(entity, doc)
            all_segments.extend(segs)
            all_texts.extend(texts)
        
        elif isinstance(entity, (Line, LWPolyline, Polyline, Arc, Circle)):
            segs = extract_line_segments(entity)
            all_segments.extend(segs)
        
        elif isinstance(entity, (Text, MText)):
            text = extract_text(entity)
            if text:
                all_texts.append(text)
    
    # Apply unit conversion and calculate bounds
    for seg in all_segments:
        seg.start.x *= unit_factor
        seg.start.y *= unit_factor
        seg.end.x *= unit_factor
        seg.end.y *= unit_factor
        
        min_x = min(min_x, seg.start.x, seg.end.x)
        min_y = min(min_y, seg.start.y, seg.end.y)
        max_x = max(max_x, seg.start.x, seg.end.x)
        max_y = max(max_y, seg.start.y, seg.end.y)
    
    for text in all_texts:
        text.position.x *= unit_factor
        text.position.y *= unit_factor
    
    # Handle case with no geometry
    if min_x == float('inf'):
        min_x, min_y, max_x, max_y = 0, 0, 100, 100
    
    return ParseResult(
        segments=all_segments,
        texts=all_texts,
        layers=list(layers),
        bounds=(min_x, min_y, max_x, max_y),
        unit_factor=unit_factor
    )
