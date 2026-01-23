import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'matcher-debug.log');

export function logMatcherDebug(message: string) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    // Write to file (append mode)
    try {
        fs.appendFileSync(LOG_FILE, logLine, 'utf-8');
    } catch (error) {
        console.error('Failed to write to matcher-debug.log:', error);
    }

    // Also log to console
    console.log(message);
}

export function clearMatcherLog() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            fs.unlinkSync(LOG_FILE);
        }
    } catch (error) {
        console.error('Failed to clear matcher-debug.log:', error);
    }
}
