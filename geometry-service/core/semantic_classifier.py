"""
Semantic Geometry Classifier

Classifies extracted DXF regions into semantic categories based on:
- Geometric properties (area, aspect ratio, z-level)
- Layer name keywords
- Associated text labels (proximity-based)
- Context (relationship to other regions)

Categories:
- FLOOR: Horizontal surfaces at low Z (losas, pisos, pavimentos)
- WALL: Vertical surfaces (muros, tabiques, partitions)
- CEILING: Horizontal surfaces at high Z (cielos, plafones)
- FIXTURE: Small elements (doors, windows, furniture)
- ANNOTATION: Non-geometric elements (dimensions, notes)
- UNKNOWN: Cannot confidently classify
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from shapely.geometry import Polygon, Point
import logging

logger = logging.getLogger(__name__)


class SemanticCategory:
    """Semantic category definitions with classification criteria"""
    
    FLOOR = {
        'name': 'FLOOR',
        'indicators': {
            'horizontal': True,
            'low_z': True,
            'large_area': True,
            'aspect_ratio_range': (0.2, 5.0)  # Roughly rectangular
        },
        'keywords': [
            'losa', 'sobrelosa', 'piso', 'pavimento', 'floor', 'slab',
            'mortero', 'radier', 'contrapiso', 'carpet', 'tile'
        ],
        'layer_prefixes': ['FA_0', 'FLOOR', 'PISO', 'LOSA'],
        'layer_contains': ['pavimento', 'piso', 'losa']
    }
    
    WALL = {
        'name': 'WALL',
        'indicators': {
            'vertical': True,
            'high_aspect_ratio': True,
            'aspect_ratio_range': (3.0, 50.0)  # Long and narrow
        },
        'keywords': [
            'muro', 'muros', 'wall', 'walls', 'tabique', 'sobretabique',
            'partition', 'divisor', 'panel', 'mamposteria'
        ],
        'layer_prefixes': ['FA_MURO', 'WALL', 'MURO', 'TAB'],
        'layer_contains': ['muro', 'tabique', 'wall']
    }
    
    CEILING = {
        'name': 'CEILING',
        'indicators': {
            'horizontal': True,
            'high_z': True,
            'large_area': True,
            'aspect_ratio_range': (0.2, 5.0)
        },
        'keywords': [
            'cielo', 'cielos', 'ceiling', 'raso', 'plafon', 'volcanita',
            'soffit', 'cenefa', 'falso cielo'
        ],
        'layer_prefixes': ['FA_CIELO', 'CEILING', 'CIELO'],
        'layer_contains': ['cielo', 'raso', 'ceiling', 'volcanita']
    }
    
    FIXTURE = {
        'name': 'FIXTURE',
        'indicators': {
            'small_area': True,
            'block_based': True,
            'aspect_ratio_range': (0.1, 10.0)
        },
        'keywords': [
            'puerta', 'door', 'ventana', 'window', 'mobiliario', 'furniture',
            'sanitario', 'fixture', 'luminaria', 'outlet', 'enchufe'
        ],
        'layer_prefixes': ['DOOR', 'WINDOW', 'FURNITURE', 'FIXTURE'],
        'layer_contains': ['puerta', 'ventana', 'mobiliario']
    }
    
    ANNOTATION = {
        'name': 'ANNOTATION',
        'indicators': {
            'text_dense': True,
            'no_area': True
        },
        'keywords': [
            'text', 'dim', 'dimension', 'cota', 'nota', 'note', 'label',
            'seccion', 'section', 'corte', 'reference', 'grid'
        ],
        'layer_prefixes': ['DIM', 'TEXT', 'NOTE', 'ANNO'],
        'layer_contains': ['text', 'dim', 'cota', 'nota', 'seccion']
    }
    
    @classmethod
    def all_categories(cls):
        return [cls.FLOOR, cls.WALL, cls.CEILING, cls.FIXTURE, cls.ANNOTATION]


class GeometryClassifier:
    """Classifies DXF regions into semantic categories"""
    
    def __init__(self, min_confidence: float = 0.3):
        """
        Args:
            min_confidence: Minimum score to assign a category (otherwise UNKNOWN)
        """
        self.min_confidence = min_confidence
    
    def classify_region(
        self,
        region_poly: Polygon,
        layer: str,
        associated_texts: List[Dict] = None,
        z_level: float = 0.0
    ) -> Tuple[str, float, Dict]:
        """
        Classify a single region
        
        Args:
            region_poly: Shapely Polygon of the region
            layer: Layer name
            associated_texts: List of dicts with 'content' and 'distance' keys
            z_level: Average Z coordinate of region
        
        Returns:
            (category_name, confidence, scoring_details)
        """
        scores = {}
        details = {}
        
        # Calculate geometric features
        area = region_poly.area
        bounds = region_poly.bounds  # (minx, miny, maxx, maxy)
        width = bounds[2] - bounds[0]
        height = bounds[3] - bounds[1]
        aspect_ratio = width / height if height > 0.01 else 0
        
        # Normalize layer name
        layer_lower = layer.lower()
        
        # Prepare text content
        text_content = ''
        if associated_texts:
            text_content = ' '.join([t.get('content', '') for t in associated_texts]).lower()
        
        # Score each category
        for category in SemanticCategory.all_categories():
            score = 0.0
            category_details = {}
            
            # 1. Geometric scoring
            geom_score = self._score_geometry(
                area, aspect_ratio, z_level, category['indicators']
            )
            score += geom_score
            category_details['geometry'] = geom_score
            
            # 2. Layer name scoring
            layer_score = self._score_layer(layer_lower, category)
            score += layer_score
            category_details['layer'] = layer_score
            
            # 3. Associated text scoring
            text_score = self._score_texts(text_content, category['keywords'])
            score += text_score
            category_details['text'] = text_score
            
            # Normalize score to 0-1
            final_score = min(score, 1.0)
            scores[category['name']] = final_score
            details[category['name']] = category_details
        
        # Get best category
        if not scores or max(scores.values()) < self.min_confidence:
            return 'UNKNOWN', 0.0, details
        
        best_category = max(scores, key=scores.get)
        best_score = scores[best_category]
        
        logger.debug(
            f"Region classified as {best_category} with confidence {best_score:.2f} "
            f"(area={area:.2f}, aspect={aspect_ratio:.2f}, z={z_level:.2f})"
        )
        
        return best_category, best_score, details
    
    def _score_geometry(
        self,
        area: float,
        aspect_ratio: float,
        z_level: float,
        indicators: Dict
    ) -> float:
        """Score based on geometric properties"""
        score = 0.0
        
        # Area-based scoring
        if indicators.get('large_area'):
            if area > 10.0:
                score += 0.25
            elif area > 5.0:
                score += 0.15
        
        if indicators.get('small_area'):
            if area < 1.0:
                score += 0.25
            elif area < 5.0:
                score += 0.15
        
        if indicators.get('no_area'):
            if area < 0.01:
                score += 0.3
        
        # Aspect ratio scoring
        aspect_range = indicators.get('aspect_ratio_range')
        if aspect_range:
            min_aspect, max_aspect = aspect_range
            if min_aspect <= aspect_ratio <= max_aspect:
                score += 0.2
        
        if indicators.get('high_aspect_ratio'):
            if aspect_ratio > 3.0:
                score += 0.15
        
        # Z-level scoring (simplified - assumes Z > 2.5m is ceiling)
        if indicators.get('low_z'):
            if z_level < 0.5:
                score += 0.15
        
        if indicators.get('high_z'):
            if z_level > 2.5:
                score += 0.15
        
        # Horizontal/vertical (based on aspect ratio for now)
        if indicators.get('horizontal'):
            if 0.3 <= aspect_ratio <= 3.0:
                score += 0.1
        
        if indicators.get('vertical'):
            if aspect_ratio > 3.0 or aspect_ratio < 0.3:
                score += 0.1
        
        return score
    
    def _score_layer(self, layer_lower: str, category: Dict) -> float:
        """Score based on layer name"""
        score = 0.0
        
        # Prefix matching (strong signal)
        for prefix in category.get('layer_prefixes', []):
            if layer_lower.startswith(prefix.lower()):
                score += 0.35
                break
        
        # Contains matching (medium signal)
        for keyword in category.get('layer_contains', []):
            if keyword.lower() in layer_lower:
                score += 0.25
                break
        
        return score
    
    def _score_texts(self, text_content: str, keywords: List[str]) -> float:
        """Score based on associated text content"""
        if not text_content:
            return 0.0
        
        score = 0.0
        matched_count = 0
        
        for keyword in keywords:
            keyword_lower = keyword.lower()
            
            # Word boundary match (strong)
            if f' {keyword_lower} ' in f' {text_content} ':
                score += 0.25
                matched_count += 1
            # Simple contains (weaker)
            elif keyword_lower in text_content:
                score += 0.15
                matched_count += 1
            
            # Cap at 2 keyword matches to avoid over-scoring
            if matched_count >= 2:
                break
        
        return min(score, 0.4)  # Cap text contribution
    
    def classify_batch(
        self,
        regions: List[Dict]
    ) -> List[Dict]:
        """
        Classify a batch of regions
        
        Args:
            regions: List of region dicts with 'polygon', 'layer', 'associated_texts', 'z_level'
        
        Returns:
            List of regions with added 'semantic_type', 'semantic_confidence', 'semantic_details'
        """
        results = []
        
        for region in regions:
            polygon = region.get('polygon')
            if not polygon:
                logger.warning("Region missing polygon, skipping classification")
                results.append({
                    **region,
                    'semantic_type': 'UNKNOWN',
                    'semantic_confidence': 0.0,
                    'semantic_details': {}
                })
                continue
            
            category, confidence, details = self.classify_region(
                region_poly=polygon,
                layer=region.get('layer', ''),
                associated_texts=region.get('associated_texts', []),
                z_level=region.get('z_level', 0.0)
            )
            
            results.append({
                **region,
                'semantic_type': category,
                'semantic_confidence': confidence,
                'semantic_details': details
            })
        
        return results


# Convenience function for quick classification
def classify_regions(regions: List[Dict], min_confidence: float = 0.3) -> List[Dict]:
    """
    Classify a list of regions
    
    Args:
        regions: List with 'polygon', 'layer', 'associated_texts', 'z_level' keys
        min_confidence: Minimum confidence threshold
    
    Returns:
        Regions with semantic classification added
    """
    classifier = GeometryClassifier(min_confidence=min_confidence)
    return classifier.classify_batch(regions)
