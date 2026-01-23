import { NextRequest, NextResponse } from 'next/server';
import { parseDxf, aggregateDxfItems } from '@/lib/processing/dxf';
import { parseExcel } from '@/lib/processing/excel';
import { matchItems } from '@/lib/processing/matcher';
import { checkGeometryServiceHealth, extractQuantities } from '@/lib/processing/geometry-service';
import { ItemDetectado, Unit } from '@/types';
// CSV Takeoff imports
import { parseTakeoffCSV, getTakeoffSummary } from '@/lib/processing/csv-takeoff';
import { matchExcelToCSV, getMatchingStats } from '@/lib/processing/csv-matcher';
import { buildDXFContext, getDXFContextSummary, DXFContext } from '@/lib/processing/dxf-text-extractor';

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
        // Detect CSV takeoff file
        const csvFile = files.find(f => f.name.endsWith('.csv'));

        if (!excelFile) {
            return NextResponse.json({ error: "Missing Excel file" }, { status: 400 });
        }

        // 1. Parse Excel
        const excelBuffer = await excelFile.arrayBuffer();
        const { items: excelItems, structure } = await parseExcel(excelBuffer, targetSheet);

        // === OPTION C: CSV Takeoff Flow (Priority if CSV exists) ===
        if (csvFile) {
            console.log('[Process] 📊 CSV Takeoff file detected, using pre-calculated quantities');

            try {
                const csvContent = await csvFile.text();
                const takeoffResult = parseTakeoffCSV(csvContent);

                // Log summary
                console.log(getTakeoffSummary(takeoffResult));

                // === HYBRID: If DXF is also provided, extract texts for enhanced matching ===
                let dxfContext: DXFContext | undefined;
                const validationWarnings: string[] = [];

                if (dxfFiles.length > 0) {
                    console.log('[Process] 🔍 DXF file detected, extracting texts for enhanced matching');
                    const dxfContent = await dxfFiles[0].text();
                    dxfContext = buildDXFContext(dxfContent);
                    console.log(getDXFContextSummary(dxfContext));

                    // === P0.3: Cross-validate CSV vs DXF layers ===
                    const csvLayers = new Set(Object.keys(takeoffResult.index));
                    const dxfLayers = new Set(dxfContext.layerHasGeometry.keys());

                    // Layers in CSV but not in DXF (suspicious)
                    const missingInDXF = [...csvLayers].filter(l => !dxfLayers.has(l));
                    if (missingInDXF.length > 0 && missingInDXF.length < 10) {
                        validationWarnings.push(`CSV has ${missingInDXF.length} layers not found in DXF: ${missingInDXF.slice(0, 3).join(', ')}${missingInDXF.length > 3 ? '...' : ''}`);
                    } else if (missingInDXF.length >= 10) {
                        validationWarnings.push(`⚠️ CSV has ${missingInDXF.length} layers not in DXF - files may not match`);
                    }

                    // Layers in DXF but not in CSV (might be missing data)
                    const missingInCSV = [...dxfLayers].filter(l => !csvLayers.has(l));
                    if (missingInCSV.length > 5) {
                        validationWarnings.push(`DXF has ${missingInCSV.length} layers not in CSV - consider re-exporting CSV`);
                    }

                    if (validationWarnings.length > 0) {
                        console.log(`[Process] ⚠️ CSV/DXF Validation: ${validationWarnings.join('; ')}`);
                    } else {
                        console.log('[Process] ✅ CSV/DXF layers match');
                    }
                }

                // Match Excel to CSV layers (with optional DXF context for better semantic matching)
                const stagingRows = matchExcelToCSV(
                    excelItems,
                    takeoffResult.index,
                    structure.sheetName,
                    dxfContext  // Pass DXF context if available
                );

                const matchStats = getMatchingStats(stagingRows);
                console.log(`[Process] CSV Matching complete: ${matchStats.matched}/${matchStats.total} items matched (${matchStats.highConfidence} high confidence)`);

                return NextResponse.json({
                    success: true,
                    data: {
                        stagingRows,
                        structure,
                        preflightResults: [{
                            fileName: csvFile.name,
                            summary: {
                                modelSpaceEntityCount: takeoffResult.metadata.totalEntities,
                                detectedUnit: takeoffResult.detectedUnit,
                                warnings: takeoffResult.warnings,
                                recommendations: [],
                            },
                            warnings: takeoffResult.warnings,
                            recommendations: [],
                            csvTakeoff: {
                                totalLayers: takeoffResult.totalLayers,
                                layersWithArea: takeoffResult.layersWithArea,
                                layersWithLength: takeoffResult.layersWithLength,
                                entityBreakdown: takeoffResult.metadata.entityTypeBreakdown,
                            }
                        }],
                        stats: {
                            excelRows: excelItems.length,
                            dxfItems: takeoffResult.totalLayers,
                            matched: matchStats.matched,
                            highConfidence: matchStats.highConfidence,
                            pending: matchStats.pending,
                        },
                        csvTakeoffUsed: true,
                        geometryServiceUsed: false,
                        unitMetadata: {
                            detectedUnit: takeoffResult.detectedUnit,
                            confidence: 0.9,
                            factor: 1,
                        }
                    }
                });

            } catch (csvError: any) {
                console.warn('[Process] CSV parsing failed, falling back to DXF:', csvError.message);
                // Fall through to other options
            }
        }

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
                        csvTakeoffUsed: false,
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
                csvTakeoffUsed: false,
                geometryServiceUsed: false
            }
        });

    } catch (e: any) {
        console.error("Processing Error", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}

