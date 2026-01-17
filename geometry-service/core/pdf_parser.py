"""
PDF Parser with dual mode (Vector + Raster)

Uses PyMuPDF for vector extraction and pdf2image for rasterization.
"""
import fitz  # PyMuPDF
from pdf2image import convert_from_path
from PIL import Image
from typing import List, Tuple, Optional
from dataclasses import dataclass
import tempfile
import os


@dataclass
class Point:
    x: float
    y: float


@dataclass
class Segment:
    start: Point
    end: Point
    layer: str
    entity_type: str


@dataclass
class TextBlock:
    text: str
    position: Point
    layer: str
    height: float


@dataclass
class ParseResult:
    segments: List[Segment]
    texts: List[TextBlock]
    pages: int
    images: List[str]  # Paths to rasterized images


def extract_vectors_from_page(page, page_num: int) -> Tuple[List[Segment], List[TextBlock]]:
    """
    Extract vector paths and text from a PDF page using PyMuPDF
    """
    segments = []
    texts = []
    
    # Get page dimensions for coordinate conversion
    rect = page.rect
    height = rect.height
    
    # Extract drawings (vector paths)
    try:
        drawings = page.get_drawings()
        for drawing in drawings:
            items = drawing.get("items", [])
            for item in items:
                if item[0] == "l":  # Line
                    p1 = item[1]
                    p2 = item[2]
                    segments.append(Segment(
                        start=Point(p1.x, height - p1.y),  # Flip Y
                        end=Point(p2.x, height - p2.y),
                        layer=f"page_{page_num}",
                        entity_type="PDF_LINE"
                    ))
                elif item[0] == "c":  # Curve (approximate as line segments)
                    points = item[1:]
                    for i in range(len(points) - 1):
                        segments.append(Segment(
                            start=Point(points[i].x, height - points[i].y),
                            end=Point(points[i+1].x, height - points[i+1].y),
                            layer=f"page_{page_num}",
                            entity_type="PDF_CURVE"
                        ))
                elif item[0] == "re":  # Rectangle
                    rect = item[1]
                    corners = [
                        Point(rect.x0, height - rect.y0),
                        Point(rect.x1, height - rect.y0),
                        Point(rect.x1, height - rect.y1),
                        Point(rect.x0, height - rect.y1),
                    ]
                    for i in range(4):
                        segments.append(Segment(
                            start=corners[i],
                            end=corners[(i+1) % 4],
                            layer=f"page_{page_num}",
                            entity_type="PDF_RECT"
                        ))
    except Exception as e:
        print(f"Warning: Failed to extract vectors from page {page_num}: {e}")
    
    # Extract text blocks
    try:
        text_dict = page.get_text("dict")
        for block in text_dict.get("blocks", []):
            if block.get("type") == 0:  # Text block
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if text:
                            bbox = span.get("bbox", [0, 0, 0, 0])
                            texts.append(TextBlock(
                                text=text,
                                position=Point(
                                    (bbox[0] + bbox[2]) / 2,  # Center X
                                    height - (bbox[1] + bbox[3]) / 2  # Center Y, flipped
                                ),
                                layer=f"page_{page_num}",
                                height=span.get("size", 10)
                            ))
    except Exception as e:
        print(f"Warning: Failed to extract text from page {page_num}: {e}")
    
    return segments, texts


def rasterize_pdf(file_path: str, dpi: int = 300) -> List[str]:
    """
    Rasterize PDF pages to high-resolution images for Vision AI
    """
    image_paths = []
    
    try:
        images = convert_from_path(file_path, dpi=dpi)
        
        for i, image in enumerate(images):
            # Save to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix=f"_page_{i}.png") as tmp:
                image.save(tmp.name, "PNG")
                image_paths.append(tmp.name)
    except Exception as e:
        print(f"Warning: Failed to rasterize PDF: {e}")
        # Fallback: use PyMuPDF's pixmap
        try:
            doc = fitz.open(file_path)
            for i, page in enumerate(doc):
                mat = fitz.Matrix(dpi / 72, dpi / 72)
                pix = page.get_pixmap(matrix=mat)
                with tempfile.NamedTemporaryFile(delete=False, suffix=f"_page_{i}.png") as tmp:
                    pix.save(tmp.name)
                    image_paths.append(tmp.name)
            doc.close()
        except Exception as e2:
            print(f"Warning: Fallback rasterization also failed: {e2}")
    
    return image_paths


def parse_pdf_file(file_path: str, rasterize: bool = True, dpi: int = 300) -> ParseResult:
    """
    Main function to parse PDF file
    
    Args:
        file_path: Path to PDF file
        rasterize: Whether to also create rasterized images for Vision AI
        dpi: DPI for rasterization
    
    Returns:
        ParseResult with segments, texts, and optionally rasterized images
    """
    doc = fitz.open(file_path)
    
    all_segments: List[Segment] = []
    all_texts: List[TextBlock] = []
    
    for page_num, page in enumerate(doc):
        segments, texts = extract_vectors_from_page(page, page_num)
        all_segments.extend(segments)
        all_texts.extend(texts)
    
    pages = len(doc)
    doc.close()
    
    # Rasterize for Vision AI if requested
    images = []
    if rasterize:
        images = rasterize_pdf(file_path, dpi=dpi)
    
    # Normalize coordinates to meters (assuming 1 PDF unit = 1/72 inch)
    # Standard architectural scale: 1:100 means 1cm on paper = 1m in reality
    # At 72 DPI, 1 inch = 72 units, so 1 meter ≈ 2.83 units at 1:100 scale
    # This is a rough approximation - actual scale detection is complex
    SCALE_FACTOR = 0.01  # Assume 1:100 scale, 1 unit = 1cm = 0.01m
    
    for seg in all_segments:
        seg.start.x *= SCALE_FACTOR
        seg.start.y *= SCALE_FACTOR
        seg.end.x *= SCALE_FACTOR
        seg.end.y *= SCALE_FACTOR
    
    for text in all_texts:
        text.position.x *= SCALE_FACTOR
        text.position.y *= SCALE_FACTOR
    
    return ParseResult(
        segments=all_segments,
        texts=all_texts,
        pages=pages,
        images=images
    )
