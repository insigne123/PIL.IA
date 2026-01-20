import json
import sys
import os
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def analyze(json_path):
    try:
        with open(json_path, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading file: {e}")
        # Try utf-16le as fallback
        with open(json_path, 'r', encoding='utf-16-le') as f:
            data = json.load(f)

    print("# Reporte de Discrepancias\n")
    print("| Row | Item | Unidad | Qty Calculada | Razón Match | Estado | Problema Detectado |")
    print("|-----|------|--------|---------------|-------------|--------|--------------------|")

    matches = data.get('matches', [])
    for m in matches:
        row = m.get('row_index')
        item = m.get('excel_item')
        unit = m.get('excel_unit')
        qty = m.get('qty_final')
        reason = m.get('match_reason', '')
        status = m.get('status')
        
        problem = ""
        
        # Heuristics for problems
        if status == 'pending_no_match':
            problem = "⚠️ No Match Found"
        elif qty == 0 and unit in ['m2', 'm', 'un']:
             problem = "❌ Zero Quantity"
        elif 'Mismatch' in reason:
             problem = "⚠️ Type Mismatch"
        elif 'Generic Block' in reason:
             problem = "⚠️ Generic Block"
        elif 'Cantidades fraccionarias' in reason:
             problem = "⚠️ Fractional Count"
             
        # Format Qty
        qty_str = f"{qty:.2f}" if isinstance(qty, (int, float)) else "null"
        
        # Shorten reason
        reason_short = reason[:50] + "..." if len(reason) > 50 else reason
        
        if problem or qty_str == "null" or qty == 0:
             print(f"| {row} | {item[:40]}... | {unit} | {qty_str} | {reason_short} | {status} | {problem} |")

if __name__ == "__main__":
    analyze(sys.argv[1])
