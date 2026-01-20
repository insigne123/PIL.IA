
import json
import sys
import os
import io

# Force UTF-8 output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def audit(json_path):
    print(f"--- System Health Audit: {os.path.basename(json_path)} ---")
    try:
        with open(json_path, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
    except:
        with open(json_path, 'r', encoding='utf-16-le') as f:
            data = json.load(f)

    matches = data.get('matches', [])
    total_items = len(matches)
    
    if total_items == 0:
        print("No matches found in file.")
        return

    # 1. Metric: Semantic Coverage (Did we find a candidate?)
    items_with_candidates = [m for m in matches if m.get('source_items_count', 0) > 0 or m.get('matched_layer')]
    semantic_coverage = len(items_with_candidates) / total_items * 100

    # 2. Metric: Geometry Success (Did we extract a quantity?)
    items_measured = [m for m in matches if (m.get('qty_final') or 0) > 0]
    geometry_success = len(items_measured) / total_items * 100
    
    # 3. Metric: Confidence Reliability
    # High confidence items that ended up with 0 qty (False Positives in matching?)
    high_conf_failures = [m for m in matches if m.get('confidence') == 'high' and (m.get('qty_final') or 0) == 0]
    
    # 4. Failure Categorization
    failure_reasons = {}
    for m in matches:
        if (m.get('qty_final') or 0) == 0:
            reason = m.get('match_reason', 'Unknown')
            if 'Mismatch' in reason: cat = 'Type Mismatch'
            elif 'Generic Block' in reason: cat = 'Generic Block'
            elif 'insufficient_geometry' in reason: cat = 'Insufficient Geometry'
            elif 'No candidate' in reason or not m.get('matched_layer'): cat = 'No Match Found'
            else: cat = 'Other Logic Failure'
            
            failure_reasons[cat] = failure_reasons.get(cat, 0) + 1

    print(f"\n📊 GLOBAL METRICS")
    print(f"Total Items: {total_items}")
    print(f"Semantic Match Rate: {semantic_coverage:.1f}% (Items where we found a potential layer)")
    print(f"Extraction Success Rate: {geometry_success:.1f}% (Items with Qty > 0)")
    print(f"Critical Gap: {semantic_coverage - geometry_success:.1f}% (Found layer but failed to measure)")
    
    print(f"\n⚠️ RELIABILITY ALERTS")
    print(f"High Confidence Failures: {len(high_conf_failures)} items (AI was sure, but Math failed)")
    
    # print(f"\n📉 FAILURE ROOT CAUSES (Items with Qty=0)")
    # for cat, count in sorted(failure_reasons.items(), key=lambda x: x[1], reverse=True):
    #     print(f"  - {cat}: {count} items")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python audit_system_health.py <json_path>")
    else:
        audit(sys.argv[1])
