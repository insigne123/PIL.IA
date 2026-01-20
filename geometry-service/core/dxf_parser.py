"""
DXF Parser using ezdxf

Extracts geometry (segments, arcs, polylines) and text labels from DXF files.
Handles block explosion and unit normalization.
"""
import ezdxf
from ezdxf.entities import Line, LWPolyline, Polyline, Arc, Circle, Text, MText, Insert, Hatch
from typing import List, Tuple, Optional
from dataclasses import dataclass
import math
import logging
from core.block_analyzer import analyze_blocks

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


@dataclass(slots=True)
class BlockReference:
    name: str
    position: Point
    layer: str
    rotation: float
    scale_x: float
    scale_x: float
    scale_y: float


@dataclass(slots=True)
class DxfRegion:
    vertices: List[Point]
    layer: str
    area: float
    is_hatch: bool = True



@dataclass
class ParseResult:
    segments: List[Segment]
    texts: List[TextBlock]
    inserts: List[BlockReference]
    layers: List[str]
    bounds: Tuple[float, float, float, float]
    unit_factor: float
    detected_unit: str = "Unknown" # NEW
    unit_confidence: str = "Low"   # NEW
    precomputed_regions: List[DxfRegion] = None # NEW: Hatch priority
    layer_metadata: dict = None
    block_metadata: dict = None


def get_unit_factor(doc, hint_unit: str = None) -> Tuple[float, str, str]:
    """
    Get conversion factor to meters with smart inference.
    Returns: (factor, unit_name, confidence)
    """
    try:
        insunits = doc.header.get('$INSUNITS', 0)
        
        # Standard factors
        factors = {
            1: (0.0254, 'Inches', 'High'),
            2: (0.3048, 'Feet', 'High'),
            4: (0.001, 'Millimeters', 'High'),
            5: (0.01, 'Centimeters', 'High'),
            6: (1.0, 'Meters', 'High'),
        }

        # Hint Mapping
        hint_map = {
            'mm': (0.001, 'Millimeters (Hint)'),
            'cm': (0.01, 'Centimeters (Hint)'),
            'm': (1.0, 'Meters (Hint)'),
            'in': (0.0254, 'Inches (Hint)'),
            'ft': (0.3048, 'Feet (Hint)')
        }

        if insunits in factors:
            # If explicit unit matches hint, super high confidence
            # If mismatch, usually trust file, but log warning
            return factors[insunits]

        # If Unitless (0), prioritize Hint
        if insunits == 0 and hint_unit:
            norm_hint = hint_unit.lower().strip()
            if norm_hint in hint_map:
                val, name = hint_map[norm_hint]
                logger.info(f"Unitless DXF: Using hint '{norm_hint}' -> {name}")
                return (val, name, 'Medium')

        # Fallback to Extents Inference
        if insunits == 0:
            try:
                ext_min = doc.header.get('$EXTMIN', (0,0,0))
                ext_max = doc.header.get('$EXTMAX', (0,0,0))
                
                width = ext_max[0] - ext_min[0]
                height = ext_max[1] - ext_min[1]
                max_dim = max(width, height)
                
                if max_dim > 5000:
                    return (0.001, 'Millimeters (Inferred)', 'Medium')
                elif max_dim < 2000:
                    return (1.0, 'Meters (Inferred)', 'Medium')
                else:
                    return (1.0, 'Meters (Default)', 'Low')
                    
            except Exception as e:
                logger.warning(f"Failed to infer units from extents: {e}")
                return (1.0, 'Meters (Fallback)', 'Low')

        return (1.0, 'Meters (Fallback)', 'Low')

    except Exception as e:
        logger.error(f"Error getting unit factor: {e}")
        return (1.0, 'Meters (Error)', 'Low')


