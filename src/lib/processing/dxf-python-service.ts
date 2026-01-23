import { spawn } from 'child_process';
import path from 'path';

export interface PythonDxfResult {
    status: 'success' | 'error';
    items?: any[];
    stats?: any;
    metadata?: any;
    message?: string;
}

export async function parseDxfWithPython(filePath: string): Promise<PythonDxfResult> {
    return new Promise((resolve, reject) => {
        // Assume 'python' is in PATH. In production might need specific path or 'python3'
        const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
        const scriptPath = path.join(process.cwd(), 'scripts', 'process_dxf.py');

        console.log(`[Python Service] Spawning: ${pythonCommand} "${scriptPath}" "${filePath}"`);

        const pythonProcess = spawn(pythonCommand, [scriptPath, filePath]);

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorString += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`[Python Service] Error: ${errorString}`);
                reject(new Error(`Python script exited with code ${code}. Error: ${errorString}`));
                return;
            }

            try {
                // Find the last valid JSON object in output (ignore debug prints if any)
                const jsonStart = dataString.indexOf('{');
                const jsonEnd = dataString.lastIndexOf('}');

                if (jsonStart === -1 || jsonEnd === -1) {
                    throw new Error("No JSON found in Python output");
                }

                const jsonContent = dataString.substring(jsonStart, jsonEnd + 1);
                const result = JSON.parse(jsonContent);

                if (result.status === 'error') {
                    reject(new Error(result.message));
                } else {
                    resolve(result);
                }
            } catch (e: any) {
                console.error(`[Python Service] Parse Error. Output was: ${dataString.substring(0, 200)}...`);
                reject(new Error(`Failed to parse Python output: ${e.message}`));
            }
        });
    });
}
