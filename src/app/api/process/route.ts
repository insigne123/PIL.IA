import { NextRequest, NextResponse } from 'next/server';
import { parseDxf, aggregateDxfItems } from '@/lib/processing/dxf';
import { parseExcel } from '@/lib/processing/excel';
import { matchItems } from '@/lib/processing/matcher';
import { checkGeometryServiceHealth, extractQuantities } from '@/lib/processing/geometry-service';
import { ItemDetectado, Unit } from '@/types';

export const runtime = 'nodejs'; // Required for buffer/stream ops usually

// Check if geometry service should be used (env or parameter)
const USE_GEOMETRY_SERVICE = process.env.USE_GEOMETRY_SERVICE !== 'false';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const files: File[] = [];
        const planUnit = (formData.get('unit') as Unit) || 'm';
        const targetSheet = (formData.get('sheetName') as string) || undefined;
        const useGeometryService = formData.get('useGeometryService') !== 'false' && USE_GEOMETRY_SERVICE;

        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                files.push(value);
            }
        }

        const excelFile = files.find(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xlsm'));
        const dxfFiles = files.filter(f => f.name.endsWith('.dxf'));
        const pdfFiles = files.filter(f => f.name.endsWith('.pdf'));

        if (!excelFile) {
            return NextResponse.json({ error: "Missing Excel file" }, { status: 400 });
        }

        // 1. Parse Excel
        const excelBuffer = await excelFile.arrayBuffer();
        const { items: excelItems, structure } = await parseExcel(excelBuffer, targetSheet);

        // Check if geometry service is available
        let useAdvancedGeometry = false;
        if (useGeometryService && (dxfFiles.length > 0 || pdfFiles.length > 0)) {
            useAdvancedGeometry = await checkGeometryServiceHealth();
            console.log(`[Process] Geometry service available: ${useAdvancedGeometry}`);
        }

        // === OPTION A: Use Python Geometry Service (if available) ===
        if (useAdvancedGeometry) {
            console.log('[Process] Using Python Geometry Service for extraction');

            try {
                const excelItemsForService = excelItems.map(item => ({
                    id: String(item.row),
                    description: item.description,
                    unit: item.unit || 'm2',
                    expected_qty: typeof item.qty === 'number' ? item.qty : undefined
                }));

                const result = await extractQuantities({
                    dxfFile: dxfFiles[0],
                    pdfFiles: pdfFiles.length > 0 ? pdfFiles : undefined,
                    excelItems: excelItemsForService,
                    useVisionAI: true,
                    snapTolerance: 0.01
                });

                // Convert geometry service result to staging rows
                const stagingRows = excelItems.map(excelItem => {
                    const match = result.matches.find(m => m.excel_item_id === String(excelItem.row));

                    return {
                        ...excelItem,
                        qty_calculated: match?.qty_calculated ?? null,
                        qty_final: match?.qty_calculated ?? excelItem.qty ?? null,
                        confidence: match?.confidence ?? 0,
                        matched_items: match ? [{
                            layer: match.label_text || 'geometry-service',
                            qty: match.qty_calculated,
                            source: 'geometry-service' as const
                        }] : [],
                        calculation_method: match ? 'geometry-service' : 'unmatched',
                        warnings: match?.warnings || []
                    };
                });

                return NextResponse.json({
                    success: true,
                    data: {
                        stagingRows,
                        structure,
                        preflightResults: [],
                        stats: {
                            excelRows: excelItems.length,
                            dxfItems: result.matches.length,
                            matched: result.matches.filter(m => m.confidence > 0.3).length,
                            processingTimeMs: result.processing_time_ms
                        },
                        geometryServiceUsed: true,
                        unitMetadata: {
                            detectedUnit: result.detected_unit,
                            confidence: result.unit_confidence,
                            factor: result.unit_factor
                        }
                    }
                });

            } catch (geometryError: any) {
                console.warn('[Process] Geometry service failed, falling back to TypeScript matcher:', geometryError.message);
                // Fall through to Option B
            }
        }

        // === OPTION B: Use existing TypeScript matcher (fallback) ===
        console.log('[Process] Using TypeScript matcher');

        // 2. Parse DXFs
        let allDxfItems: ItemDetectado[] = [];
        const preflightResults: any[] = [];

        for (const file of dxfFiles) {
            const text = await file.text();
            const { items, preflight, geometryHealth } = await parseDxf(text, planUnit);
            allDxfItems = [...allDxfItems, ...items];
            preflightResults.push({
                fileName: file.name,
                summary: preflight,
                warnings: preflight.warnings,
                recommendations: preflight.recommendations,
                geometryHealth
            });
        }

        // 3. Aggregate
        const aggregatedDxfItems = aggregateDxfItems(allDxfItems);

        // 4. Match
        const stagingRows = matchItems(excelItems, aggregatedDxfItems, structure.sheetName);

        return NextResponse.json({
            success: true,
            data: {
                stagingRows,
                structure,
                preflightResults,
                stats: {
                    excelRows: excelItems.length,
                    dxfItems: aggregatedDxfItems.length,
                    matched: stagingRows.filter(r => (r.matched_items?.length ?? 0) > 0).length
                },
                geometryServiceUsed: false
            }
        });

    } catch (e: any) {
        console.error("Processing Error", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
