/**
 * API Route: /api/geometry/extract
 * 
 * Proxies requests to the Python geometry service for quantity extraction
 */
import { NextRequest, NextResponse } from 'next/server';

const GEOMETRY_SERVICE_URL = process.env.GEOMETRY_SERVICE_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
    try {
        // Forward the request to the Python geometry service
        const formData = await request.formData();

        const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/extract`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: `Geometry service error: ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error calling geometry service:', error);

        // Check if service is unavailable
        if (error instanceof Error && error.message.includes('fetch')) {
            return NextResponse.json(
                {
                    error: 'Geometry service unavailable. Please ensure the Python service is running.',
                    hint: 'Run: cd geometry-service && .\\venv\\Scripts\\uvicorn main:app --reload --port 8000'
                },
                { status: 503 }
            );
        }

        return NextResponse.json(
            { error: 'Failed to process geometry extraction' },
            { status: 500 }
        );
    }
}

export async function GET() {
    // Health check - verify Python service is available
    try {
        const response = await fetch(`${GEOMETRY_SERVICE_URL}/health`, {
            signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
            const data = await response.json();
            return NextResponse.json({
                status: 'ok',
                geometry_service: data,
                message: 'Geometry service is connected'
            });
        } else {
            return NextResponse.json(
                { status: 'error', message: 'Geometry service returned error' },
                { status: 502 }
            );
        }
    } catch {
        return NextResponse.json(
            {
                status: 'unavailable',
                message: 'Cannot connect to geometry service',
                hint: 'Start the Python service: cd geometry-service && .\\venv\\Scripts\\uvicorn main:app --reload --port 8000'
            },
            { status: 503 }
        );
    }
}
