
from typing import List, Any
import logging

logger = logging.getLogger(__name__)

# "Conservative" Blacklist - Only remove things that DEFINITELY are not architecture
BLACKLIST_KEYWORDS = [
    # Furniture / Mobiliario
    "FURN", "MUEB", "SILLA", "MESA", "SOFA", "CAM", "BED", "CLOSET",
    
    # Vegetation / Paisajismo
    "VEG", "ARB", "TREE", "PLANT", "JARDIN", "PAISAJE",
    
    # Annotations / Text (Exploded)
    "TEXT", "TXT", "NOTA", "ANNO", "DIM", "COTA", "ETIQUETA", "LABEL",
    
    # Hatching (Patterns) - Unless specific floor hatches?
    # Keeping generic 'HATCH' might be risky if floors are hatches.
    # But usually dense hatches are decoration.
    "PATT", "PATTERN", "RELLENO", "SOMBRA",
    
    # Metadata / System
    "DEFPOINTS", "VIEWPORT"
]

# Specific check for HATCH: 
# If a layer is explicitly named "HATCH" or "HATCHING", it is usually decoration.
# But "FLOOR_HATCH" might be valid. 
# For now, we put "HATCH" in blacklist if strictly present? 
# No, let's stick to safe keywords.

def should_keep_layer(layer_name: str) -> bool:
    """
    Returns True if the layer should be PROCESSED.
    Returns False if the layer is on the Blacklist (Safe to ignore).
    """
    if not layer_name:
        return True # Process unnamed layers just in case
        
    u_name = layer_name.upper()
    
    for kw in BLACKLIST_KEYWORDS:
        if kw in u_name:
            # Check for exclusions? e.g. "TEXT_FLOOR"? 
            # Assuming any layer with "MUEB" is furniture.
            return False
            
    return True

def filter_segments(segments: List[Any], force_full_scan: bool = False) -> List[Any]:
    """
    Filters a list of segments/entities based on their layer name.
    """
    if force_full_scan:
        logger.info(f"Full Scan enabled: Processing all {len(segments)} segments.")
        return segments
        
    kept = []
    skipped_count = 0
    
    for s in segments:
        if should_keep_layer(s.layer):
            kept.append(s)
        else:
            skipped_count += 1
            
    logger.info(f"Smart Filter: Kept {len(kept)} segments. Skipped {skipped_count} (Noise).")
    return kept
