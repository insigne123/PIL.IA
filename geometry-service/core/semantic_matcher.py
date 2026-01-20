"""
Semantic Matcher - Intelligent Layer/Item Matching
Uses synonyms, fuzzy matching, and optional LLM fallback to match construction terms.
"""
import os
import logging
import requests
import json
from typing import List, Optional, Tuple, Any
from difflib import SequenceMatcher
import re

logger = logging.getLogger(__name__)

# Hardcoded Construction Synonyms (Level 1 Intelligence)
SYNONYMS = {
    "muro": ["tabique", "murete", "wall", "pantalla", "hormigon"],
    "losa": ["radier", "sobrelosa", "slab", "floor", "piso", "pavimento"],
    "cielo": ["ceiling", "falso", "volcanita", "yeso"],
    "puerta": ["door", "acceso", "porton"],
    "ventana": ["window", "vidrio", "cristal"],
    "impermeabilizacion": ["membrana", "waterproof", "aislacion"],
    "estuco": ["revestimiento", "mortero", "plaster"],
    "ceramica": ["porcelanato", "baldoza", "tile"],
}

class SemanticMatcher:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.use_llm = bool(self.api_key)
        
    def normalize(self, text: str) -> str:
        if not text: return ""
        text = text.lower()
        text = re.sub(r'[^\w\s]', ' ', text)
        return text.strip()

    def get_synonyms(self, term: str) -> List[str]:
        term = self.normalize(term)
        for key, syns in SYNONYMS.items():
            if term == key or term in syns:
                return [key] + syns
        return []

    def fuzzy_score(self, t1: str, t2: str) -> float:
        return SequenceMatcher(None, t1, t2).ratio()

    def match(self, target: str, candidates: List[str], threshold: float = 0.5) -> List[Tuple[str, float, str]]:
        """
        Match target text against a list of candidates.
        Returns list of (candidate, score, strategy)
        """
        results = []
        target_norm = self.normalize(target)
        target_synonyms = self.get_synonyms(target_norm)
        
        for cand in candidates:
            cand_norm = self.normalize(cand)
            
            # 1. Exact Match
            if target_norm == cand_norm:
                results.append((cand, 1.0, "exact"))
                continue
                
            # 2. Synonym Match
            is_synonym = False
            for syn in target_synonyms:
                if syn in cand_norm:
                    results.append((cand, 0.95, "synonym"))
                    is_synonym = True
                    break
            if is_synonym:
                continue

            # 3. Fuzzy Match
            score = self.fuzzy_score(target_norm, cand_norm)
            if score >= threshold:
                results.append((cand, score, "fuzzy"))
        
        # Sort by score
        results.sort(key=lambda x: x[1], reverse=True)
        return results

    def ask_llm_match(self, target: str, candidates: List[str]) -> Optional[Tuple[str, float]]:
        """
        Level 2: Ask OpenAI for the best semantic match.
        Only used if fuzzy matching fails or confidence is low.
        """
        if not self.use_llm:
            return None
            
        try:
            # Simple prompt
            prompt = f"""
            Find the best match for the construction term '{target}' from this list:
            {json.dumps(candidates[:50])}
            
            Return ONLY the exact string from the list that matches, or "NONE".
            Consider semantic meaning (e.g. 'Tabique' matches 'Muro').
            """
            
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            data = {
                "model": "gpt-4o-mini", # Cost effective
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0
            }
            
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=data,
                timeout=5
            )
            
            if response.status_code == 200:
                content = response.json()['choices'][0]['message']['content'].strip().replace('"', '')
                if content != "NONE" and content in candidates:
                    return (content, 0.99)
                    
        except Exception as e:
            logger.warning(f"LLM Match failed: {e}")
            
        return None
