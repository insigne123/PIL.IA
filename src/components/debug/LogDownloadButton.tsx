/**
 * Log Download Button Component
 * 
 * Floating button to download processing logs for debugging
 * Add this to your main processing page
 */

'use client';

import { useState, useEffect } from 'react';
import { Download, Copy, Trash2, FileText } from 'lucide-react';
import logCapture from '@/lib/log-capture';

export function LogDownloadButton() {
    const [isCapturing, setIsCapturing] = useState(false);
    const [logCount, setLogCount] = useState(0);
    const [showMenu, setShowMenu] = useState(false);

    useEffect(() => {
        // Update log count every second when capturing
        if (isCapturing) {
            const interval = setInterval(() => {
                setLogCount(logCapture.getLogs().length);
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [isCapturing]);

    const handleStartCapture = () => {
        logCapture.startCapture();
        setIsCapturing(true);
        setLogCount(0);
    };

    const handleStopCapture = () => {
        logCapture.stopCapture();
        setIsCapturing(false);
    };

    const handleDownloadTxt = () => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        logCapture.downloadLogs(`processing-logs-${timestamp}.txt`);
    };

    const handleDownloadJson = () => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        logCapture.downloadLogsJSON(`processing-logs-${timestamp}.json`);
    };

    const handleCopyToClipboard = async () => {
        await logCapture.copyLogsToClipboard();
        alert('Logs copiados al portapapeles!');
    };

    const handleClear = () => {
        if (confirm('¿Estás seguro de que quieres borrar los logs capturados?')) {
            logCapture.clearLogs();
            setLogCount(0);
        }
    };

    const summary = logCapture.getSummary();

    return (
        <div className="fixed bottom-4 right-4 z-50">
            {/* Main Button */}
            <button
                onClick={() => setShowMenu(!showMenu)}
                className={`
          flex items-center gap-2 px-4 py-2 rounded-full shadow-lg font-medium
          transition-all duration-200
          ${isCapturing
                        ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                    }
        `}
            >
                <FileText size={20} />
                {isCapturing ? (
                    <span>Capturando... ({logCount})</span>
                ) : (
                    <span>Logs ({logCount})</span>
                )}
            </button>

            {/* Menu */}
            {showMenu && (
                <div className="absolute bottom-16 right-0 bg-white rounded-lg shadow-xl border border-gray-200 p-3 min-w-[300px]">
                    <div className="mb-3 pb-3 border-b">
                        <h3 className="font-semibold text-gray-900 mb-1">Log Capture</h3>
                        <div className="text-sm text-gray-600">
                            <div>Total: {summary.total} logs</div>
                            {summary.errors > 0 && <div className="text-red-600">❌ Errors: {summary.errors}</div>}
                            {summary.warnings > 0 && <div className="text-yellow-600">⚠️ Warnings: {summary.warnings}</div>}
                        </div>
                    </div>

                    {/* Capture Controls */}
                    <div className="space-y-2 mb-3">
                        {!isCapturing ? (
                            <button
                                onClick={handleStartCapture}
                                className="w-full px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                ▶️ Iniciar Captura
                            </button>
                        ) : (
                            <button
                                onClick={handleStopCapture}
                                className="w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                ⏹️ Detener Captura
                            </button>
                        )}
                    </div>

                    {/* Download Options */}
                    <div className="space-y-2">
                        <button
                            onClick={handleDownloadTxt}
                            disabled={logCount === 0}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <Download size={16} />
                            Descargar TXT
                        </button>

                        <button
                            onClick={handleDownloadJson}
                            disabled={logCount === 0}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <Download size={16} />
                            Descargar JSON
                        </button>

                        <button
                            onClick={handleCopyToClipboard}
                            disabled={logCount === 0}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <Copy size={16} />
                            Copiar al Portapapeles
                        </button>

                        <button
                            onClick={handleClear}
                            disabled={logCount === 0}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            <Trash2 size={16} />
                            Limpiar Logs
                        </button>
                    </div>

                    {/* Instructions */}
                    <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                        💡 <strong>Uso:</strong><br />
                        1. Click "Iniciar Captura"<br />
                        2. Procesa DXF+Excel normalmente<br />
                        3. Descarga logs para análisis con IA
                    </div>
                </div>
            )}
        </div>
    );
}
