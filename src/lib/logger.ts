// Logger utility for conditional logging based on environment
// This prevents console.log spam in production and potential information leakage

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
    private isDevelopment = process.env.NODE_ENV === 'development';

    debug(...args: any[]) {
        if (this.isDevelopment) {
            console.log('[DEBUG]', ...args);
        }
    }

    info(...args: any[]) {
        console.log('[INFO]', ...args);
    }

    warn(...args: any[]) {
        console.warn('[WARN]', ...args);
    }

    error(...args: any[]) {
        console.error('[ERROR]', ...args);
    }

    // Conditional logging based on level
    log(level: LogLevel, ...args: any[]) {
        switch (level) {
            case 'debug':
                this.debug(...args);
                break;
            case 'info':
                this.info(...args);
                break;
            case 'warn':
                this.warn(...args);
                break;
            case 'error':
                this.error(...args);
                break;
        }
    }
}

export const logger = new Logger();
