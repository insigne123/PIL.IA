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


# Global ProcessPoolExecutor
from concurrent.futures import ProcessPoolExecutor
import asyncio

# Initialize with 2 workers to avoid over-subscribing in limited environments
# One for processing, one spare, leaving CPU for main loop
process_pool = ProcessPoolExecutor(max_workers=2)

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
        from core.processing_task import process_dxf_task
        
        loop = asyncio.get_running_loop()
        # Run in separate process to bypass GIL
        return await loop.run_in_executor(process_pool, process_dxf_task, tmp_path)
        
    except Exception as e:
        print(f"[ParseDxf] Error in process pool: {e}")
        # Fallback empty response
        return ParseDxfResponse(
            segments=[],
            texts=[],
            layers=[],
            bounds=Bounds(min_x=0, min_y=0, max_x=0, max_y=0),
            regions=[]
        )
    finally:
        if os.path.exists(tmp_path):
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
