// Structured error handling system with recovery strategies

export enum ErrorCode {
    // Parsing errors
    DXF_PARSE_FAILED = 'DXF_001',
    DXF_INVALID_FORMAT = 'DXF_002',
    DXF_EMPTY_FILE = 'DXF_003',
    EXCEL_PARSE_FAILED = 'EXCEL_001',
    EXCEL_INVALID_FORMAT = 'EXCEL_002',
    EXCEL_MISSING_COLUMNS = 'EXCEL_003',
    EXCEL_EMPTY_SHEET = 'EXCEL_004',

    // Processing errors
    MATCHING_TIMEOUT = 'MATCH_001',
    MATCHING_NO_RESULTS = 'MATCH_002',
    MATCHING_LOW_CONFIDENCE = 'MATCH_003',

    // Pricing errors
    PRICING_API_FAILED = 'PRICE_001',
    PRICING_NO_RESULTS = 'PRICE_002',
    PRICING_INVALID_RESPONSE = 'PRICE_003',
    PRICING_RATE_LIMIT = 'PRICE_004',

    // Validation errors
    VALIDATION_FAILED = 'VALID_001',
    VALIDATION_MISSING_REQUIRED = 'VALID_002',
    VALIDATION_INVALID_QUANTITY = 'VALID_003',
    VALIDATION_INVALID_PRICE = 'VALID_004',

    // Database errors
    DB_CONNECTION_FAILED = 'DB_001',
    DB_QUERY_FAILED = 'DB_002',
    DB_CONSTRAINT_VIOLATION = 'DB_003',

    // Authentication errors
    AUTH_UNAUTHORIZED = 'AUTH_001',
    AUTH_FORBIDDEN = 'AUTH_002',
    AUTH_TOKEN_EXPIRED = 'AUTH_003',

    // File storage errors
    STORAGE_UPLOAD_FAILED = 'STORAGE_001',
    STORAGE_DOWNLOAD_FAILED = 'STORAGE_002',
    STORAGE_FILE_NOT_FOUND = 'STORAGE_003',

    // AI/ML errors
    AI_API_FAILED = 'AI_001',
    AI_TIMEOUT = 'AI_002',
    AI_QUOTA_EXCEEDED = 'AI_003',

    // General errors
    UNKNOWN_ERROR = 'UNKNOWN_001',
    NETWORK_ERROR = 'NETWORK_001',
    TIMEOUT_ERROR = 'TIMEOUT_001',
}

export interface AppError {
    code: ErrorCode;
    message: string;
    context: Record<string, any>;
    recoverable: boolean;
    suggestedAction?: string;
    originalError?: Error;
    timestamp: string;
    userId?: string;
    batchId?: string;
}

export interface RecoveryResult {
    success: boolean;
    data?: any;
    error?: AppError;
    strategy: string;
}

export interface RecoveryStrategy {
    name: string;
    canRecover: (error: AppError) => boolean;
    recover: (error: AppError, context: any) => Promise<RecoveryResult>;
    maxRetries?: number;
}

/**
 * Create a structured application error with context and recovery information
 * @param code - Error code from ErrorCode enum
 * @param message - Human-readable error message in Spanish
 * @param context - Additional context data (filename, size, etc.)
 * @param originalError - Original Error object if available
 * @returns Structured AppError object with recovery info
 * @example
 * ```ts
 * const error = createAppError(
 *   ErrorCode.DXF_PARSE_FAILED,
 *   'Failed to parse DXF file',
 *   { filename: 'plan.dxf', size: 1024 }
 * );
 * ```
 */
export function createAppError(
    code: ErrorCode,
    message: string,
    context: Record<string, any> = {},
    originalError?: Error
): AppError {
    const errorConfig = getErrorConfig(code);

    return {
        code,
        message,
        context,
        recoverable: errorConfig.recoverable,
        suggestedAction: errorConfig.suggestedAction,
        originalError,
        timestamp: new Date().toISOString(),
    };
}

/**
 * Get error configuration
 */
