"""
API Routes for Geometry Extraction Service
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional, List
import json
import tempfile
import os

from api.models import (
    ExtractResponse,
    ParseDxfResponse, ParsePdfResponse,
    DetectLabelsResponse,
    Segment, TextBlock, Region, Bounds, Point
)
from core.dxf_parser import parse_dxf_file
from core.pdf_parser import parse_pdf_file
from core.geometry_cleanup import cleanup_geometry
from core.region_extractor import extract_regions
from core.text_associator import associate_text_to_regions
from vision.label_detector import detect_labels
from qa.sanity_checks import run_sanity_checks
from qa.confidence_scorer import compute_confidence

router = APIRouter()


@router.post("/extract", response_model=ExtractResponse)
async def extract_quantities(
    dxf_file: Optional[UploadFile] = File(None),
    pdf_files: Optional[List[UploadFile]] = File(None),
    excel_data: str = Form(...),
    use_vision_ai: bool = Form(True),
    snap_tolerance: float = Form(0.01),
    vision_model: str = Form("claude")
):
    """
    Main extraction endpoint - processes DXF/PDF and returns matched quantities
    """
    try:
        excel_items = json.loads(excel_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid excel_data JSON")
    
    all_segments = []
    all_texts = []
    all_labels = []
    
    # Parse DXF if provided
    if dxf_file:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".dxf") as tmp:
            content = await dxf_file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        try:
            dxf_result = parse_dxf_file(tmp_path)
            all_segments.extend(dxf_result.segments)
            all_texts.extend(dxf_result.texts)
        finally:
            os.unlink(tmp_path)
    
    # Parse PDFs if provided
    if pdf_files:
        for pdf_file in pdf_files:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                content = await pdf_file.read()
                tmp.write(content)
                tmp_path = tmp.name
            
            try:
                pdf_result = parse_pdf_file(tmp_path)
                all_segments.extend(pdf_result.segments)
                all_texts.extend(pdf_result.texts)
            finally:
                os.unlink(tmp_path)
    
    if not all_segments:
        raise HTTPException(status_code=400, detail="No geometry found in input files")
    
    # Vision AI label detection (optional)
    if use_vision_ai and (dxf_file or pdf_files):
        # Render to image and detect labels
        labels_result = detect_labels(
            dxf_path=tmp_path if dxf_file else None,
            model=vision_model
        )
        all_labels.extend(labels_result.labels)
    
    # Geometry cleanup
    cleaned_segments = cleanup_geometry(
        all_segments, 
        snap_tolerance=snap_tolerance
    )
    
    # Extract regions (cycles from planar graph)
    regions = extract_regions(cleaned_segments)
    
    # Associate text/labels to regions
    matches = associate_text_to_regions(
        regions=regions,
        labels=all_labels + all_texts,
        excel_items=excel_items
    )
    
    # QA checks and confidence scoring
    validated_matches = []
    for match in matches:
        sanity_result = run_sanity_checks(match)
        confidence = compute_confidence(match, sanity_result)
        match.confidence = confidence
        match.warnings = sanity_result.warnings
        validated_matches.append(match)
    
    # Find unmatched items
    matched_ids = {m.excel_item_id for m in validated_matches}
    unmatched = [item for item in excel_items if item.get('id') not in matched_ids]
    
    return ExtractResponse(
        matches=validated_matches,
        unmatched_items=unmatched,
        warnings=[],
        processing_time_ms=0  # TODO: Add timing
    )


@router.post("/parse-dxf", response_model=ParseDxfResponse)
async def parse_dxf(
    file: UploadFile = File(...)
):
    """Parse DXF file and return raw geometry/text"""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".dxf") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # Imports for type conversion (local to avoid circular imports elsewhere if any)
        from core.geometry_cleanup import Segment as ClnSegment, Point as ClnPoint, cleanup_geometry
        from core.region_extractor import extract_regions
        
        try:
            result = parse_dxf_file(tmp_path)
            
            # 1. Map Parser Segments -> Cleanup Segments (for region extraction)
            cleanup_segments = []
            for s in result.segments:
                cleanup_segments.append(ClnSegment(
                    start=ClnPoint(s.start.x, s.start.y),
                    end=ClnPoint(s.end.x, s.end.y),
                    layer=s.layer,
                    entity_type=s.entity_type
                ))
                
            # 2. Extract Regions
            cleaned_segments = cleanup_geometry(cleanup_segments, snap_tolerance=0.01)
            extracted_regions = extract_regions(cleaned_segments)
            
            # 3. Map Regions -> API Models
            api_regions = []
            for r in extracted_regions:
                p_vertices = [Point(x=v.x, y=v.y) for v in r.vertices]
                p_centroid = Point(x=r.centroid.x, y=r.centroid.y)
                api_regions.append(Region(
                    id=r.id,
                    vertices=p_vertices,
                    area=r.area,
                    perimeter=r.perimeter,
                    centroid=p_centroid,
                    layer=r.layer
                ))

            # 4. Map Parser Segments -> API Models
            api_segments = []
            for s in result.segments:
                api_segments.append(Segment(
                    start=Point(x=s.start.x, y=s.start.y),
                    end=Point(x=s.end.x, y=s.end.y),
                    layer=s.layer,
                    entity_type=s.entity_type
                ))

            # 5. Map Parser Texts -> API Models
            api_texts = []
            for t in result.texts:
                api_texts.append(TextBlock(
                    text=t.text,
                    position=Point(x=t.position.x, y=t.position.y),
                    layer=t.layer,
                    height=t.height
                ))

            # 6. Map Bounds -> API Model
            api_bounds = Bounds(
                min_x=result.bounds[0],
                min_y=result.bounds[1],
                max_x=result.bounds[2],
                max_y=result.bounds[3]
            )

            return ParseDxfResponse(
                segments=api_segments,
                texts=api_texts,
                layers=result.layers,
                bounds=api_bounds,
                regions=api_regions
            )

        except Exception as e:
            # Fallback for parsing errors
            print(f"[ParseDxf] Processing failed: {e}")
            
            # Try to return partial result if parsing succeeded but extraction failed
            if 'result' in locals():
                # Map minimally
                try:
                    api_segments = [Segment(start=Point(x=s.start.x, y=s.start.y), end=Point(x=s.end.x, y=s.end.y), layer=s.layer, entity_type=s.entity_type) for s in result.segments]
                    api_texts = [TextBlock(text=t.text, position=Point(x=t.position.x, y=t.position.y), layer=t.layer, height=t.height) for t in result.texts]
                    api_bounds = Bounds(min_x=result.bounds[0], min_y=result.bounds[1], max_x=result.bounds[2], max_y=result.bounds[3])
                    
                    return ParseDxfResponse(
                        segments=api_segments,
                        texts=api_texts,
                        layers=result.layers,
                        bounds=api_bounds,
                        regions=[] 
                    )
                except Exception:
                    pass
            
            # Return empty response if all else fails (avoid 500)
            return ParseDxfResponse(
                segments=[],
                texts=[],
                layers=[],
                bounds=Bounds(min_x=0, min_y=0, max_x=0, max_y=0),
                regions=[]
            )
    finally:
        os.unlink(tmp_path)


@router.post("/parse-pdf", response_model=ParsePdfResponse)
async def parse_pdf(
    file: UploadFile = File(...)
):
    """Parse PDF file (vector + raster modes)"""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        result = parse_pdf_file(tmp_path)
        return ParsePdfResponse(
            segments=result.segments,
            texts=result.texts,
            pages=result.pages
        )
    finally:
        os.unlink(tmp_path)


@router.post("/detect-labels", response_model=DetectLabelsResponse)
async def detect_labels_endpoint(
    file: UploadFile = File(...),
    model: str = Form("claude")
):
    """Detect labels using Vision AI"""
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        result = detect_labels(image_path=tmp_path, model=model)
        return DetectLabelsResponse(
            labels=result.labels,
            model_used=model
        )
    finally:
        os.unlink(tmp_path)
