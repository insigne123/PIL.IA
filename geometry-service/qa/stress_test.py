
import requests
import concurrent.futures
import time
import os

BASE_URL = "http://localhost:8000"

def test_health():
    try:
        resp = requests.get(f"{BASE_URL}/health")
        print(f"[Health] Status: {resp.status_code}, Body: {resp.json()}")
        return resp.status_code == 200
    except Exception as e:
        print(f"[Health] FAILED: {e}")
        return False

def test_invalid_dxf():
    # Create fake DXF
    with open("fake.dxf", "w") as f:
        f.write("This is not a DXF file")
    
    try:
        with open("fake.dxf", 'rb') as f_upload:
            files = {'file': f_upload}
            start = time.time()
            resp = requests.post(f"{BASE_URL}/api/parse-dxf", files=files)
            duration = time.time() - start
        
        print(f"[Invalid DXF] Status: {resp.status_code}, Duration: {duration:.2f}s")
        if resp.status_code == 200:
             data = resp.json()
             print(f"  Response: {len(data.get('segments', []))} segments")
             return len(data.get('segments', [])) == 0
        return False
    except Exception as e:
        print(f"[Invalid DXF] FAILED: {e}")
        return False
    finally:
        try:
            if os.path.exists("fake.dxf"):
                os.remove("fake.dxf")
        except:
            pass

def run_concurrent_requests(count=5):
    print(f"[Concurrency] Starting {count} parallel requests...")
    # Create a minimal valid DXF for testing if possible, or use fake one
    # For stress test, using fake one is fine to test error handling under load
    with open("stress.dxf", "w") as f:
        f.write("FAKE DATA " * 1000)
    
    def send_request(i):
        try:
            files = {'file': open("stress.dxf", 'rb')}
            resp = requests.post(f"{BASE_URL}/api/parse-dxf", files=files)
            return resp.status_code
        except Exception as e:
            return str(e)

    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as executor:
        futures = [executor.submit(send_request, i) for i in range(count)]
        results = [f.result() for f in futures]
    
    print(f"[Concurrency] Results: {results}")
    if os.path.exists("stress.dxf"):
        os.remove("stress.dxf")
    return all(r == 200 for r in results)

if __name__ == "__main__":
    print("--- STARTING STRESS TEST ---")
    if not test_health():
        print("CRITICAL: Health check failed. Is service running?")
        exit(1)
        
    print("\n--- TEST References ---")
    test_invalid_dxf()
    
    print("\n--- TEST Concurrency ---")
    run_concurrent_requests(5)
    
    print("\n--- DONE ---")
