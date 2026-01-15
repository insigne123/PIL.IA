/**
 * Log Capture System
 * 
 * Captures console logs from DXF/Excel processing for debugging and AI analysis
 * 
 * Usage:
 * 1. Call startLogCapture() before processing
 * 2. Process DXF+Excel normally
 * 3. Call downloadLogs() to save logs as text file
 */

interface LogEntry {
    timestamp: string;
    level: 'log' | 'warn' | 'error' | 'info';
    message: string;
    data?: any[];
}

class LogCaptureService {
    private logs: LogEntry[] = [];
    private isCapturing: boolean = false;
    private originalConsole: {
        log: typeof console.log;
        warn: typeof console.warn;
        error: typeof console.error;
        info: typeof console.info;
    };

    constructor() {
        // Save original console methods
        this.originalConsole = {
            log: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            info: console.info.bind(console),
        };
    }

    /**
     * Start capturing console logs
     */
    startCapture(): void {
        if (this.isCapturing) return;

        this.logs = [];
        this.isCapturing = true;

        // Override console methods
        console.log = (...args: any[]) => {
            this.captureLog('log', args);
            this.originalConsole.log(...args);
        };

        console.warn = (...args: any[]) => {
            this.captureLog('warn', args);
            this.originalConsole.warn(...args);
        };

        console.error = (...args: any[]) => {
            this.captureLog('error', args);
            this.originalConsole.error(...args);
        };

        console.info = (...args: any[]) => {
            this.captureLog('info', args);
            this.originalConsole.info(...args);
        };

        console.log('📝 [Log Capture] Started - All logs will be captured');
    }

    /**
     * Stop capturing and restore original console
     */
    stopCapture(): void {
        if (!this.isCapturing) return;

        console.log = this.originalConsole.log;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.info = this.originalConsole.info;

        this.isCapturing = false;
        this.originalConsole.log('📝 [Log Capture] Stopped');
    }

    /**
     * Capture a log entry
     */
    private captureLog(level: LogEntry['level'], args: any[]): void {
        const message = args
            .map(arg => {
                if (typeof arg === 'string') return arg;
                if (typeof arg === 'object') return JSON.stringify(arg, null, 2);
                return String(arg);
            })
            .join(' ');

        this.logs.push({
            timestamp: new Date().toISOString(),
            level,
            message,
            data: args,
        });
    }

    /**
     * Get all captured logs
     */
    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    /**
     * Download logs as text file
     */
    downloadLogs(filename: string = 'processing-logs.txt'): void {
        const content = this.formatLogsForDownload();
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);

        this.originalConsole.log(`📥 Downloaded logs: ${filename}`);
    }

    /**
     * Download logs as JSON file
     */
    downloadLogsJSON(filename: string = 'processing-logs.json'): void {
        const content = JSON.stringify(this.logs, null, 2);
        const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);

        this.originalConsole.log(`📥 Downloaded logs (JSON): ${filename}`);
    }

    /**
     * Format logs for text download
     */
    private formatLogsForDownload(): string {
        const header = `
=================================================================
DXF/Excel Processing Logs
Generated: ${new Date().toLocaleString()}
Total Entries: ${this.logs.length}
=================================================================

`;

        const logLines = this.logs.map((log, index) => {
            const levelIcon = {
                log: '💬',
                warn: '⚠️',
                error: '❌',
                info: 'ℹ️',
            }[log.level];

            return `[${index + 1}] ${levelIcon} ${log.timestamp} [${log.level.toUpperCase()}]
${log.message}
${'─'.repeat(80)}`;
        });

        const footer = `
=================================================================
End of Logs
=================================================================
`;

        return header + logLines.join('\n') + footer;
    }

    /**
     * Copy logs to clipboard
     */
    async copyLogsToClipboard(): Promise<void> {
        const content = this.formatLogsForDownload();
        try {
            await navigator.clipboard.writeText(content);
            this.originalConsole.log('📋 Logs copied to clipboard');
        } catch (err) {
            this.originalConsole.error('Failed to copy logs to clipboard:', err);
        }
    }

    /**
     * Filter logs by keyword
     */
    filterLogs(keyword: string): LogEntry[] {
        return this.logs.filter(log =>
            log.message.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    /**
     * Get summary statistics
     */
    getSummary(): {
        total: number;
        byLevel: Record<string, number>;
        errors: number;
        warnings: number;
        timestampRange: { start: string; end: string } | null;
    } {
        const byLevel: Record<string, number> = {};
        this.logs.forEach(log => {
            byLevel[log.level] = (byLevel[log.level] || 0) + 1;
        });

        return {
            total: this.logs.length,
            byLevel,
            errors: byLevel.error || 0,
            warnings: byLevel.warn || 0,
            timestampRange: this.logs.length > 0
                ? {
                    start: this.logs[0].timestamp,
                    end: this.logs[this.logs.length - 1].timestamp,
                }
                : null,
        };
    }

    /**
     * Clear all captured logs
     */
    clearLogs(): void {
        this.logs = [];
        this.originalConsole.log('🗑️ Logs cleared');
    }
}

// Singleton instance
export const logCapture = new LogCaptureService();

// Export for use in components
export default logCapture;
