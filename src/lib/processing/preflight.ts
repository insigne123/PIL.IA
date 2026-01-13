import { Unit } from '@/types';

export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    diagonal: number;
}

export interface PreflightResult {
    hasXrefs: boolean;
    xrefCount: number;
    xrefNames: string[];
    modelSpaceEntityCount: number;
    paperSpaceEntityCount: number;
    detectedUnit: Unit | null;
    boundingBox: BoundingBox;
    warnings: string[];
    recommendations: string[];
    dynamicMinLength: number; // Calculated threshold based on scale
}

/**
 * Run preflight checks on DXF content before processing
 * Detects XREFs, calculates bounding box, and provides recommendations
 */
export function runPreflight(dxfContent: string): PreflightResult {
    const result: PreflightResult = {
        hasXrefs: false,
        xrefCount: 0,
        xrefNames: [],
        modelSpaceEntityCount: 0,
        paperSpaceEntityCount: 0,
        detectedUnit: null,
        boundingBox: {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity,
            width: 0,
            height: 0,
            diagonal: 0,
        },
        warnings: [],
        recommendations: [],
        dynamicMinLength: 0.5, // Default fallback
    };

    try {
        // Parse DXF content line by line for preflight analysis
        const lines = dxfContent.split('\n');
        let currentSection = '';
        let currentBlockName = '';
        let isInBlockRecord = false;
        let blockFlags = 0;

        const points: Array<{ x: number; y: number }> = [];
        let inModelSpace = true; // Assume ModelSpace by default

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';

            // Detect sections
            if (line === '0' && nextLine === 'SECTION') {
                i++;
                continue;
            }
            if (line === '2') {
                currentSection = nextLine;
                i++;
                continue;
            }

            // HEADER section - detect unit
            if (currentSection === 'HEADER' && line === '9' && nextLine === '$INSUNITS') {
                // Next group code 70 will have the unit value
                for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                    if (lines[j].trim() === '70') {
                        const unitValue = parseInt(lines[j + 1].trim(), 10);
                        if (unitValue === 4) result.detectedUnit = 'mm';
                        else if (unitValue === 5) result.detectedUnit = 'cm';
                        else if (unitValue === 6) result.detectedUnit = 'm';
                        break;
                    }
                }
                i++;
                continue;
            }

            // BLOCKS section - detect XREFs
            if (currentSection === 'BLOCKS') {
                if (line === '0' && nextLine === 'BLOCK_RECORD') {
                    isInBlockRecord = true;
                    currentBlockName = '';
                    blockFlags = 0;
                    i++;
                    continue;
                }

                if (isInBlockRecord) {
                    if (line === '2') {
                        currentBlockName = nextLine;
                        i++;
                        continue;
                    }
                    if (line === '70') {
                        blockFlags = parseInt(nextLine, 10);
                        i++;

                        // Check if this is an XREF (flag bit 4 = 16)
                        // or XREF overlay (flag bit 5 = 32)
                        if ((blockFlags & 16) || (blockFlags & 32)) {
                            result.hasXrefs = true;
                            result.xrefCount++;
                            if (currentBlockName && !currentBlockName.startsWith('*')) {
                                result.xrefNames.push(currentBlockName);
                            }
                        }
                        continue;
                    }
                    if (line === '0') {
                        isInBlockRecord = false;
                    }
                }
            }

            // ENTITIES section - count entities and collect points for bbox
            if (currentSection === 'ENTITIES') {
                if (line === '0') {
                    const entityType = nextLine;

                    // Detect space (67 = 0 or absent = ModelSpace, 67 = 1 = PaperSpace)
                    let isPaperSpace = false;
                    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
                        if (lines[j].trim() === '67' && lines[j + 1].trim() === '1') {
                            isPaperSpace = true;
                            break;
                        }
                        if (lines[j].trim() === '0') break; // Next entity
                    }

                    if (isPaperSpace) {
                        result.paperSpaceEntityCount++;
                    } else {
                        result.modelSpaceEntityCount++;
                    }

                    // Collect coordinate points for bounding box (only ModelSpace)
                    if (!isPaperSpace && ['LINE', 'LWPOLYLINE', 'POLYLINE', 'INSERT', 'CIRCLE', 'ARC'].includes(entityType)) {
                        for (let j = i + 1; j < Math.min(i + 100, lines.length); j++) {
                            const code = lines[j].trim();
                            if (code === '0') break; // Next entity

                            if (code === '10' || code === '11' || code === '12') { // X coordinates
                                const x = parseFloat(lines[j + 1].trim());
                                if (!isNaN(x)) {
                                    // Look for corresponding Y
                                    const yCode = parseInt(code) + 10; // 10->20, 11->21, 12->22
                                    for (let k = j; k < Math.min(j + 5, lines.length); k++) {
                                        if (lines[k].trim() === yCode.toString()) {
                                            const y = parseFloat(lines[k + 1].trim());
                                            if (!isNaN(y)) {
                                                points.push({ x, y });
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    i++;
                    continue;
                }
            }
        }

        // Calculate bounding box from collected points
        if (points.length > 0) {
            result.boundingBox.minX = Math.min(...points.map(p => p.x));
            result.boundingBox.minY = Math.min(...points.map(p => p.y));
            result.boundingBox.maxX = Math.max(...points.map(p => p.x));
            result.boundingBox.maxY = Math.max(...points.map(p => p.y));
            result.boundingBox.width = result.boundingBox.maxX - result.boundingBox.minX;
            result.boundingBox.height = result.boundingBox.maxY - result.boundingBox.minY;
            result.boundingBox.diagonal = Math.sqrt(
                result.boundingBox.width ** 2 + result.boundingBox.height ** 2
            );

            // Calculate dynamic minimum length (0.2% of diagonal, min 0.5m)
            result.dynamicMinLength = Math.max(0.5, result.boundingBox.diagonal * 0.002);
        }

        // Generate warnings and recommendations
        if (result.hasXrefs) {
            result.warnings.push(
                `Se detectaron ${result.xrefCount} referencias externas (XREFs) en el archivo DXF.`
            );
            if (result.xrefNames.length > 0) {
                result.warnings.push(
                    `XREFs encontrados: ${result.xrefNames.join(', ')}`
                );
            }
        }

        if (result.hasXrefs && result.modelSpaceEntityCount < 10) {
            result.warnings.push(
                'El archivo contiene muy pocas entidades en ModelSpace. Es probable que la geometría real esté en las XREFs no vinculadas.'
            );
            result.recommendations.push(
                'Abra el archivo en AutoCAD y ejecute: XREF → BIND (o INSERT) para vincular todas las referencias externas antes de exportar a DXF.'
            );
        }

        if (result.paperSpaceEntityCount > result.modelSpaceEntityCount) {
            result.warnings.push(
                `PaperSpace tiene más entidades (${result.paperSpaceEntityCount}) que ModelSpace (${result.modelSpaceEntityCount}). Esto puede indicar que está procesando layouts en vez del modelo.`
            );
            result.recommendations.push(
                'Asegúrese de exportar desde la pestaña "Model" en AutoCAD, no desde layouts de impresión.'
            );
        }

        if (result.modelSpaceEntityCount === 0) {
            result.warnings.push('No se encontraron entidades en ModelSpace.');
            result.recommendations.push(
                'Verifique que el archivo DXF contenga geometría válida y que las XREFs estén vinculadas.'
            );
        }

        if (!result.detectedUnit) {
            result.warnings.push('No se pudo detectar la unidad del dibujo ($INSUNITS).');
            result.recommendations.push(
                'Especifique manualmente la unidad del plano o configure $INSUNITS en AutoCAD antes de exportar.'
            );
        }

    } catch (error) {
        result.warnings.push(`Error durante preflight: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
}

/**
 * Check if preflight result indicates critical issues that should block processing
 */
export function hasBlockingIssues(preflight: PreflightResult): boolean {
    return (
        (preflight.hasXrefs && preflight.modelSpaceEntityCount < 10) ||
        preflight.modelSpaceEntityCount === 0
    );
}

/**
 * Get a human-readable summary of preflight results
 */
export function getPreflightSummary(preflight: PreflightResult): string {
    const parts: string[] = [];

    parts.push(`ModelSpace: ${preflight.modelSpaceEntityCount} entidades`);
    parts.push(`PaperSpace: ${preflight.paperSpaceEntityCount} entidades`);

    if (preflight.hasXrefs) {
        parts.push(`⚠️ ${preflight.xrefCount} XREFs detectados`);
    }

    if (preflight.detectedUnit) {
        parts.push(`Unidad: ${preflight.detectedUnit}`);
    }

    if (preflight.boundingBox.diagonal > 0) {
        parts.push(`Escala: ${preflight.boundingBox.diagonal.toFixed(2)}m diagonal`);
        parts.push(`Umbral dinámico: ${preflight.dynamicMinLength.toFixed(3)}m`);
    }

    return parts.join(' | ');
}
