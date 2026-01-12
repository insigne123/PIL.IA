// Workflow wizard system for guided batch creation

import type { ReactNode } from 'react';

export interface WorkflowStep {
    id: string;
    title: string;
    description: string;
    icon?: ReactNode;
    validation: (data: any) => ValidationResult;
    canSkip: boolean;
    estimatedTime?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
}

export interface WorkflowData {
    // Step 1: Upload
    excelFile?: File;
    cadFiles?: File[];

    // Step 2: Configure
    unit?: 'mm' | 'cm' | 'm';
    heightDefault?: number;
    sheetTarget?: string;

    // Step 3: Review
    approvedCount?: number;
    pendingCount?: number;

    // Step 4: Pricing
    pricingEnabled?: boolean;
    priceSource?: 'auto' | 'manual' | 'skip';
}

export interface WorkflowContext {
    currentStep: number;
    data: WorkflowData;
    completedSteps: Set<string>;
    errors: Map<string, string[]>;
}

/**
 * Batch creation workflow steps
 */
export const batchCreationWorkflow: WorkflowStep[] = [
    {
        id: 'upload',
        title: 'Subir Archivos',
        description: 'Sube tu Excel de presupuesto y archivos CAD (DXF/DWG)',
        estimatedTime: '1-2 min',
        canSkip: false,
        validation: (data: WorkflowData) => {
            const errors: string[] = [];

            if (!data.excelFile) {
                errors.push('Debes subir un archivo Excel');
            }

            if (!data.cadFiles || data.cadFiles.length === 0) {
                errors.push('Debes subir al menos un archivo CAD');
            }

            // Validate file types
            if (data.excelFile && !data.excelFile.name.match(/\.(xlsx|xlsm)$/i)) {
                errors.push('El archivo Excel debe ser .xlsx o .xlsm');
            }

            if (data.cadFiles) {
                const invalidCad = data.cadFiles.filter(
                    (f) => !f.name.match(/\.(dxf|dwg)$/i)
                );
                if (invalidCad.length > 0) {
                    errors.push('Los archivos CAD deben ser .dxf o .dwg');
                }
            }

            return {
                valid: errors.length === 0,
                errors,
            };
        },
    },

    {
        id: 'configure',
        title: 'Configurar Unidades',
        description: 'Selecciona la unidad de medida de tus planos y altura por defecto',
        estimatedTime: '30 seg',
        canSkip: false,
        validation: (data: WorkflowData) => {
            const errors: string[] = [];
            const warnings: string[] = [];

            if (!data.unit) {
                errors.push('Debes seleccionar una unidad de medida');
            }

            if (!data.heightDefault) {
                warnings.push('Se usará altura por defecto de 2.4m');
            } else if (data.heightDefault < 1 || data.heightDefault > 10) {
                errors.push('La altura debe estar entre 1 y 10 metros');
            }

            if (!data.sheetTarget) {
                warnings.push('Se buscará automáticamente la hoja de presupuesto');
            }

            return {
                valid: errors.length === 0,
                errors,
                warnings,
            };
        },
    },

    {
        id: 'review',
        title: 'Revisar Matching',
        description: 'Verifica y corrige los matches automáticos entre Excel y CAD',
        estimatedTime: '5-15 min',
        canSkip: false,
        validation: (data: WorkflowData) => {
            const errors: string[] = [];
            const warnings: string[] = [];

            if (!data.approvedCount || data.approvedCount === 0) {
                errors.push('Debes aprobar al menos un ítem para continuar');
            }

            if (data.pendingCount && data.pendingCount > 0) {
                warnings.push(`Tienes ${data.pendingCount} ítems pendientes de revisión`);
            }

            return {
                valid: errors.length === 0,
                errors,
                warnings,
            };
        },
    },

    {
        id: 'pricing',
        title: 'Validar Precios',
        description: 'Revisa y ajusta los precios sugeridos automáticamente',
        estimatedTime: '3-10 min',
        canSkip: true,
        validation: (data: WorkflowData) => {
            const warnings: string[] = [];

            if (!data.pricingEnabled) {
                warnings.push('Saltaste la búsqueda automática de precios');
            }

            if (data.priceSource === 'manual') {
                warnings.push('Deberás ingresar los precios manualmente');
            }

            return {
                valid: true,
                warnings,
            };
        },
    },

    {
        id: 'export',
        title: 'Exportar Resultados',
        description: 'Descarga tu presupuesto completado',
        estimatedTime: '1 min',
        canSkip: false,
        validation: (data: WorkflowData) => {
            return { valid: true };
        },
    },
];

