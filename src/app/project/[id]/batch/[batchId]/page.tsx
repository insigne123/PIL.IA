"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Batch, BatchFile } from '@/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, Download } from 'lucide-react';
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
                errorMessage: f.error_message
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

            const path = `${batchId}/${file.name}`;

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
        <div className="container mx-auto py-6 px-4">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" onClick={() => router.push(`/project/${projectId}`)}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Volver
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">{batch.name}</h1>
                    <div className="flex gap-4 text-sm text-slate-500">
                        <span>Uni: {batch.unitSelected}</span>
                        <span>Alt: {batch.heightDefault}m</span>
                        <span>Sheet: {batch.sheetTarget}</span>
                    </div>
                </div>
                <div className="ml-auto">
                    <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-sm font-medium uppercase">
                        {batch.status}
                    </span>
                </div>
            </div>

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
                                                const res = await fetch('/api/worker/run', { method: 'POST' });
                                                if (!res.ok) {
                                                    // Error or 404
                                                    console.warn("Worker stop/error");
                                                    keepingAlive = false;
                                                }
                                                const json = await res.json();
                                                if (json.message === "No jobs pending") {
                                                    keepingAlive = false;
                                                }
                                                // Wait 1s between tasks
                                                await new Promise(r => setTimeout(r, 1000));
                                                fetchBatchData(); // Refresh UI
                                            }
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
                                                ${f.status === 'done' ? 'bg-green-100 text-green-700' :
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
                                        // DB Update
                                        await supabase.from('staging_rows').update(updates).eq('id', id);
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
                    <Card>
                        <CardHeader>
                            <CardTitle>Entregables</CardTitle>
                            <CardDescription>Descarga los archivos finales generados.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center py-10 gap-4">
                            <p className="text-slate-600 mb-4">
                                Una vez revisado todo, genera el Excel final respetando el formato del cliente.
                            </p>
                            <div className="flex gap-4">
                                <Button size="lg" className="gap-2" onClick={async () => {
                                    // Call Generate API
                                    const res = await fetch(`/api/batches/${batchId}/generate`, { method: 'POST' });
                                    if (res.ok) {
                                        alert("Generación iniciada (Simulada MVP). Procesando...");
                                        // Trigger Worker Loop
                                        const processLoop = async () => {
                                            let keepingAlive = true;
                                            while (keepingAlive) {
                                                const res = await fetch('/api/worker/run', { method: 'POST' });
                                                if (!res.ok) keepingAlive = false;
                                                const json = await res.json();
                                                if (json.message === "No jobs pending") keepingAlive = false;
                                                // Wait 1s between tasks
                                                await new Promise(r => setTimeout(r, 1000));
                                                fetchBatchData();
                                            }
                                        };
                                        await processLoop();
                                        window.location.reload(); // Quick refresh to see links
                                    }
                                    else alert("Error al generar");
                                }}>
                                    <Download className="h-5 w-5" /> Generar Excel & PDF
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
