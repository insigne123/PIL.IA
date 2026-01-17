"""
Vision AI Test - Detect labels in PDF using Claude/GPT-4V

Tests the vision AI integration with the user's PDF files.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from vision.label_detector import detect_labels
from vision.image_renderer import render_pdf_page_to_image

# Path to test PDF
PDF_PATH = os.path.join(os.path.dirname(__file__), "..", "LDS_PAK - (LC)-02_CONSTRUCCION.pdf")


def test_vision_detection():
    print("\n" + "=" * 70)
    print("🔭 VISION AI TEST - Label Detection")
    print("=" * 70)
    
    # Check for API keys
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    
    if not anthropic_key and not openai_key:
        print("\n❌ No API keys found!")
        print("   Please create a .env file with your API keys:")
        print("   ANTHROPIC_API_KEY=your_key_here")
        print("   or")
        print("   OPENAI_API_KEY=your_key_here")
        return
    
    print(f"\n✅ API Keys found: Claude={bool(anthropic_key)}, GPT-4V={bool(openai_key)}")
    
    # Check PDF exists
    if not os.path.exists(PDF_PATH):
        print(f"\n❌ PDF not found: {PDF_PATH}")
        return
    
    print(f"\n📄 PDF: {os.path.basename(PDF_PATH)}")
    
    # Step 1: Render PDF to image using PyMuPDF directly (avoids poppler)
    print("\n📸 Step 1: Rendering PDF to high-res image...")
    try:
        import fitz  # PyMuPDF
        import tempfile
        
        doc = fitz.open(PDF_PATH)
        page = doc[0]
        mat = fitz.Matrix(200 / 72, 200 / 72)  # 200 DPI
        pix = page.get_pixmap(matrix=mat)
        
        # Create temp file and close it before PyMuPDF writes to it
        fd, image_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)  # Close the file descriptor so PyMuPDF can write
        
        pix.save(image_path)
        doc.close()
        
        print(f"   ✅ Rendered to: {image_path}")
        print(f"   Image size: {pix.width}x{pix.height} pixels")
    except Exception as e:
        print(f"   ❌ Render failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Step 2: Detect labels with Vision AI
    print("\n🔍 Step 2: Detecting labels with Vision AI...")
    model = "claude" if anthropic_key else "gpt4v"
    print(f"   Using model: {model}")
    
    try:
        result = detect_labels(image_path=image_path, model=model)
        
        print(f"\n   ✅ Detection complete!")
        print(f"   Model used: {result.model_used}")
        print(f"   Labels found: {len(result.labels)}")
        
        if result.labels:
            print("\n   Detected labels:")
            for label in result.labels[:20]:
                print(f"     - '{label.text}' | Type: {label.element_type} | Conf: {label.confidence:.2f}")
        else:
            print("\n   ⚠️ No labels detected. Raw response:")
            print(f"   {result.raw_response[:500]}...")
            
    except Exception as e:
        print(f"   ❌ Detection failed: {e}")
        import traceback
        traceback.print_exc()
    
    # Cleanup temp image
    try:
        os.unlink(image_path)
    except:
        pass


if __name__ == "__main__":
    test_vision_detection()