function getErrorConfig(code: ErrorCode): {
    recoverable: boolean;
    suggestedAction?: string;
} {
    const configs: Record<ErrorCode, { recoverable: boolean; suggestedAction?: string }> = {
        // Parsing - not recoverable, need user action
        [ErrorCode.DXF_PARSE_FAILED]: {
            recoverable: false,
            suggestedAction: 'Verifica que el archivo DXF sea válido y no esté corrupto',
        },
        [ErrorCode.DXF_INVALID_FORMAT]: {
            recoverable: false,
            suggestedAction: 'El archivo debe ser DXF versión R12 o superior',
        },
        [ErrorCode.DXF_EMPTY_FILE]: {
            recoverable: false,
            suggestedAction: 'El archivo DXF no contiene entidades. Verifica el archivo.',
        },
        [ErrorCode.EXCEL_PARSE_FAILED]: {
            recoverable: false,
            suggestedAction: 'Verifica que el archivo Excel sea válido (.xlsx o .xlsm)',
        },
        [ErrorCode.EXCEL_INVALID_FORMAT]: {
            recoverable: false,
            suggestedAction: 'El formato del Excel no coincide con el esperado',
        },
        [ErrorCode.EXCEL_MISSING_COLUMNS]: {
            recoverable: false,
            suggestedAction: 'Faltan columnas requeridas: Descripción, Unidad, Cantidad',
        },
        [ErrorCode.EXCEL_EMPTY_SHEET]: {
            recoverable: false,
            suggestedAction: 'La hoja seleccionada está vacía',
        },

        // Processing - partially recoverable
        [ErrorCode.MATCHING_TIMEOUT]: {
            recoverable: true,
            suggestedAction: 'El proceso de matching tardó demasiado. Reintentando...',
        },
        [ErrorCode.MATCHING_NO_RESULTS]: {
            recoverable: false,
            suggestedAction: 'No se encontraron coincidencias. Verifica los archivos CAD.',
        },
        [ErrorCode.MATCHING_LOW_CONFIDENCE]: {
            recoverable: true,
            suggestedAction: 'Matches de baja confianza. Requiere revisión manual.',
        },

        // Pricing - recoverable with fallback
        [ErrorCode.PRICING_API_FAILED]: {
            recoverable: true,
            suggestedAction: 'Error al buscar precios. Reintentando con caché...',
        },
        [ErrorCode.PRICING_NO_RESULTS]: {
            recoverable: true,
            suggestedAction: 'No se encontraron precios. Puedes ingresarlos manualmente.',
        },
        [ErrorCode.PRICING_INVALID_RESPONSE]: {
            recoverable: true,
            suggestedAction: 'Respuesta inválida de API de precios. Reintentando...',
        },
        [ErrorCode.PRICING_RATE_LIMIT]: {
            recoverable: true,
            suggestedAction: 'Límite de API alcanzado. Esperando antes de reintentar...',
        },

        // Validation - not recoverable, need user fix
        [ErrorCode.VALIDATION_FAILED]: {
            recoverable: false,
            suggestedAction: 'Corrige los errores de validación antes de continuar',
        },
        [ErrorCode.VALIDATION_MISSING_REQUIRED]: {
            recoverable: false,
            suggestedAction: 'Completa los campos requeridos',
        },
        [ErrorCode.VALIDATION_INVALID_QUANTITY]: {
            recoverable: false,
            suggestedAction: 'Verifica las cantidades ingresadas',
        },
        [ErrorCode.VALIDATION_INVALID_PRICE]: {
            recoverable: false,
            suggestedAction: 'Verifica los precios ingresados',
        },

        // Database - recoverable with retry
        [ErrorCode.DB_CONNECTION_FAILED]: {
            recoverable: true,
            suggestedAction: 'Error de conexión a base de datos. Reintentando...',
        },
        [ErrorCode.DB_QUERY_FAILED]: {
            recoverable: true,
            suggestedAction: 'Error en consulta. Reintentando...',
        },
        [ErrorCode.DB_CONSTRAINT_VIOLATION]: {
            recoverable: false,
            suggestedAction: 'Violación de restricción de base de datos',
        },

        // Auth - not recoverable, need re-auth
        [ErrorCode.AUTH_UNAUTHORIZED]: {
            recoverable: false,
            suggestedAction: 'Debes iniciar sesión para continuar',
        },
        [ErrorCode.AUTH_FORBIDDEN]: {
            recoverable: false,
            suggestedAction: 'No tienes permisos para esta acción',
        },
        [ErrorCode.AUTH_TOKEN_EXPIRED]: {
            recoverable: false,
            suggestedAction: 'Tu sesión expiró. Por favor inicia sesión nuevamente',
        },

        // Storage - recoverable with retry
        [ErrorCode.STORAGE_UPLOAD_FAILED]: {
            recoverable: true,
            suggestedAction: 'Error al subir archivo. Reintentando...',
        },
        [ErrorCode.STORAGE_DOWNLOAD_FAILED]: {
            recoverable: true,
            suggestedAction: 'Error al descargar archivo. Reintentando...',
        },
        [ErrorCode.STORAGE_FILE_NOT_FOUND]: {
            recoverable: false,
            suggestedAction: 'Archivo no encontrado en almacenamiento',
        },

        // AI - recoverable with retry/fallback
        [ErrorCode.AI_API_FAILED]: {
            recoverable: true,
            suggestedAction: 'Error en API de IA. Reintentando...',
        },
        [ErrorCode.AI_TIMEOUT]: {
            recoverable: true,
            suggestedAction: 'Timeout en API de IA. Reintentando...',
        },
        [ErrorCode.AI_QUOTA_EXCEEDED]: {
            recoverable: false,
            suggestedAction: 'Cuota de IA excedida. Contacta al administrador.',
        },

        // General
        [ErrorCode.UNKNOWN_ERROR]: {
            recoverable: true,
            suggestedAction: 'Error desconocido. Contacta soporte si persiste.',
        },
        [ErrorCode.NETWORK_ERROR]: {
            recoverable: true,
            suggestedAction: 'Error de red. Verifica tu conexión.',
        },
        [ErrorCode.TIMEOUT_ERROR]: {
            recoverable: true,
            suggestedAction: 'Operación tardó demasiado. Reintentando...',
        },
    };

    return configs[code] || { recoverable: false };
}

/**
 * Calculate exponential backoff delay for retry attempts
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 1000ms)
 * @returns Delay in milliseconds, capped at 30 seconds
 * @example
 * ```ts
 * exponentialBackoff(0) // 1000ms
 * exponentialBackoff(1) // 2000ms
 * exponentialBackoff(2) // 4000ms
 * exponentialBackoff(5) // 30000ms (capped)
 * ```
 */
export function exponentialBackoff(attempt: number, baseDelay: number = 1000): number {
    return Math.min(baseDelay * Math.pow(2, attempt), 30000); // Max 30s
}

/**
 * Sleep utility for async delays
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified delay
 * @example
 * ```ts
 * await sleep(1000); // Wait 1 second
 * ```
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