/**
 * Get workflow progress percentage
 */
export function getWorkflowProgress(context: WorkflowContext): number {
    const totalSteps = batchCreationWorkflow.length;
    const completedCount = context.completedSteps.size;
    return Math.round((completedCount / totalSteps) * 100);
}

/**
 * Check if can proceed to next step
 */
export function canProceedToNext(
    context: WorkflowContext,
    workflow: WorkflowStep[]
): boolean {
    const currentStep = workflow[context.currentStep];
    if (!currentStep) return false;

    const validation = currentStep.validation(context.data);
    return validation.valid || currentStep.canSkip;
}

/**
 * Get next incomplete step
 */
export function getNextIncompleteStep(
    context: WorkflowContext,
    workflow: WorkflowStep[]
): number {
    for (let i = 0; i < workflow.length; i++) {
        if (!context.completedSteps.has(workflow[i].id)) {
            return i;
        }
    }
    return workflow.length - 1;
}

/**
 * Workflow tips and help
 */
export const workflowTips: Record<string, string[]> = {
    upload: [
        'Asegúrate de que el Excel tenga columnas: Descripción, Unidad, Cantidad',
        'Los archivos DXF deben contener bloques o líneas medibles',
        'Puedes subir múltiples archivos DXF si el proyecto está dividido',
    ],
    configure: [
        'La unidad debe coincidir con la configuración de tus planos CAD',
        'La altura por defecto se usa para convertir metros lineales a m²',
        'Si no estás seguro, usa "m" (metros) como unidad',
    ],
    review: [
        'Los matches de alta confianza (verde) generalmente son correctos',
        'Revisa cuidadosamente los matches de baja confianza (rojo)',
        'Puedes usar filtros para enfocarte en ítems específicos',
        'Usa operaciones en masa para aprobar múltiples ítems similares',
    ],
    pricing: [
        'Los precios se buscan automáticamente en proveedores conocidos',
        'Puedes ajustar manualmente cualquier precio sugerido',
        'Los precios se guardan en caché para futuras búsquedas',
    ],
    export: [
        'El Excel exportado mantendrá el formato original',
        'Las cantidades y precios se escribirán en las columnas correspondientes',
        'Puedes generar un PDF con el resumen del presupuesto',
    ],
};

/**
 * Common errors and solutions
 */
export const commonErrors: Record<string, { problem: string; solution: string }> = {
    'excel-no-columns': {
        problem: 'No se encontraron las columnas requeridas en el Excel',
        solution: 'Verifica que tu Excel tenga columnas llamadas "Descripción", "Unidad" y "Cantidad"',
    },
    'cad-empty': {
        problem: 'El archivo CAD no contiene entidades',
        solution: 'Asegúrate de que el DXF tenga bloques, líneas o polilíneas en el espacio modelo',
    },
    'no-matches': {
        problem: 'No se encontraron coincidencias entre Excel y CAD',
        solution: 'Verifica que los nombres en Excel coincidan con los nombres de bloques o capas en el CAD',
    },
    'low-confidence': {
        problem: 'Muchos matches tienen baja confianza',
        solution: 'Esto es normal. Revisa manualmente y el sistema aprenderá de tus correcciones',
    },
};
