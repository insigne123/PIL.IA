"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Batch, BatchFile } from '@/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Loader2, Download, AlertTriangle, DollarSign } from 'lucide-react';
import { FileUploader } from '@/components/yago/FileUploader';
import { v4 as uuidv4 } from 'uuid';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { StagingRow } from '@/types';
import { StagingTable } from '@/components/yago/StagingTable';

export default function BatchPage() {
    const params = useParams();
    const projectId = params?.id as string;
    const batchId = params?.batchId as string;
    const router = useRouter();

    const [batch, setBatch] = useState<Batch | null>(null);
    const [files, setFiles] = useState<BatchFile[]>([]);
    const [stagingRows, setStagingRows] = useState<StagingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'upload' | 'process' | 'staging' | 'output'>('process');
    const [stagingFilter, setStagingFilter] = useState<'all' | 'pending' | 'approved' | 'low-confidence'>('all');
    const [searchTerm, setSearchTerm] = useState('');

    const fetchBatchData = useCallback(async () => {
        setLoading(true);
        // Fetch Batch
        const { data: batchData, error: batchError } = await supabase
            .from('batches')
            .select('*')
            .eq('id', batchId)
            .single();

        if (batchData) {
            setBatch({
                id: batchData.id,
                projectId: batchData.project_id,
                name: batchData.name,
                unitSelected: batchData.unit_selected,
                heightDefault: batchData.height_default,
                sheetTarget: batchData.sheet_target,
                status: batchData.status,
                createdAt: batchData.created_at
            });
        }

        // Fetch Files
        const { data: filesData } = await supabase
            .from('batch_files')
            .select('*')
            .eq('batch_id', batchId);

        if (filesData) {
            setFiles(filesData.map(f => ({
                id: f.id,
                batchId: f.batch_id,
                originalName: f.original_filename,
                fileType: f.file_type,
                size: f.size_bytes,
                status: f.status,
                storagePath: f.storage_path,
                createdAt: f.created_at,
                errorCode: f.error_code,
                errorMessage: f.error_message,
                detectedUnit: f.detected_unit // Map detected Unit
            })));
        }

        // Fetch Staging Rows when tab is 'staging' or just always if batch is ready
        if (batchData && batchData.status === 'ready') {
            const { data: stagingRows, error: stagingError } = await supabase
                .from('staging_rows')
                .select('*') // Correct: source_items is already in *
                .eq('batch_id', batchId)
                .order('excel_row_index', { ascending: true });

            if (stagingRows) {
                // Map DB snake_case to CamelCase TS Interface if needed, or update interface
                // Our Interface keys: excel_item_text... same as DB.
                // source_items is jsonb, matches ItemDetectado[]
                // price_candidates is jsonb, matches PriceSource[]
                setStagingRows(stagingRows as unknown as StagingRow[]);
            }
        }

        setLoading(false);
    }, [batchId]);

    // This useEffect is for initial data fetch and realtime subscription
    useEffect(() => {
        const controller = new AbortController();
        let mounted = true;

        const fetchData = async () => {
            if (!batchId || !mounted) return;

            try {
                await fetchBatchData();
            } catch (err) {
                if (err instanceof Error && err.name !== 'AbortError') {
                    console.error('Error fetching batch data:', err);
                }
            }
        };

        fetchData();

        // Realtime subscription for file status
        const channel = supabase.channel(`batch-${batchId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'batch_files',
                filter: `batch_id=eq.${batchId}`
            }, () => {
                if (mounted) {
                    fetchBatchData();
                }
            })
            .subscribe();

        return () => {
            mounted = false;
            controller.abort();
            channel.unsubscribe();
        };
    }, [batchId, fetchBatchData]);

    // UX: Set initial tab based on batch state
    useEffect(() => {
        if (!batch || !files) return;

        // If batch is new (pending) and has no files, show upload tab
        if (batch.status === 'pending' && files.length === 0) {
            setActiveTab('upload'); // ✅ Correctly redirect to upload tab
        }
        // If batch is ready, show staging tab
        else if (batch.status === 'ready') {
            setActiveTab('staging');
        }
        // Otherwise keep current tab (or default to process)
    }, [batch, files]);

    // Check for Mismatch
    const mismatchFile = files.find(f => f.fileType === 'dxf' && f.detectedUnit && f.detectedUnit !== batch?.unitSelected);

    const handleRectifyUnit = async () => {
        if (!mismatchFile || !batch) return;
        const correctUnit = mismatchFile.detectedUnit;

        setLoading(true);
        try {
            // 1. Update Batch Unit
            await supabase.from('batches').update({ unit_selected: correctUnit }).eq('id', batch.id);

            // 2. Reset File Status to 'uploaded' to trigger re-extraction in next poll/run
            await supabase.from('batch_files').update({
                status: 'uploaded',
                storage_json_path: null,
                error_message: null
            }).eq('batch_id', batch.id).eq('file_type', 'dxf');

            // 3. Clear existing staging rows (optional but cleaner)
            await supabase.from('staging_rows').delete().eq('batch_id', batch.id);

            alert(`Unidad corregida a ${correctUnit?.toUpperCase()}. Reprocesando automáticamente...`);

            // 4. Start processing automatically
            const startRes = await fetch(`/api/batches/${batch.id}/start`, { method: 'POST' });
            if (!startRes.ok) {
                alert("Error al iniciar reprocesamiento");
                setLoading(false);
                return;
            }

            // 5. Run worker loop automatically
            let keepingAlive = true;
            while (keepingAlive) {
                const res = await fetch('/api/worker/run', { method: 'POST' });
                if (!res.ok) keepingAlive = false;
                const json = await res.json();
                if (json.message === "No jobs pending") keepingAlive = false;
                await new Promise(r => setTimeout(r, 1000));
                await fetchBatchData();
            }

            alert("Reprocesamiento completado con la unidad correcta.");
            setActiveTab('staging'); // Redirect to staging to see results
            fetchBatchData();
        } catch (e) {
            console.error(e);
            alert("Error al rectificar unidad");
        } finally {
            setLoading(false);
        }
    };

    // Auto-poll worker when batch is processing
    useEffect(() => {
        if (!batch || batch.status !== 'processing') return;

        let isActive = true;
        const pollWorker = async () => {
            while (isActive && batch.status === 'processing') {
                try {
                    const res = await fetch('/api/worker/run', { method: 'POST' });
                    if (!res.ok) break;
                    const json = await res.json();
                    if (json.message === "No jobs pending") break;

                    // Refresh batch data
                    await fetchBatchData();

                    // Wait 2 seconds before next poll
                    await new Promise(r => setTimeout(r, 2000));
                } catch (error) {
                    console.error('Worker poll error:', error);
                    break;
                }
            }
        };

        pollWorker();

        return () => {
            isActive = false;
        };
    }, [batch?.status, fetchBatchData]);

    useEffect(() => {
        if (batchId) fetchBatchData();

        // Realtime subscription for file status
        const channel = supabase.channel('batch_files')
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'batch_files', filter: `batch_id=eq.${batchId}` },
                () => {
                    fetchBatchData(); // Reload for simplicity in MVP
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [batchId, fetchBatchData]);

    const handleUpload = async (selectedFiles: File[]) => {
        if (!selectedFiles.length) return;

        setLoading(true);

        try {
            for (const file of selectedFiles) {
                console.log('📤 [Upload] Starting upload for file:', file.name, 'Type:', file.type, 'Size:', file.size);

                // Validate file size (50MB limit)
                const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
                if (file.size > MAX_FILE_SIZE) {
                    alert(`❌ Archivo "${file.name}" demasiado grande. Máximo permitido: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
                    continue;
                }

                // Validate file type
                const fileType = file.name.endsWith('.dxf') ? 'dxf' :
                    file.name.endsWith('.xlsx') || file.name.endsWith('.xls') ? 'excel' :
                        file.name.endsWith('.dwg') ? 'dwg' :
                            file.name.endsWith('.csv') ? 'csv' : null;

                console.log('📋 [Upload] Detected file type:', fileType, 'for file:', file.name);

                if (!fileType) {
                    alert(`Tipo de archivo no soportado: ${file.name}`);
                    continue;
                }

                // Sanitize filename for storage (remove special characters, spaces, accents)
                const sanitizeFilename = (filename: string): string => {
                    const extension = filename.substring(filename.lastIndexOf('.'));
                    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));

                    // Remove accents and special characters
                    const sanitized = nameWithoutExt
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '') // Remove accents
                        .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace special chars with underscore
                        .replace(/_+/g, '_') // Replace multiple underscores with single
                        .replace(/^_|_$/g, ''); // Remove leading/trailing underscores

                    return sanitized + extension;
                };

                const sanitizedFilename = sanitizeFilename(file.name);
                console.log('🧹 [Upload] Sanitized filename:', file.name, '→', sanitizedFilename);

                // Upload to Supabase Storage with sanitized name
                const storagePath = `${batchId}/${sanitizedFilename}`;
                console.log('☁️ [Upload] Uploading to storage path:', storagePath);

                const { error: uploadError } = await supabase.storage
                    .from('yago-source')
                    .upload(storagePath, file, { upsert: true });

                if (uploadError) {
                    console.error('❌ [Upload] Storage upload error:', uploadError);
                    alert(`Error subiendo ${file.name}: ${uploadError.message}`);
                    continue;
                }

                console.log('✅ [Upload] File uploaded to storage successfully');

                // Create DB record
                console.log('💾 [Upload] Creating DB record with type:', fileType);
                const { error: dbError } = await supabase.from('batch_files').insert({
                    batch_id: batchId,
                    original_filename: file.name,
                    file_type: fileType,
                    size_bytes: file.size,
                    storage_path: storagePath,
                    status: 'uploaded'
                });

                if (dbError) {
                    console.error('❌ [Upload] DB insert error:', dbError);
                    alert(`Error guardando ${file.name}: ${dbError.message}`);
                } else {
                    console.log('✅ [Upload] DB record created successfully');
                }
            }

            await fetchBatchData();
        } catch (err) {
            console.error('❌ [Upload] Unexpected error:', err);
            alert('Error subiendo archivos');
        } finally {
            setLoading(false);
        }
    };

    const handleResetBatch = async () => {
        if (!confirm("¿Estás seguro de reiniciar este lote? Se perderán todos los datos procesados (cruces, staging) y tendrás que procesar de nuevo. Los archivos cargados se mantendrán.")) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/batches/${batchId}/reset`, { method: 'POST' });
            if (!res.ok) throw new Error("Error resetting");

            alert("Lote reiniciado correctamente.");
            await fetchBatchData();
            setActiveTab('process');
        } catch (e) {
            console.error(e);
            alert("Error al reiniciar lote");
        } finally {
            setLoading(false);
        }
    };

    if (loading && !batch) return <div className="p-10 text-center">Cargando lote...</div>;
    if (!batch) return <div className="p-10 text-center">Lote no encontrado</div>;

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{batch?.name || 'Cargando...'}</h1>
                    <p className="text-muted-foreground">
                        {batch?.unitSelected.toUpperCase()} • {files.length} Archivos
                    </p>
                </div>
                <div className="ml-auto">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleResetBatch}
                        className="text-slate-600 border-slate-300 hover:bg-slate-100"
                    >
                        Reiniciar Lote
                    </Button>
                </div>
            </div>

            {/* UNIT MISMATCH ALERT */}
            {mismatchFile && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div className="flex-1">
                        <h4 className="font-semibold text-amber-900">Inconsistencia de Unidades Detectada</h4>
                        <p className="text-sm text-amber-700 mt-1">
                            El archivo <strong>{mismatchFile.originalName}</strong> parece estar dibujado en
                            <strong> {mismatchFile.detectedUnit?.toUpperCase()}</strong> ({mismatchFile.detectedUnit === 'mm' ? 'Milímetros' : mismatchFile.detectedUnit === 'cm' ? 'Centímetros' : 'Metros'}),
                            pero el lote está configurado en <strong>{batch?.unitSelected.toUpperCase()}</strong>.
                        </p>
                        <p className="text-sm text-amber-700 mt-1">
                            Esto puede causar errores graves en las mediciones.
                        </p>
                        <div className="mt-3 flex gap-2">
                            <Button
                                size="sm"
                                variant="default"
                                className="bg-amber-600 hover:bg-amber-700 text-white border-none"
                                onClick={handleRectifyUnit}
                                disabled={loading}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Rectificar a {mismatchFile.detectedUnit?.toUpperCase()} y Reprocesar
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="border-amber-200 text-amber-800 hover:bg-amber-100"
                                onClick={() => alert("Se mantendrá la unidad actual. Verifica los resultados con cuidado.")}
                            >
                                Ignorar
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="upload">1. Carga de Archivos</TabsTrigger>
                    <TabsTrigger value="process">2. Procesamiento</TabsTrigger>
                    <TabsTrigger value="staging">3. Revisión (Staging)</TabsTrigger>
                    <TabsTrigger value="output">4. Entregables</TabsTrigger>
                </TabsList>

                <TabsContent value="upload">
                    <Card>
                        <CardContent className="pt-6">
                            <FileUploader onFilesSelected={handleUpload} />

                            <div className="mt-6 space-y-2">
                                <h3 className="font-semibold">Archivos en el lote ({files.length})</h3>
                                <div className="bg-slate-50 rounded border divide-y">
                                    {files.map(f => (
                                        <div key={f.id} className="p-3 flex justify-between items-center text-sm">
                                            <span>{f.originalName}</span>
                                            <span className={`${f.status === 'uploaded' ? 'text-green-600' : 'text-slate-500'}`}>{f.status}</span>
                                        </div>
                                    ))}
                                    {files.length === 0 && <p className="p-4 text-slate-400 text-center">No hay archivos cargados aún.</p>}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <div className="mt-4 flex justify-end">
                        <Button onClick={() => setActiveTab('process')}>Ir a Procesamiento</Button>
                    </div>
                </TabsContent>

                <TabsContent value="process">
                    <Card>
                        <CardHeader>
                            <CardTitle>Estado del Procesamiento</CardTitle>
                            <CardDescription>
                                YAGO convertirá, extraerá y cruzará la información de los planos con el Excel.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex justify-center py-6">
                                {batch.status === 'pending' || batch.status === 'error' ? (
                                    <Button size="lg" disabled={loading} onClick={async () => {
                                        setLoading(true);

                                        // Check if there's a CSV file
                                        const csvFile = files.find(f => f.fileType === 'csv');

                                        if (csvFile) {
                                            // CSV Takeoff flow - use special endpoint
                                            console.log('📊 CSV detected, using CSV Takeoff flow');
                                            try {
                                                const res = await fetch(`/api/batches/${batchId}/process-csv`, { method: 'POST' });
                                                const json = await res.json();

                                                if (!res.ok) {
                                                    alert(`❌ Error: ${json.error}`);
                                                    setLoading(false);
                                                    return;
                                                }

                                                await fetchBatchData();
                                                setActiveTab('staging');
                                                alert('✅ Procesamiento CSV completado. Los datos están listos para revisión.');
                                                setLoading(false);
                                            } catch (err) {
                                                console.error(err);
                                                alert('❌ Error procesando CSV');
                                                setLoading(false);
                                            }
                                            return;
                                        }

                                        // Normal flow (no CSV) - use worker
                                        // 1. Mark batch as processing (queues jobs)
                                        await fetch(`/api/batches/${batchId}/start`, { method: 'POST' });

                                        // 2. Trigger Worker Loop with exponential backoff
                                        const processLoop = async () => {
                                            let pollInterval = 1000; // Start at 1s
                                            let consecutiveErrors = 0;
                                            const MAX_ERRORS = 3;
                                            const MAX_ITERATIONS = 100; // Safety limit to prevent infinite loops
                                            let iterations = 0;

                                            while (true) {
                                                iterations++;
                                                if (iterations > MAX_ITERATIONS) {
                                                    console.error(`Worker loop exceeded ${MAX_ITERATIONS} iterations`);
                                                    alert(`⚠️ Proceso detenido: límite de iteraciones alcanzado (${MAX_ITERATIONS}). Por favor contacta soporte si el problema persiste.`);
                                                    break;
                                                }

                                                try {
                                                    const res = await fetch('/api/worker/run', { method: 'POST' });

                                                    if (!res.ok) {
                                                        const errorText = await res.text().catch(() => 'Unknown error');
                                                        console.error(`Worker API error [${res.status}]:`, errorText);

                                                        consecutiveErrors++;
                                                        if (consecutiveErrors >= MAX_ERRORS) {
                                                            alert(`❌ Error en el procesamiento después de ${MAX_ERRORS} intentos. Por favor revisa los logs o intenta reiniciar el lote.`);
                                                            break;
                                                        }

                                                        // Wait before retry
                                                        await new Promise(r => setTimeout(r, 2000));
                                                        continue;
                                                    }

                                                    const json = await res.json();

                                                    // Reset error counter on success
                                                    consecutiveErrors = 0;

                                                    if (json.message === "No jobs pending") {
                                                        console.log("All jobs completed");
                                                        break;
                                                    }

                                                    if (json.error) {
                                                        console.error("Job failed:", json.error);
                                                        alert(`❌ Error en el trabajo: ${json.error}`);
                                                        break;
                                                    }

                                                    console.log("Job completed:", json.phase);
                                                    pollInterval = 1000; // Reset interval on successful job

                                                } catch (err) {
                                                    console.error("Worker loop fetch error:", err);
                                                    consecutiveErrors++;

                                                    if (consecutiveErrors >= MAX_ERRORS) {
                                                        alert(`❌ Error de conexión después de ${MAX_ERRORS} intentos. Verifica que el servidor esté corriendo.`);
                                                        break;
                                                    }

                                                    // Wait before retry
                                                    await new Promise(r => setTimeout(r, 2000));
                                                    continue;
                                                }

                                                // Exponential backoff: 1s → 2s → 5s (max)
                                                await new Promise(r => setTimeout(r, pollInterval));
                                                pollInterval = Math.min(pollInterval * 1.5, 5000);

                                                await fetchBatchData(); // Refresh UI
                                            }

                                            // Processing complete - redirect to staging
                                            await fetchBatchData(); // Final refresh

                                            if (batch.status === 'ready') {
                                                setActiveTab('staging');
                                                alert('✅ Procesamiento completado. Los datos están listos para revisión en la pestaña Staging.');
                                            } else if (batch.status === 'waiting_review') {
                                                // Mismatch detected => Stop here
                                                console.log("Processing paused for review");
                                                alert('⚠️ Procesamiento PAUSADO. Se detectó una inconsistencia de unidades. Por favor rectifica para continuar.');
                                            }
                                            setLoading(false);
                                        };

                                        processLoop();
                                        fetchBatchData(); // Immediate UI update
                                    }}>
                                        Iniciar Procesamiento
                                    </Button>
                                ) : batch.status === 'processing' ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                                        <p className="text-slate-600 font-medium">Procesando... esto puede tomar unos minutos.</p>
                                    </div>
                                ) : batch.status === 'waiting_review' ? (
                                    <div className="flex flex-col items-center gap-2 p-4 bg-amber-50 rounded-lg border border-amber-200">
                                        <div className="h-10 w-10 text-amber-500 mb-2">
                                            ⚠️
                                        </div>
                                        <h3 className="font-semibold text-amber-800">Procesamiento Pausado</h3>
                                        <p className="text-amber-700 text-center max-w-md">
                                            Se detectó una diferencia entre la unidad del lote y el archivo DXF.
                                            Por favor, revisa la sección de "Unidad Detectada" arriba y elige "Rectificar" o "Continuar" para reanudar.
                                        </p>
                                    </div>
                                ) : batch.status === 'ready' ? (
                                    <div className="text-center py-6">
                                        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                                            <svg className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                        <p className="text-lg font-semibold text-green-600">✓ Procesamiento Completado</p>
                                        <p className="text-sm text-slate-500 mt-1">Los datos están listos para revisión</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                                        <p className="text-slate-600 font-medium">Procesando... esto puede tomar unos minutos.</p>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2 mt-6">
                                <h4 className="font-semibold text-sm">Progreso por Archivo</h4>
                                <div className="bg-slate-50 rounded border divide-y">
                                    {files.map(f => (
                                        <div key={f.id} className="p-3 flex justify-between items-center text-sm">
                                            <div className="flex items-center gap-2">
                                                <span>{f.originalName}</span>
                                                {f.status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
                                                {f.status === 'error' && <span className="text-red-500 text-xs">({f.errorMessage})</span>}
                                            </div>
                                            <span className={`px-2 py-0.5 text-xs rounded-full uppercase
                                                ${f.status === 'extracted' ? 'bg-green-100 text-green-700' :
                                                    f.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                                                        f.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'}`}>
                                                {f.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-end pt-0">
                            <Button variant="outline" onClick={() => fetchBatchData()}>Recargar Estado</Button>
                            {/* Only show "Go to Review" if no unit mismatch AND batch is ready */}
                            {batch.status === 'ready' && !mismatchFile && (
                                <Button className="ml-2" onClick={() => setActiveTab('staging')}>Ir a Revisión</Button>
                            )}
                            {/* Show warning if unit mismatch blocks review */}
                            {batch.status === 'ready' && mismatchFile && (
                                <div className="ml-2 text-sm text-amber-600 font-medium">
                                    ⚠️ Resuelve la inconsistencia de unidades primero
                                </div>
                            )}
                        </CardFooter>
                    </Card>
                </TabsContent>

                <TabsContent value="staging">
                    {batch.status !== 'ready' ? (
                        <div className="text-center py-20 text-slate-500">
                            El lote aún no está listo para revisión. Completa el procesamiento primero.
                            <br />
                            <Button variant="link" onClick={() => setActiveTab('process')}>Ir a Procesamiento</Button>
                        </div>
                    ) : loading ? (
                        // UX: Granular loading skeleton
                        <Card>
                            <CardHeader>
                                <div className="h-6 w-48 bg-slate-200 rounded animate-pulse"></div>
                                <div className="h-4 w-96 bg-slate-100 rounded animate-pulse mt-2"></div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <div key={i} className="h-16 bg-slate-50 rounded animate-pulse"></div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle>Área de Revisión (Staging)</CardTitle>
                                    <CardDescription>Revisa los cruces automáticos, edita cantidades y aprueba partidas.</CardDescription>
                                </div>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="gap-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                                onClick={async () => {
                                                    if (!confirm("¿Iniciar cotización automática de materiales? Esto puede tomar unos minutos.")) return;
                                                    setLoading(true);
                                                    try {
                                                        const res = await fetch(`/api/batches/${batchId}/pricing`, { method: 'POST' });
                                                        const json = await res.json();

                                                        if (json.failed && json.failed.length > 0) {
                                                            alert(`${json.message}\n\n⚠️ Items sin referencia de mercado encontrada:\n${json.failed.map((f: any) => `- ${f.item}: No se encontró referencia`).join('\n')}`);
                                                        } else {
                                                            alert(json.message);
                                                        }
                                                        await fetchBatchData();
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert("Error al cotizar");
                                                    } finally {
                                                        setLoading(false);
                                                    }
                                                }}
                                            >
                                                <DollarSign className="h-4 w-4" />
                                                Cotizar Materiales (IA)
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Busca precios automáticamente usando IA</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </CardHeader>
                            <CardContent>
                                {/* UX: Advanced Filtering */}
                                <div className="mb-4 space-y-3">
                                    <Input
                                        placeholder="🔍 Buscar por descripción..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="max-w-md"
                                    />
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            variant={stagingFilter === 'all' ? 'default' : 'outline'}
                                            onClick={() => setStagingFilter('all')}
                                        >
                                            Todos ({stagingRows.length})
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={stagingFilter === 'pending' ? 'default' : 'outline'}
                                            onClick={() => setStagingFilter('pending')}
                                            className="border-yellow-200 text-yellow-700 hover:bg-yellow-50"
                                        >
                                            Pendientes ({stagingRows.filter(r => r.status === 'pending').length})
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={stagingFilter === 'approved' ? 'default' : 'outline'}
                                            onClick={() => setStagingFilter('approved')}
                                            className="border-green-200 text-green-700 hover:bg-green-50"
                                        >
                                            Aprobados ({stagingRows.filter(r => r.status === 'approved').length})
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant={stagingFilter === 'low-confidence' ? 'default' : 'outline'}
                                            onClick={() => setStagingFilter('low-confidence')}
                                            className="border-red-200 text-red-700 hover:bg-red-50"
                                        >
                                            Baja Confianza ({stagingRows.filter(r => (r.match_confidence ?? 0) < 0.4).length})
                                        </Button>
                                    </div>
                                </div>

                                <StagingTable
                                    data={stagingRows
                                        .filter(row => {
                                            // Filter by status
                                            if (stagingFilter === 'pending' && row.status !== 'pending') return false;
                                            if (stagingFilter === 'approved' && row.status !== 'approved') return false;
                                            if (stagingFilter === 'low-confidence' && (row.match_confidence ?? 1) >= 0.4) return false;

                                            // Filter by search term
                                            if (searchTerm && !row.excel_item_text.toLowerCase().includes(searchTerm.toLowerCase())) {
                                                return false;
                                            }

                                            return true;
                                        })
                                    }
                                    onUpdateRow={async (id, updates) => {
                                        // Specific Optimistic Update
                                        setStagingRows(current =>
                                            current.map(row => row.id === id ? { ...row, ...updates } : row)
                                        );
                                        // API Update
                                        await fetch('/api/staging/update', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id, updates })
                                        });
                                    }}
                                />
                            </CardContent>
                            <CardFooter className="flex justify-end border-t pt-4">
                                <Button className="bg-green-600 hover:bg-green-700" onClick={() => setActiveTab('output')}>
                                    Finalizar y Generar Entregables
                                </Button>
                            </CardFooter>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="output">
                    {batch.status !== 'ready' && batch.status !== 'completed' ? (
                        <div className="text-center py-20 text-slate-500">
                            El lote debe estar procesado antes de generar entregables.
                            <br />
                            <Button variant="link" onClick={() => setActiveTab('process')}>Ir a Procesamiento</Button>
                        </div>
                    ) : (
                        <Card>
                            <CardHeader>
                                <CardTitle>Entregables</CardTitle>
                                <CardDescription>Descarga los archivos finales generados o exporta datos para revisión.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Diagnostic JSON - Always available when ready or completed */}
                                {(batch.status === 'ready' || batch.status === 'completed') && (
                                    <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                                        <h4 className="font-semibold text-blue-900 mb-2">📊 Exportar para Revisión</h4>
                                        <p className="text-sm text-blue-700 mb-3">
                                            Descarga un JSON con todos los detalles de matching para análisis externo.
                                        </p>
                                        <Button
                                            variant="outline"
                                            className="w-full justify-start gap-2 border-blue-300"
                                            onClick={() => {
                                                window.open(`/api/batches/${batchId}/diagnostic`, '_blank');
                                            }}
                                        >
                                            <Download className="h-4 w-4" />
                                            Descargar Diagnóstico JSON
                                        </Button>
                                    </div>
                                )}

                                {/* Generated files - Only when completed */}
                                {batch.status === 'completed' ? (
                                    <div className="bg-green-50 border border-green-200 rounded-md p-4">
                                        <h4 className="font-semibold text-green-900 mb-2">✓ Archivos Generados</h4>
                                        <div className="space-y-2">

                                            <Button
                                                variant="outline"
                                                className="w-full justify-start gap-2"
                                                onClick={async () => {
                                                    try {
                                                        // 1. List files to find the exact name (wildcards in createSignedUrl don't work)
                                                        const { data: files, error: listError } = await supabase.storage
                                                            .from('yago-output')
                                                            .list(batchId);

                                                        if (listError) throw listError;

                                                        const excelFile = files?.find(f => f.name.startsWith('YAGO_') && f.name.endsWith('.xlsx'));

                                                        if (!excelFile) {
                                                            alert("No se encontró el archivo Excel generado. Por favor intenta regenerar los archivos.");
                                                            return;
                                                        }

                                                        const { data, error: signError } = await supabase.storage
                                                            .from('yago-output')
                                                            .createSignedUrl(`${batchId}/${excelFile.name}`, 3600);

                                                        if (signError) throw signError;
                                                        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                                                    } catch (err: any) {
                                                        console.error("Error downloading Excel:", err);
                                                        alert(`Error al descargar Excel: ${err.message || 'Error desconocido'}`);
                                                    }
                                                }}
                                            >
                                                <Download className="h-4 w-4" />
                                                Descargar Excel Procesado
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="w-full justify-start gap-2"
                                                onClick={async () => {
                                                    try {
                                                        const { data, error } = await supabase.storage
                                                            .from('yago-output')
                                                            .createSignedUrl(`${batchId}/Heatmap_Report.pdf`, 3600);

                                                        if (error) throw error;
                                                        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                                                        else alert("No se pudo generar el enlace de descarga para el PDF.");
                                                    } catch (err: any) {
                                                        console.error("Error downloading PDF:", err);
                                                        alert(`Error al descargar PDF: (Posiblemente no se generó aún). ${err.message || ''}`);
                                                    }
                                                }}
                                            >
                                                <Download className="h-4 w-4" />
                                                Descargar Reporte PDF
                                            </Button>
                                        </div>
                                    </div>
                                ) : batch.status === 'ready' ? (
                                    <div className="text-center py-10">
                                        <p className="text-slate-600 mb-4">
                                            Una vez revisado todo en la pestaña de Staging, genera los archivos finales.
                                        </p>
                                        <Button size="lg" className="gap-2" disabled={loading} onClick={async () => {
                                            // UX: Confirmation before generating
                                            if (!confirm('¿Generar archivos finales? Esta acción creará el Excel y PDF con los datos actuales.')) {
                                                return;
                                            }

                                            setLoading(true);
                                            try {
                                                const res = await fetch(`/api/batches/${batchId}/generate`, { method: 'POST' });
                                                if (res.ok) {
                                                    const processLoop = async () => {
                                                        let keepingAlive = true;
                                                        while (keepingAlive) {
                                                            const res = await fetch('/api/worker/run', { method: 'POST' });
                                                            if (!res.ok) keepingAlive = false;
                                                            const json = await res.json();
                                                            if (json.message === "No jobs pending") keepingAlive = false;
                                                            await new Promise(r => setTimeout(r, 1000));
                                                            await fetchBatchData();
                                                        }
                                                    };
                                                    await processLoop();
                                                    alert('✅ Archivos generados exitosamente. Descárgalos arriba.');
                                                } else {
                                                    const error = await res.text();
                                                    alert(`Error al generar archivos: ${error || 'Error desconocido'}`);
                                                }
                                            } catch (e) {
                                                console.error(e);
                                                alert("Error al generar archivos. Por favor intenta nuevamente.");
                                            } finally {
                                                setLoading(false);
                                            }
                                        }}>
                                            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                                            Generar Excel & PDF
                                        </Button>
                                    </div>
                                ) : null}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>
        </div >
    );
}
