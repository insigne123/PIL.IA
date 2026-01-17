from api.models import (
    ParseDxfResponse, Segment, TextBlock, Region, Bounds, Point
)
from core.dxf_parser import parse_dxf_file
from core.geometry_cleanup import cleanup_geometry, Segment as ClnSegment, Point as ClnPoint
from core.region_extractor import extract_regions
import os

    """
    CPU-bound task to be run in a separate process.
    """
    import datetime
    try:
        with open("worker.log", "a") as f:
            f.write(f"\n[{datetime.datetime.now()}] Worker started for {file_path}\n")
            if os.path.exists(file_path):
                f.write(f"File exists, size: {os.path.getsize(file_path)} bytes\n")
            else:
                f.write("FILE DOES NOT EXIST!\n")

        result = parse_dxf_file(file_path)
        
        with open("worker.log", "a") as f:
            f.write(f"Parse result: {len(result.segments)} segments, {len(result.texts)} texts\n")
        
        # 1. Map Parser Segments -> Cleanup Segments
        cleanup_segments = [
            ClnSegment(
                start=ClnPoint(s.start.x, s.start.y),
                end=ClnPoint(s.end.x, s.end.y),
                layer=s.layer,
                entity_type=s.entity_type
            ) for s in result.segments
        ]
        
        # Release memory from parser result
        result.segments.clear() 
            
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
        api_segments = [
            Segment(
                start=Point(x=s.start.x, y=s.start.y),
                end=Point(x=s.end.x, y=s.end.y),
                layer=s.layer,
                entity_type=s.entity_type
            ) for s in cleanup_segments
        ]
        
        # 5. Map Parser Texts -> API Models
        api_texts = [
            TextBlock(
                text=t.text,
                position=Point(x=t.position.x, y=t.position.y),
                layer=t.layer,
                height=t.height
            ) for t in result.texts
        ]

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
        print(f"[WorkerProcess] Processing failed: {e}")
        raise e
