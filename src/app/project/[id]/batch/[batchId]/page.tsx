"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Batch, BatchFile } from '@/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, Download, AlertTriangle } from 'lucide-react';
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
    const [activeTab, setActiveTab] = useState("upload");

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
            const { data: rows } = await supabase
                .from('staging_rows')
                .select('*')
                .eq('batch_id', batchId)
                .order('excel_row_index', { ascending: true });

            if (rows) {
                // Map DB snake_case to CamelCase TS Interface if needed, or update interface
                // Our Interface keys: excel_item_text... same as DB.
                // source_items is jsonb, matches ItemDetectado[]
                // price_candidates is jsonb, matches PriceSource[]
                setStagingRows(rows as unknown as StagingRow[]);
            }
        }

        setLoading(false);
    }, [batchId]);

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

        // Optimistic UI updates could be added here, but sticking to loading states for simplicity

        for (const file of selectedFiles) {
            const ext = file.name.split('.').pop()?.toLowerCase();
            let type: 'excel' | 'dxf' | 'dwg' = 'dxf';
            if (ext === 'xlsx' || ext === 'xlsm') type = 'excel';
            else if (ext === 'dwg') type = 'dwg';
            else if (ext !== 'dxf') {
                console.warn("Skipping unsupported file", file.name);
                continue;
            }


            // Sanitize filename: remove spaces and special characters
            const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `${batchId}/${sanitizedName}`;


            // 1. Upload to Storage
            const { error: uploadError } = await supabase.storage
                .from('yago-source')
                .upload(path, file, { upsert: true });

            if (uploadError) {
                console.error("Upload error", uploadError);
                // Optionally show toast
                continue;
            }

            // 2. Register in DB
            const { error: dbError } = await supabase.from('batch_files').insert({
                batch_id: batchId,
                original_filename: file.name,
                file_type: type,
                size_bytes: file.size,
                status: 'uploaded',
                storage_path: path
            });

            if (dbError) {
                console.error("DB Insert error", dbError);
            }
        }

        // Refresh list
        fetchBatchData();
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

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
                                    <Button size="lg" onClick={async () => {
                                        setLoading(true);
                                        // 1. Mark batch as processing (queues jobs)
                                        await fetch(`/api/batches/${batchId}/start`, { method: 'POST' });

                                        // 2. Trigger Worker Loop in Frontend
                                        // This ensures we keep hitting the endpoint until done
                                        const processLoop = async () => {
                                            let keepingAlive = true;
                                            while (keepingAlive) {
                                                try {
                                                    const res = await fetch('/api/worker/run', { method: 'POST' });

                                                    if (!res.ok) {
                                                        console.error("Worker API error:", res.status);
                                                        keepingAlive = false;
                                                        break;
                                                    }

                                                    const json = await res.json();

                                                    if (json.message === "No jobs pending") {
                                                        console.log("All jobs completed");
                                                        keepingAlive = false;
                                                        break;
                                                    }

                                                    if (!json.success) {
                                                        console.error("Job failed:", json.error);
                                                        keepingAlive = false;
                                                        break;
                                                    }

                                                    console.log("Job completed:", json.phase);

                                                } catch (err) {
                                                    console.error("Worker loop error:", err);
                                                    keepingAlive = false;
                                                    break;
                                                }

                                                // Wait 1s between tasks
                                                await new Promise(r => setTimeout(r, 1000));
                                                await fetchBatchData(); // Refresh UI
                                            }

                                            // Processing complete - redirect to staging
                                            await fetchBatchData(); // Final refresh
                                            if (batch.status === 'ready') {
                                                setActiveTab('staging');
                                                alert('✅ Procesamiento completado. Los datos están listos para revisión en la pestaña Staging.');
                                            }
                                            setLoading(false);
                                        };

                                        processLoop(); // Fire and forget loop
                                        fetchBatchData();
                                        setLoading(false);
                                    }}>
                                        Iniciar Procesamiento
                                    </Button>
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
                            {batch.status === 'ready' && (
                                <Button className="ml-2" onClick={() => setActiveTab('staging')}>Ir a Revisión</Button>
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
                    ) : (
                        <Card>
                            <CardHeader>
                                <CardTitle>Área de Revisión (Staging)</CardTitle>
                                <CardDescription>Revisa los cruces automáticos, edita cantidades y aprueba partidas.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <StagingTable
                                    data={stagingRows}
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
                                {batch.status === 'completed' ? (
                                    <div className="space-y-4">
                                        <div className="bg-green-50 border border-green-200 rounded-md p-4">
                                            <h4 className="font-semibold text-green-900 mb-2">✓ Archivos Generados</h4>
                                            <div className="space-y-2">
                                                <Button
                                                    variant="outline"
                                                    className="w-full justify-start gap-2"
                                                    onClick={async () => {
                                                        const { data } = await supabase.storage
                                                            .from('yago-output')
                                                            .createSignedUrl(`${batchId}/YAGO_*.xlsx`, 3600);
                                                        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                                                    }}
                                                >
                                                    <Download className="h-4 w-4" />
                                                    Descargar Excel Procesado
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    className="w-full justify-start gap-2"
                                                    onClick={async () => {
                                                        const { data } = await supabase.storage
                                                            .from('yago-output')
                                                            .createSignedUrl(`${batchId}/Heatmap_Report.pdf`, 3600);
                                                        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                                                    }}
                                                >
                                                    <Download className="h-4 w-4" />
                                                    Descargar Reporte PDF
                                                </Button>
                                            </div>
                                        </div>

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
                                    </div>
                                ) : (
                                    <div className="text-center py-10">
                                        <p className="text-slate-600 mb-4">
                                            Una vez revisado todo en la pestaña de Staging, genera los archivos finales.
                                        </p>
                                        <Button size="lg" className="gap-2" onClick={async () => {
                                            const res = await fetch(`/api/batches/${batchId}/generate`, { method: 'POST' });
                                            if (res.ok) {
                                                alert("Generación iniciada. Procesando...");
                                                const processLoop = async () => {
                                                    let keepingAlive = true;
                                                    while (keepingAlive) {
                                                        const res = await fetch('/api/worker/run', { method: 'POST' });
                                                        if (!res.ok) keepingAlive = false;
                                                        const json = await res.json();
                                                        if (json.message === "No jobs pending") keepingAlive = false;
                                                        await new Promise(r => setTimeout(r, 1000));
                                                        fetchBatchData();
                                                    }
                                                };
                                                await processLoop();
                                                window.location.reload();
                                            }
                                            else alert("Error al generar");
                                        }}>
                                            <Download className="h-5 w-5" /> Generar Excel & PDF
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>
        </div >
    );
}
