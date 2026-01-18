
import ezdxf

def clean_name(name):
    """Sanitize layer names"""
    return name.replace(" ", "_").replace("/", "-")

def create_synthetic_dxf(filename="minimal.dxf"):
    doc = ezdxf.new()
    msp = doc.modelspace()
    
    # 1. Create a Closed Polyline (The Room/Zone)
    # Layer: mb-auxiliar (Floor)
    # 10x10 square -> Area 100
    msp.add_lwpolyline(
        [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)],
        dxfattribs={'layer': 'mb-auxiliar', 'closed': True}
    )
    
    # 2. Add Text Label INSIDE
    # Layer: TEXT
    msp.add_text(
        "SALA DE VENTAS",
        dxfattribs={
            'layer': 'TEXT',
            'height': 0.5,
            'insert': (5, 5)
        }
    )
    
    # 3. Add Line OUTSIDE (Distraction)
    # Layer: A-WALL
    msp.add_line((15, 0), (15, 10), dxfattribs={'layer': 'A-WALL'})

    doc.saveas(filename)
    print(f"Created {filename}")

if __name__ == "__main__":
    create_synthetic_dxf("qa/minimal.dxf")