def extract_hatch_regions(entity, unit_factor: float = 1.0) -> List[DxfRegion]:
    """
    Extract closed regions from HATCH entities.
    Prioritizes associative paths or explicit boundary paths.
    """
    regions = []
    try:
        # ezdxf Hatch has 'paths' which are BoundaryPaths
        # We process PolylinePath (simple) and EdgePath (lines/arcs)
        # For simplicity, we only handle PolylinePath or simple EdgePath loops for now
        
        # Approximate area check
        hatch_area = 0.0
        if hasattr(entity, 'area'):
            hatch_area = entity.area # This might be 0 if not computed

        # Iterate paths
        for path in entity.paths:
            vertices = []
            
            # Type 1: PolylinePath (Clean vertices)
            if path.PATH_TYPE == 'PolylinePath':
                # path.vertices is list of (x, y, [bulge])
                # We ignore bulge for now (Treat as straight segments approximation)
                raw_verts = [v[:2] for v in path.vertices]
                
                # Check if closed
                if path.is_closed:
                    if raw_verts[0] != raw_verts[-1]:
                        raw_verts.append(raw_verts[0])
                        
                vertices = [Point(x * unit_factor, y * unit_factor) for x, y in raw_verts]
                
            # Type 2: EdgePath (Mixed lines/arcs)
            # Complex to reconstruct. We skip for now unless crucial.
            # Many architect hatches are PolylinePaths (associative).
            
            if len(vertices) > 2:
                # Calculate area if not provided (Shoelace)
                calc_area = 0.0
                if hatch_area <= 0:
                    s = 0.0
                    for i in range(len(vertices)-1):
                        s += vertices[i].x * vertices[i+1].y
                        s -= vertices[i+1].x * vertices[i].y
                    calc_area = abs(s) * 0.5
                else:
                    calc_area = hatch_area * (unit_factor * unit_factor)

                if calc_area > 0.000001:
                    regions.append(DxfRegion(
                        vertices=vertices,
                        layer=entity.dxf.layer,
                        area=calc_area,
                        is_hatch=True
                    ))

    except Exception as e:
        # Hatch extraction is fragile
        pass
        
    return regions


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


def classify_geometry_orientation(entity) -> str:
    """
    Clasifica si una entidad DXF es HORIZONTAL (losa/cielo) o VERTICAL (muro)
    Returns: 'horizontal', 'vertical', 'unknown'
    """
    try:
        # 1. Verificar vector de extrusión (normal vector)
        if hasattr(entity.dxf, 'extrusion'):
            # Si extrusion = (0,0,1) -> entidad paralela al plano XY -> HORIZONTAL
            # Un muro vertical suele tener (0,0,1) si se dibuja en planta, PERO..
            # Si es un LINE/ARC con Z variable, es vertical.
            pass

        # 2. Para LINE: analizar coordenadas Z
        if entity.dxftype() == 'LINE':
            start_z = entity.dxf.start[2] if len(entity.dxf.start) > 2 else 0
            end_z = entity.dxf.end[2] if len(entity.dxf.end) > 2 else 0
            if abs(start_z - end_z) > 0.01:
                return 'vertical'
        
        # 3. HATCH -> Siempre es Superficie (Horizontal en planta)
        if entity.dxftype() == 'HATCH':
            return 'horizontal'

        # 4. 3DFACE -> Verificar si es coplanar XY
        if entity.dxftype() == '3DFACE':
            zs = [v[2] for v in entity.vectors() if len(v) > 2]
            if not zs: return 'horizontal'
            if max(zs) - min(zs) > 0.01:
                return 'vertical'
            return 'horizontal'

    except Exception:
        pass
    
    return 'unknown'

