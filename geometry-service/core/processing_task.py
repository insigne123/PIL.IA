from api.models import (
    ParseDxfResponse, Segment, TextBlock, Region, Bounds, Point
)
from core.dxf_parser import parse_dxf_file
from core.geometry_cleanup import cleanup_geometry, Segment as ClnSegment, Point as ClnPoint
from core.region_extractor import extract_regions
from core.semantic_classifier import GeometryClassifier
from core.spatial_text_matcher import SpatialTextMatcher  
from core.multi_resolution_extractor import MultiResolutionExtractor
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
            
        # 2. SEMANTIC REGION EXTRACTION PIPELINE
        import logging
        from shapely.geometry import LineString, Polygon
        
        logger = logging.getLogger(__name__)
        logger.info("Starting semantic region extraction pipeline...")
        
        # 2.1 Group segments by layer for multi-resolution processing
        layer_segments = {}
        for seg in cleanup_segments:
            if seg.layer not in layer_segments:
                layer_segments[seg.layer] = []
            layer_segments[seg.layer].append(seg)
        
        logger.info(f"Grouped segments into {len(layer_segments)} layers")
        
        # 2.2 Multi-resolution extraction
        multi_res_extractor = MultiResolutionExtractor(
            coarse_threshold=10.0,
            medium_threshold=1.0
        )
        
        all_regions_multiRes = []
        
        for layer, segs in layer_segments.items():
            try:
                # Convert to Shapely LineStrings
                line_strings = []
                for seg in segs:
                    try:
                        ls = LineString([(seg.start.x, seg.start.y), (seg.end.x, seg.end.y)])
                        line_strings.append(ls)
                    except Exception:
                        continue
                
                if not line_strings:
                    continue
                
                # Extract at multiple resolutions
                multi_res = multi_res_extractor.extract_multi_resolution(line_strings, layer)
                
                # Collect all resolution levels
                for resolution_level in ['coarse', 'medium', 'fine']:
                    for region_dict in multi_res.get(resolution_level, []):
                        all_regions_multiRes.append(region_dict)
                        
            except Exception as e:
                logger.error(f"Failed multi-res extraction for layer {layer}: {e}")
                continue
        
        logger.info(f"Extracted {len(all_regions_multiRes)} regions across all resolutions")
        
        # 2.3 Spatial text association
        text_matcher = SpatialTextMatcher(max_distance=5.0)
        
        texts_for_matcher = []
        for t in result.texts:
            texts_for_matcher.append({
                'content': t.text,
                'position': (t.position.x, t.position.y, 0.0),
                'layer': t.layer
            })
        
        regions_with_texts = text_matcher.associate_texts_to_regions(
            all_regions_multiRes,
            texts_for_matcher
        )
        
        logger.info(f"Associated texts to regions")
        
        # 2.4 Semantic classification
        classifier = GeometryClassifier(min_confidence=0.3)
        classified_regions = classifier.classify_batch(regions_with_texts)
        
        logger.info(f"Classified regions semantically")
        
        # 2.5 Map to API models with semantic fields
        api_regions = []
        for r in classified_regions:
            try:
                # Extract vertices
                vertices = r.get('vertices', [])
                if not vertices:
                    continue
                
                p_vertices = [Point(x=v[0], y=v[1]) for v in vertices]
                
                # Extract centroid
                centroid = r.get('centroid', {})
                p_centroid = Point(x=centroid.get('x', 0.0), y=centroid.get('y', 0.0))
                
                # Calculate perimeter if not present
                perimeter = r.get('perimeter', 0.0)
                if perimeter == 0.0 and len(vertices) > 2:
                    for i in range(len(vertices)):
                        j = (i + 1) % len(vertices)
                        dx = vertices[j][0] - vertices[i][0]
                        dy = vertices[j][1] - vertices[i][1]
                        perimeter += (dx*dx + dy*dy)**0.5
                
                api_regions.append(Region(
                    id=r.get('id', f"region_{len(api_regions)}"),
                    vertices=p_vertices,
                    area=r.get('area', 0.0),
                    perimeter=perimeter,
                    centroid=p_centroid,
                    layer=r.get('layer', 'unknown'),
                    # NEW SEMANTIC FIELDS:
                    resolution=r.get('resolution'),
                    semantic_type=r.get('semantic_type'),
                    semantic_confidence=r.get('semantic_confidence'),
                    associated_texts=r.get('associated_texts', [])
                ))
                
            except Exception as e:
                logger.error(f"Failed to map region to API model: {e}")
                continue
        
        logger.info(f"Mapped {len(api_regions)} regions to API models")
            
        # 2.6 Merge Precomputed Hatch Regions (with semantic classification)
        if getattr(result, 'precomputed_regions', None):
            import uuid
            
            hatch_regions_for_classification = []
            
            for h in result.precomputed_regions:
                # Calculate centroid
                cx = sum(v.x for v in h.vertices) / len(h.vertices)
                cy = sum(v.y for v in h.vertices) / len(h.vertices)
                
                # Calculate perimeter
                perimeter = 0.0
                for i in range(len(h.vertices)):
                    j = (i + 1) % len(h.vertices)
                    dx = h.vertices[j].x - h.vertices[i].x
                    dy = h.vertices[j].y - h.vertices[i].y
                    perimeter += (dx*dx + dy*dy)**0.5
                
                # Create polygon for classification
                try:
                    vertices_list = [(v.x, v.y) for v in h.vertices]
                    poly = Polygon(vertices_list)
                    
                    hatch_regions_for_classification.append({
                        'id': f"hatch_{uuid.uuid4().hex[:8]}",
                        'polygon': poly,
                        'vertices': vertices_list,
                        'area': h.area,
                        'perimeter': perimeter,
                        'centroid': {'x': cx, 'y': cy},
                        'layer': h.layer,
                        'associated_texts': [],  # Will be filled
                        'z_level': 0.0
                    })
                except Exception as e:
                    logger.warning(f"Failed to create polygon for hatch region: {e}")
                    continue
            
            # Classify hatch regions
            if hatch_regions_for_classification:
                hatch_with_texts = text_matcher.associate_texts_to_regions(
                    hatch_regions_for_classification,
                    texts_for_matcher
                )
                classified_hatches = classifier.classify_batch(hatch_with_texts)
                
                for h_classified in classified_hatches:
                    p_vertices = [Point(x=v[0], y=v[1]) for v in h_classified['vertices']]
                    
                    api_regions.append(Region(
                        id=h_classified['id'],
                        vertices=p_vertices,
                        area=h_classified['area'],
                        perimeter=h_classified['perimeter'],
                        centroid=Point(x=h_classified['centroid']['x'], y=h_classified['centroid']['y']),
                        layer=h_classified['layer'],
                        resolution='fine',  # Hatches are typically detailed
                        semantic_type=h_classified.get('semantic_type'),
                        semantic_confidence=h_classified.get('semantic_confidence'),
                        associated_texts=h_classified.get('associated_texts', [])
                    ))
                
                logger.info(f"Added {len(classified_hatches)} classified hatch regions")

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
