"""
Vision AI Label Detector

Uses Claude 3.5 Sonnet or GPT-4 Vision to detect labels and their positions
in architectural drawings.
"""
import anthropic
import openai
from typing import List, Optional, Tuple
from dataclasses import dataclass
import base64
import json
import os
import re


@dataclass
class Label:
    text: str
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels
    element_type: Optional[str] = None  # WALL, CEILING, FLOOR, etc.
    confidence: float = 1.0
    
    @property
    def centroid(self) -> Tuple[float, float]:
        return (
            (self.bbox[0] + self.bbox[2]) / 2,
            (self.bbox[1] + self.bbox[3]) / 2
        )


@dataclass
class DetectionResult:
    labels: List[Label]
    model_used: str
    raw_response: str


DETECTION_PROMPT = """You are an expert at reading Chilean construction and architectural floor plans.

CRITICAL: Scan the ENTIRE image thoroughly. You are looking for text labels that represent:

## PRIORITY 1 - Wall/Partition Types (usually format "TAB XX" or "MUR XX"):
- TAB 01, TAB 02, TAB 03, TAB-01, etc.
- MUR, MURO, TABIQUE
- Look in the center of rooms and along walls

## PRIORITY 2 - Ceiling Types:
- CIELO, CIE, TECHO
- Often in room centers

## PRIORITY 3 - Floor Types:
- PISO, PIE, PAVIMENTO
- SOBRELOSA
- RADIER

## PRIORITY 4 - Area Names:
- SALA, ESTAR, COCINA, BAÑO, BODEGA, OFICINA
- Room names usually centered in spaces

## PRIORITY 5 - Dimensions and Measurements:
- Numbers like "62.38", "30.58" (these are areas in m²)
- Scales like "ESC 1:50" or "ESCALA 1:100"

For EACH label found, return:
{
    "text": "exact text content",
    "bbox": [x1, y1, x2, y2],  // coordinates as % of image (0-100)
    "element_type": "WALL|CEILING|FLOOR|AREA|DIMENSION|SCALE|OTHER",
    "confidence": 0.0-1.0
}

Return JSON:
{
    "labels": [...],
    "scale_detected": "1:50" or null,
    "notes": "observations"
}

IMPORTANT: 
- Be VERY thorough - these are architectural quantity labels that are CRITICAL for construction cost estimation
- Look everywhere: corners, legends, title blocks, room centers
- Even small text matters"""


def encode_image(image_path: str) -> str:
    """Encode image to base64 for API submission"""
    with open(image_path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def get_image_mime_type(image_path: str) -> str:
    """Determine MIME type from file extension"""
    ext = os.path.splitext(image_path)[1].lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    return mime_types.get(ext, "image/png")


def detect_with_claude(image_path: str) -> DetectionResult:
    """
    Detect labels using Claude 3.5 Sonnet Vision
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    
    image_data = encode_image(image_path)
    mime_type = get_image_mime_type(image_path)
    
    message = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": DETECTION_PROMPT
                    }
                ],
            }
        ],
    )
    
    response_text = message.content[0].text
    
    # Parse JSON from response
    labels = parse_detection_response(response_text)
    
    return DetectionResult(
        labels=labels,
        model_used="claude-3-5-sonnet",
        raw_response=response_text
    )


def detect_with_gpt4v(image_path: str) -> DetectionResult:
    """
    Detect labels using GPT-4 Vision
    """
    client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    image_data = encode_image(image_path)
    mime_type = get_image_mime_type(image_path)
    
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_data}"
                        }
                    },
                    {
                        "type": "text",
                        "text": DETECTION_PROMPT
                    }
                ],
            }
        ],
    )
    
    response_text = response.choices[0].message.content
    
    # Parse JSON from response
    labels = parse_detection_response(response_text)
    
    return DetectionResult(
        labels=labels,
        model_used="gpt-4o",
        raw_response=response_text
    )


def parse_detection_response(response_text: str) -> List[Label]:
    """
    Parse JSON response from Vision AI into Label objects
    """
    labels = []
    
    try:
        # Try to extract JSON from response
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            data = json.loads(json_match.group())
            
            for item in data.get("labels", []):
                bbox = item.get("bbox", [0, 0, 0, 0])
                labels.append(Label(
                    text=item.get("text", ""),
                    bbox=tuple(bbox),
                    element_type=item.get("element_type"),
                    confidence=item.get("confidence", 0.8)
                ))
    except json.JSONDecodeError as e:
        print(f"Warning: Failed to parse Vision AI response as JSON: {e}")
    except Exception as e:
        print(f"Warning: Error parsing Vision AI response: {e}")
    
    return labels


def detect_labels(
    image_path: Optional[str] = None,
    dxf_path: Optional[str] = None,
    model: str = "claude"
) -> DetectionResult:
    """
    Main function to detect labels in an image.
    
    Args:
        image_path: Path to image file (PNG, JPG, etc.)
        dxf_path: Path to DXF file (will be rendered to image first)
        model: "claude" or "gpt4v"
    
    Returns:
        DetectionResult with labels and metadata
    """
    # If DXF provided, render to image first
    if dxf_path and not image_path:
        from vision.image_renderer import render_dxf_to_image
        image_path = render_dxf_to_image(dxf_path)
    
    if not image_path:
        raise ValueError("Either image_path or dxf_path must be provided")
    
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")
    
    # Detect using selected model
    if model == "claude":
        try:
            return detect_with_claude(image_path)
        except Exception as e:
            print(f"Claude detection failed: {e}, falling back to GPT-4V")
            return detect_with_gpt4v(image_path)
    else:
        try:
            return detect_with_gpt4v(image_path)
        except Exception as e:
            print(f"GPT-4V detection failed: {e}, falling back to Claude")
            return detect_with_claude(image_path)
