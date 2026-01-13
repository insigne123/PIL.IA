/**
 * Enhanced Logging System for PIL.IA
 * Supports structured logging, persistence, and export for manual testing
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: Record<string, any>;
    stack?: string;
}

class Logger {
    private logs: LogEntry[] = [];
    private maxLogs = 1000;
    private isDevelopment = process.env.NODE_ENV !== 'production';

    private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            stack: error?.stack
        };

        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        const emoji = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[level];
        const color = { debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
        const reset = '\x1b[0m';

        console.log(`${color}${emoji} [${level.toUpperCase()}]${reset} ${message}`, context || '');
        if (error?.stack && this.isDevelopment) console.error(error.stack);

        if (typeof window !== 'undefined') {
            try {
                const stored = this.getStoredLogs();
                stored.push(entry);
                if (stored.length > 500) stored.shift();
                localStorage.setItem('pil_logs', JSON.stringify(stored));
            } catch (e) {
                console.warn('Failed to store log');
            }
        }
    }

    debug(message: string, context?: Record<string, any>) {
        if (this.isDevelopment) this.log('debug', message, context);
    }

    info(message: string, context?: Record<string, any>) {
        this.log('info', message, context);
    }

    warn(message: string, context?: Record<string, any>) {
        this.log('warn', message, context);
    }

    error(message: string, contextOrError?: Record<string, any> | Error) {
        const isError = contextOrError instanceof Error;
        this.log('error', message, isError ? { error: contextOrError.message } : contextOrError, isError ? contextOrError : undefined);
    }

    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    getStoredLogs(): LogEntry[] {
        if (typeof window === 'undefined') return [];
        try {
            const stored = localStorage.getItem('pil_logs');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    }

    exportLogs(filename = `pil-logs-${new Date().toISOString().split('T')[0]}.json`) {
        const allLogs = [...this.logs, ...this.getStoredLogs()];
        const blob = new Blob([JSON.stringify(allLogs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    clear() {
        this.logs = [];
        if (typeof window !== 'undefined') localStorage.removeItem('pil_logs');
        console.clear();
    }

    getLogsByLevel(level: LogLevel): LogEntry[] {
        return this.logs.filter(log => log.level === level);
    }
}

export const logger = new Logger();

if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
        logger.error('Unhandled error', { message: e.message, filename: e.filename, line: e.lineno });
    });
    window.addEventListener('unhandledrejection', (e) => {
        logger.error('Unhandled promise rejection', { reason: e.reason });
    });
}

