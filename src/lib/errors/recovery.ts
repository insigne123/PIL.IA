// Recovery strategies for handling errors

import type { AppError, RecoveryStrategy, RecoveryResult } from './types';
import { ErrorCode, exponentialBackoff, sleep } from './types';

/**
 * Retry with exponential backoff
 */
export const retryWithBackoff: RecoveryStrategy = {
    name: 'retry-with-backoff',
    maxRetries: 3,

    canRecover: (error: AppError) => {
        const recoverableCodes = [
            ErrorCode.DB_CONNECTION_FAILED,
            ErrorCode.DB_QUERY_FAILED,
            ErrorCode.NETWORK_ERROR,
            ErrorCode.TIMEOUT_ERROR,
            ErrorCode.STORAGE_UPLOAD_FAILED,
            ErrorCode.STORAGE_DOWNLOAD_FAILED,
            ErrorCode.AI_API_FAILED,
            ErrorCode.AI_TIMEOUT,
        ];
        return recoverableCodes.includes(error.code);
    },

    recover: async (error: AppError, context: any): Promise<RecoveryResult> => {
        const attempt = context.attempt || 0;
        const maxRetries = context.maxRetries || 3;

        if (attempt >= maxRetries) {
            return {
                success: false,
                error,
                strategy: 'retry-with-backoff',
            };
        }

        const delay = exponentialBackoff(attempt);
        console.log(`[Recovery] Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);

        await sleep(delay);

        try {
            const result = await context.operation();
            return {
                success: true,
                data: result,
                strategy: 'retry-with-backoff',
            };
        } catch (err) {
            return {
                success: false,
                error: error,
                strategy: 'retry-with-backoff',
            };
        }
    },
};

/**
 * Fallback to cache for pricing
 */
export const fallbackToCache: RecoveryStrategy = {
    name: 'fallback-to-cache',

    canRecover: (error: AppError) => {
        return [
            ErrorCode.PRICING_API_FAILED,
            ErrorCode.PRICING_RATE_LIMIT,
            ErrorCode.PRICING_INVALID_RESPONSE,
        ].includes(error.code);
    },

    recover: async (error: AppError, context: any): Promise<RecoveryResult> => {
        console.log('[Recovery] Falling back to price cache');

        try {
            // Try to get cached price with extended max age
            const cached = await context.getCachedPrice(context.item, {
                maxAge: '90d', // Accept older cache in emergency
            });

            if (cached) {
                return {
                    success: true,
                    data: cached,
                    strategy: 'fallback-to-cache',
                };
            }

            return {
                success: false,
                error,
                strategy: 'fallback-to-cache',
            };
        } catch (err) {
            return {
                success: false,
                error,
                strategy: 'fallback-to-cache',
            };
        }
    },
};

/**
 * Use default values
 */
export const useDefaults: RecoveryStrategy = {
    name: 'use-defaults',

    canRecover: (error: AppError) => {
        return [
            ErrorCode.PRICING_NO_RESULTS,
            ErrorCode.MATCHING_NO_RESULTS,
        ].includes(error.code);
    },

    recover: async (error: AppError, context: any): Promise<RecoveryResult> => {
        console.log('[Recovery] Using default values');

        const defaults = context.defaults || {};

        return {
            success: true,
            data: defaults,
            strategy: 'use-defaults',
        };
    },
};

/**
 * Skip and continue
 */
export const skipAndContinue: RecoveryStrategy = {
    name: 'skip-and-continue',

    canRecover: (error: AppError) => {
        return [
            ErrorCode.MATCHING_LOW_CONFIDENCE,
            ErrorCode.PRICING_NO_RESULTS,
        ].includes(error.code);
    },

    recover: async (error: AppError, context: any): Promise<RecoveryResult> => {
        console.log('[Recovery] Skipping item and continuing');

        return {
            success: true,
            data: null, // Indicates skip
            strategy: 'skip-and-continue',
        };
    },
};

/**
 * Rate limit backoff
 */
export const rateLimitBackoff: RecoveryStrategy = {
    name: 'rate-limit-backoff',

    canRecover: (error: AppError) => {
        return error.code === ErrorCode.PRICING_RATE_LIMIT;
    },

    recover: async (error: AppError, context: any): Promise<RecoveryResult> => {
        // Wait longer for rate limits
        const delay = 60000; // 1 minute
        console.log(`[Recovery] Rate limited. Waiting ${delay}ms before retry`);

        await sleep(delay);

        try {
            const result = await context.operation();
            return {
                success: true,
                data: result,
                strategy: 'rate-limit-backoff',
            };
        } catch (err) {
            return {
                success: false,
                error,
                strategy: 'rate-limit-backoff',
            };
        }
    },
};

/**
 * All recovery strategies
 */
export const recoveryStrategies: RecoveryStrategy[] = [
    rateLimitBackoff, // Try this first for rate limits
    retryWithBackoff,
    fallbackToCache,
    useDefaults,
    skipAndContinue,
];

/**
 * Attempt recovery using available strategies
 * @param error - The error to recover from
 * @param context - Context for recovery strategies
 * @param attempt - Current attempt number (for retry strategies)
 * @returns Recovery result with success status and data/error
 */
export async function attemptRecovery(
    error: AppError,
    context: any,
    attempt: number = 0
): Promise<RecoveryResult> {
    for (const strategy of recoveryStrategies) {
        if (strategy.canRecover(error)) {
            console.log(`[Recovery] Attempting strategy: ${strategy.name} (attempt ${attempt + 1})`);

            const result = await strategy.recover(error, {
                ...context,
                attempt,  // Pass current attempt to strategy
            });

            if (result.success) {
                console.log(`[Recovery] Success with strategy: ${strategy.name}`);
                return result;
            }

            // If retry strategy failed and we haven't exceeded max retries, try again
            if (strategy.name === 'retry-with-backoff' && attempt < (strategy.maxRetries || 3) - 1) {
                console.log(`[Recovery] Retry strategy failed, incrementing attempt and retrying`);
                return attemptRecovery(error, context, attempt + 1);
            }
        }
    }

    console.log('[Recovery] All strategies failed');
    return {
        success: false,
        error,
        strategy: 'none',
    };
}