def extract_layer_statistics(doc):
    """
    Analiza TODO el DXF y clasifica cada layer como horizontal/vertical
    """
    msp = doc.modelspace()
    layer_stats = {}
    
    for entity in msp:
        layer_name = entity.dxf.layer
        if layer_name not in layer_stats:
            layer_stats[layer_name] = {
                'horizontal': 0,
                'vertical': 0,
                'unknown': 0,
                'total_entities': 0,
                'entity_types': set()
            }
        
        orientation = classify_geometry_orientation(entity)
        dxftype = entity.dxftype()
        
        layer_stats[layer_name][orientation] += 1
        layer_stats[layer_name]['total_entities'] += 1
        layer_stats[layer_name]['entity_types'].add(dxftype)
    
    final_metadata = {}
    for layer, stats in layer_stats.items():
        total = stats['total_entities']
        if total == 0:
            classification = 'UNKNOWN'
        elif stats['vertical'] > 0: 
             classification = 'VERTICAL'
        elif stats['horizontal'] > 0.8 * total:
            classification = 'HORIZONTAL'
        else:
            classification = 'MIXED'
        
        final_metadata[layer] = {
            'classification': classification,
            'stats': {'h': stats['horizontal'], 'v': stats['vertical']},
            'entity_types': list(stats['entity_types'])
        }
    return final_metadata


from core.block_analyzer import analyze_blocks

# ... (imports)

def parse_dxf_file(file_path: str, hint_unit: str = None) -> ParseResult:
    """
    Main function to parse DXF file and extract all geometry
    """
    try:
        doc = ezdxf.readfile(file_path)
    except Exception as e:
        raise ValueError(f"Failed to read DXF file: {e}")
    
    unit_factor, detected_unit, unit_confidence = get_unit_factor(doc, hint_unit=hint_unit)
    logger.info(f"Unit Inference: {detected_unit} (Factor: {unit_factor}, Confidence: {unit_confidence})")
    
    # 11.1: Extract layer orientation stats
    layer_metadata = extract_layer_statistics(doc)

    # 11.3: Extract block area intelligence
    block_metadata = analyze_blocks(doc)
    
    msp = doc.modelspace()
    
    all_segments: List[Segment] = []
    all_texts: List[TextBlock] = []
    all_inserts: List[BlockReference] = [] # NEW
    all_regions: List[DxfRegion] = [] # NEW: Hatch Priority
    layers = set()
    
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')
    
    for entity in msp:
        layers.add(entity.dxf.layer if hasattr(entity.dxf, 'layer') else "0")
        
        if isinstance(entity, Insert):
             # 11.3 Capture Block Reference
            try:
                pos = entity.dxf.insert
                all_inserts.append(BlockReference(
                    name=entity.dxf.name,
                    position=Point(pos.x, pos.y),
                    layer=entity.dxf.layer or "0",
                    rotation=entity.dxf.rotation,
                    scale_x=entity.dxf.xscale,
                    scale_y=entity.dxf.yscale
                ))
            except Exception:
                pass

            # Block reference - explode it
            segs, texts = explode_block(entity, doc)
            all_segments.extend(segs)
            all_texts.extend(texts)
        
        elif isinstance(entity, (Line, LWPolyline, Polyline, Arc, Circle)):
            segs = extract_line_segments(entity)
            all_segments.extend(segs)

        elif isinstance(entity, Hatch):
            # P1.3 Hatch Priority
            hatch_regions = extract_hatch_regions(entity, unit_factor)
            all_regions.extend(hatch_regions)
        
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

    # 11.3 Scale inserts
    for ins in all_inserts:
        ins.position.x *= unit_factor
        ins.position.y *= unit_factor

    # Update bounds from regions (already scaled)
    for reg in all_regions:
        for v in reg.vertices:
            min_x = min(min_x, v.x)
            min_y = min(min_y, v.y)
            max_x = max(max_x, v.x)
            max_y = max(max_y, v.y)
    
    # Handle case with no geometry
    if min_x == float('inf'):
        min_x, min_y, max_x, max_y = 0, 0, 100, 100
    
    return ParseResult(
        segments=all_segments,
        texts=all_texts,
        inserts=all_inserts,
        layers=list(layers),
        bounds=(min_x, min_y, max_x, max_y),
        unit_factor=unit_factor,
        detected_unit=detected_unit,   # NEW
        unit_confidence=unit_confidence, # NEW
        precomputed_regions=all_regions, # NEW
        layer_metadata=layer_metadata,
        block_metadata=block_metadata
    )
