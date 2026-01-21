from api.models import (
    ParseDxfResponse, Segment, TextBlock, Region, Bounds, Point
)
from core.dxf_parser import parse_dxf_file
from core.geometry_cleanup import cleanup_geometry, Segment as ClnSegment, Point as ClnPoint
from core.region_extractor import extract_regions
import os
import traceback
import sys

def process_dxf_task(file_path: str, hint_unit: str = "m") -> ParseDxfResponse:
    """
    CPU-bound task to be run in a separate process.
    """
    import datetime
    try:
        with open("worker.log", "a") as f:
            f.write(f"\n[{datetime.datetime.now()}] Worker started for {file_path} (Hint: {hint_unit})\n")
            if os.path.exists(file_path):
                f.write(f"File exists, size: {os.path.getsize(file_path)} bytes\n")
            else:
                f.write("FILE DOES NOT EXIST!\n")

        result = parse_dxf_file(file_path, hint_unit=hint_unit)
        
        with open("worker.log", "a") as f:
            f.write(f"Parse result: {len(result.segments)} segments, {len(result.texts)} texts\n")
        
        # 1. Map Parser Segments -> Cleanup Segments
        # STRATEGY: WHITELIST + HARD LIMIT to prevent OOM
        # Only keep known architectural layers and enforce 200k segment maximum
        
        # Common architectural layer patterns in Chilean DXF files
        whitelist_patterns = [
            'arq',      # Arquitectura
            'mb',       # Muros/Tabiques base
            'mu',       # Muros
            'tab',      # Tabiques
            'pu',       # Puertas
            'ven',      # Ventanas
            'muro',     # Español
            'wall',     # English
            'door',
            'window',
            'partition',
            'room',
            'space',
            'boundary'
        ]
        
        MAX_SEGMENTS = 200000  # Hard limit to prevent OOM
        
        filtered_segments = []
        skipped_count = 0
        layer_stats = {}  # Track segments per layer for diagnostics
        
        for s in result.segments:
            layer_lower = s.layer.lower()
            
            # Track layer distribution
            if layer_lower not in layer_stats:
                layer_stats[layer_lower] = 0
            layer_stats[layer_lower] += 1
            
            # Whitelist check: Only keep if layer contains architectural keywords
            is_architectural = any(pattern in layer_lower for pattern in whitelist_patterns)
            
            if is_architectural:
                filtered_segments.append(s)
            else:
                skipped_count += 1

        # Apply hard limit with intelligent sampling if needed
        if len(filtered_segments) > MAX_SEGMENTS:
            with open("worker.log", "a") as f:
                f.write(f"⚠️  WARNING: {len(filtered_segments)} segments exceed limit of {MAX_SEGMENTS}\n")
                f.write(f"Applying intelligent sampling (keeping every Nth segment)\n")
            
            # Calculate sampling rate
            sampling_rate = len(filtered_segments) / MAX_SEGMENTS
            sampled = []
            for i, seg in enumerate(filtered_segments):
                if i % int(sampling_rate) == 0:
                    sampled.append(seg)
                if len(sampled) >= MAX_SEGMENTS:
                    break
            
            filtered_segments = sampled

        with open("worker.log", "a") as f:
            f.write(f"Layer Filtering: Kept {len(filtered_segments)} segments (Skipped {skipped_count} noise segments)\n")
            # Log top 5 layers by segment count
            sorted_layers = sorted(layer_stats.items(), key=lambda x: x[1], reverse=True)[:5]
            f.write(f"Top 5 layers: {sorted_layers}\n")

        cleanup_segments = [
            ClnSegment(
                start=ClnPoint(s.start.x, s.start.y),
                end=ClnPoint(s.end.x, s.end.y),
                layer=s.layer,
                entity_type=s.entity_type
            ) for s in filtered_segments
        ]
        
        # Release memory from parser result immediately
        result.segments.clear() 
        del filtered_segments
        del layer_stats 
            
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
            
        # P1.3: Merge Precomputed Hatch Regions
        if getattr(result, 'precomputed_regions', None):
            import uuid
            for h in result.precomputed_regions:
                # Calculate simple centroid
                cx = sum(v.x for v in h.vertices) / len(h.vertices)
                cy = sum(v.y for v in h.vertices) / len(h.vertices)
                
                # Calculate perimeter
                perimeter = 0.0
                for i in range(len(h.vertices)):
                    j = (i + 1) % len(h.vertices)
                    dx = h.vertices[j].x - h.vertices[i].x
                    dy = h.vertices[j].y - h.vertices[i].y
                    perimeter += (dx*dx + dy*dy)**0.5
                    
                p_vertices = [Point(x=v.x, y=v.y) for v in h.vertices]
                
                api_regions.append(Region(
                    id=f"hatch_{uuid.uuid4().hex[:8]}",
                    vertices=p_vertices,
                    area=h.area,
                    perimeter=perimeter,
                    centroid=Point(x=cx, y=cy),
                    layer=h.layer
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

        # NEW: Map Inserts -> API Models
        from api.models import BlockReference as ApiBlockRef
        api_inserts = [
            ApiBlockRef(
                name=ins.name,
                position=Point(x=ins.position.x, y=ins.position.y),
                layer=ins.layer,
                rotation=ins.rotation,
                scale_x=ins.scale_x,
                scale_y=ins.scale_y
            ) for ins in result.inserts
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
            inserts=api_inserts, # NEW
            layers=result.layers,

            bounds=api_bounds,
            regions=api_regions,
            unit_factor=getattr(result, 'unit_factor', 1.0),
            detected_unit=getattr(result, 'detected_unit', 'Unknown'),
            unit_confidence=getattr(result, 'unit_confidence', 'Low'),
            layer_metadata=getattr(result, 'layer_metadata', None),
            block_metadata=getattr(result, 'block_metadata', None)
        )

    except Exception as e:
        error_msg = f"[WorkerProcess] Processing failed: {e}\n{traceback.format_exc()}"
        print(error_msg) # Keep printing for visible feedback
        
        # Log to python_errors.log
        try:
            with open("python_errors.log", "a") as f:
                f.write(f"\n[{datetime.datetime.now()}] CRITICAL ERROR in process_dxf_task:\n")
                f.write(error_msg + "\n" + "-"*40 + "\n")
                
            with open("worker.log", "a") as f:
                f.write(f"FAILED: {e}\n")
        except:
            pass # Last resort if disk full or permissions
            
        raise e
