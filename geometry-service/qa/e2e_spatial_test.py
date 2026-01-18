
"""
E2E Spatial Intelligence Test
Sends the real DXF file to the local API and checks if 'Pavimento Sala de Ventas'
returns a logic-based Area (~721m2) instead of a length-derived one.
"""
import requests
import json
import os
import sys

API_URL = "http://127.0.0.1:8000/api/extract"
DXF_PATH = r"c:\Users\nicog\Downloads\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\PIL.IA\geometry-service\qa\minimal.dxf"

def run_e2e_test():
    if not os.path.exists(DXF_PATH):
        print(f"❌ DXF file not found: {DXF_PATH}")
        sys.exit(1)

    print(f"🚀 Sending {DXF_PATH} to {API_URL}...")

    # 1. Define Excel Payload asking for specific Area items
    excel_payload = [
        {
            "id": "item_1",
            "description": "Pavimento Sala de Ventas",
            "unit": "m2",
            "expected_qty": 721.0  # We expect approx this
        },
        {
            "id": "item_2", 
            "description": "Cielo Sala de Ventas",
            "unit": "m2"
        },
        {
            "id": "item_3",
            "description": "Tabique Interior", # Control: Should still match Lines/Length
            "unit": "m2" 
        }
    ]

    # 2. Prepare Multipart Request
    files = {
        'dxf_file': ('test.dxf', open(DXF_PATH, 'rb'), 'application/dxf'),
    }
    data = {
        'excel_data': json.dumps(excel_payload),
        'use_vision_ai': 'false', # Speed up test
        'snap_tolerance': '0.01'
    }

    try:
        response = requests.post(API_URL, files=files, data=data, timeout=120)
        
        if response.status_code != 200:
            print(f"❌ API Error: {response.text}")
            sys.exit(1)
            
        result = response.json()
        
        # 3. Analyze Results
        print("\n--- Test Results ---")
        matches = result.get('matches', [])
        
        sala_match = next((m for m in matches if m['excel_item_id'] == 'item_1'), None)
        cielo_match = next((m for m in matches if m['excel_item_id'] == 'item_2'), None)
        
        # Check Sala de Ventas (Floor)
        if sala_match:
            qty = sala_match['qty_calculated']
            reason = sala_match['match_reason']
            print(f"Item: Pavimento Sala de Ventas")
            print(f"   Qty: {qty} {sala_match['unit']}")
            print(f"   Reason: {reason}")
            
            # Success Criteria: Qty > 100 (logic) and NOT "derived from length"
            if qty > 500 and "inside_zone" in reason:
                 print("   ✅ VERDICT: PASS (Spatial Match Found)")
            elif qty > 0:
                 print("   ⚠️ VERDICT: PARTIAL (Qty found but might be fallback)")
            else:
                 print("   ❌ VERDICT: FAIL (Zero quantity)")
        else:
            print("❌ Item 1 not found in response")

        print("-" * 30)

    except Exception as e:
        print(f"❌ Connection Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_e2e_test()
