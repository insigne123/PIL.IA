"""
Image Renderer - Convert DXF/PDF to high-resolution images

For use with Vision AI and visual debugging.
"""
import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import matplotlib.pyplot as plt
from PIL import Image
import tempfile
import os
from typing import Optional


def render_dxf_to_image(
    dxf_path: str,
    output_path: Optional[str] = None,
    dpi: int = 300,
    background: str = "white"
) -> str:
    """
    Render DXF file to a high-resolution PNG image.
    
    Args:
        dxf_path: Path to DXF file
        output_path: Optional output path (defaults to temp file)
        dpi: Resolution in dots per inch
        background: Background color ("white", "black", etc.)
    
    Returns:
        Path to generated image
    """
    # Read DXF
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    
    # Set up matplotlib figure
    fig = plt.figure(dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    
    # Create render context and backend
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    
    # Render
    Frontend(ctx, out).draw_layout(msp)
    
    # Configure appearance
    ax.set_facecolor(background)
    ax.set_aspect('equal')
    ax.autoscale()
    
    # Remove axes
    ax.set_axis_off()
    
    # Save
    if output_path is None:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        output_path = tmp.name
        tmp.close()
    
    fig.savefig(output_path, dpi=dpi, bbox_inches='tight', 
                facecolor=background, edgecolor='none')
    plt.close(fig)
    
    return output_path


def render_pdf_page_to_image(
    pdf_path: str,
    page_num: int = 0,
    output_path: Optional[str] = None,
    dpi: int = 300
) -> str:
    """
    Render a PDF page to a high-resolution image.
    
    Args:
        pdf_path: Path to PDF file
        page_num: Page number (0-indexed)
        output_path: Optional output path
        dpi: Resolution
    
    Returns:
        Path to generated image
    """
    try:
        from pdf2image import convert_from_path
        
        images = convert_from_path(
            pdf_path,
            dpi=dpi,
            first_page=page_num + 1,
            last_page=page_num + 1
        )
        
        if not images:
            raise ValueError(f"No pages found in PDF")
        
        image = images[0]
        
    except ImportError:
        # Fallback to PyMuPDF
        import fitz
        
        doc = fitz.open(pdf_path)
        page = doc[page_num]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to PIL
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        doc.close()
    
    # Save
    if output_path is None:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        output_path = tmp.name
        tmp.close()
    
    image.save(output_path, "PNG")
    
    return output_path


def create_debug_overlay(
    base_image_path: str,
    regions: list,
    labels: list,
    output_path: Optional[str] = None
) -> str:
    """
    Create a debug image with regions and labels overlaid.
    Useful for visual verification of extraction results.
    
    Args:
        base_image_path: Path to base image
        regions: List of Region objects to draw
        labels: List of Label objects to draw
        output_path: Optional output path
    
    Returns:
        Path to overlay image
    """
    from PIL import ImageDraw, ImageFont
    
    # Load base image
    img = Image.open(base_image_path)
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # Draw regions as semi-transparent polygons
    for i, region in enumerate(regions):
        if hasattr(region, 'vertices'):
            points = [(v.x, v.y) for v in region.vertices]
            # Random color based on index
            color = (
                (i * 67) % 255,
                (i * 137) % 255,
                (i * 97) % 255,
                100  # Alpha
            )
            draw.polygon(points, fill=color, outline=(0, 0, 0, 255))
    
    # Draw labels
    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except:
        font = ImageFont.load_default()
    
    for label in labels:
        if hasattr(label, 'bbox'):
            x1, y1, x2, y2 = label.bbox
            draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0, 255), width=2)
            draw.text((x1, y1 - 15), label.text, fill=(255, 0, 0, 255), font=font)
    
    # Save
    if output_path is None:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix="_debug.png")
        output_path = tmp.name
        tmp.close()
    
    img.save(output_path, "PNG")
    
    return output_path
