# Python Geometry Extraction Service

A robust microservice for extracting geometry and quantities from DXF/PDF architectural drawings.

## Features
- Vision AI label detection (Claude/GPT-4V)
- Geometry reconstruction from fragmented CAD drawings
- Planar graph cycle extraction with scoring
- Multi-layer QA system

## Installation

```bash
cd geometry-service
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

pip install -r requirements.txt
```

## Running

```bash
uvicorn main:app --reload --port 8000
```

## API Endpoints

- `POST /api/extract` - Main processing endpoint
- `POST /api/parse-dxf` - Parse DXF file
- `POST /api/parse-pdf` - Parse PDF file
- `POST /api/detect-labels` - Vision AI label detection
- `GET /health` - Health check
