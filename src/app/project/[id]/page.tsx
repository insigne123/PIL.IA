"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useProject } from '@/context/ProjectContext';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Plus, ArrowLeft, Layers, Calendar, ChevronRight } from 'lucide-react';
import { Batch } from '@/types';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ProjectPage() {
    const params = useParams();
    const id = params?.id as string;
    const { projects, selectProject, currentProject } = useProject();
    const router = useRouter();

    const [batches, setBatches] = useState<Batch[]>([]);
    const [loadingBatches, setLoadingBatches] = useState(false);

    // New Batch Form
    const [isNewBatchOpen, setIsNewBatchOpen] = useState(false);
    const [newBatchData, setNewBatchData] = useState({
        name: "",
        unit: "m",
        height: "2.40",
        sheetName: "Presupuesto"
    });

    useEffect(() => {
        if (id) selectProject(id);
    }, [id, selectProject]);

    const fetchBatches = useCallback(async () => {
        setLoadingBatches(true);
        const { data, error } = await supabase
            .from('batches')
            .select('*')
            .eq('project_id', id)
            .order('created_at', { ascending: false });

        if (!error && data) {
            setBatches(data.map(b => ({
                id: b.id,
                projectId: b.project_id,
                name: b.name,
                unitSelected: b.unit_selected as any,
                heightDefault: b.height_default,
                sheetTarget: b.sheet_target,
                status: b.status as any,
                createdAt: b.created_at
            })));
        }
        setLoadingBatches(false);
    }, [id]);

    useEffect(() => {
        if (id) fetchBatches();
    }, [id, fetchBatches]);

    const handleCreateBatch = async () => {
        if (!currentProject) return;
        const { data, error } = await supabase.from('batches').insert({
            project_id: currentProject.id,
            name: newBatchData.name,
            unit_selected: newBatchData.unit,
            height_default: parseFloat(newBatchData.height),
            sheet_target: newBatchData.sheetName,
            status: 'pending'
        }).select().single();

        if (error) {
            alert("Error creando lote");
            console.error(error);
        } else if (data) {
            router.push(`/project/${id}/batch/${data.id}`);
        }
    };

    if (!currentProject) {
        return <div className="p-10 text-center text-slate-500">Cargando proyecto...</div>;
    }

    return (
        <div className="container mx-auto py-6 px-4">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => router.push('/')}>
                        <ArrowLeft className="h-4 w-4 mr-2" /> Volver
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold">{currentProject.name}</h1>
                        <p className="text-slate-500">{currentProject.client}</p>
                    </div>
                </div>

                <Dialog open={isNewBatchOpen} onOpenChange={setIsNewBatchOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-blue-600 hover:bg-blue-700">
                            <Plus className="h-4 w-4 mr-2" /> Nuevo Lote
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Crear Lote de Procesamiento</DialogTitle>
                            <DialogDescription>
                                Un lote agrupa un set de planos (DXF) y un Excel de presupuesto.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label>Nombre del Lote</Label>
                                <Input
                                    placeholder="Ej: Torre A - Arquitectura"
                                    value={newBatchData.name}
                                    onChange={e => setNewBatchData({ ...newBatchData, name: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Unidad Planos</Label>
                                    <Select value={newBatchData.unit} onValueChange={v => setNewBatchData({ ...newBatchData, unit: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="mm">Milímetros (mm)</SelectItem>
                                            <SelectItem value="cm">Centímetros (cm)</SelectItem>
                                            <SelectItem value="m">Metros (m)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Altura (m) Default</Label>
                                    <Input
                                        type="number" step="0.05"
                                        value={newBatchData.height}
                                        onChange={e => setNewBatchData({ ...newBatchData, height: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label>Hoja Excel Objetivo</Label>
                                <Input
                                    value={newBatchData.sheetName}
                                    onChange={e => setNewBatchData({ ...newBatchData, sheetName: e.target.value })}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleCreateBatch} disabled={!newBatchData.name}>Crear e Ir</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid gap-6">
                {batches.length === 0 && !loadingBatches && (
                    <div className="text-center py-20 bg-slate-50 border-2 border-dashed rounded-xl text-slate-400">
                        Este proyecto no tiene lotes. Crea uno para comenzar.
                    </div>
                )}
                {batches.map(batch => (
                    <Card key={batch.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/project/${id}/batch/${batch.id}`)}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div className="flex items-center gap-4">
                                <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                                    <Layers className="h-6 w-6" />
                                </div>
                                <div>
                                    <CardTitle>{batch.name}</CardTitle>
                                    <CardDescription>
                                        Unidad: {batch.unitSelected} | Altura: {batch.heightDefault}m
                                    </CardDescription>
                                </div>
                            </div>
                            <div className={`text-xs font-semibold px-2 py-1 rounded-full uppercase
                                ${batch.status === 'ready' ? 'bg-green-100 text-green-700' :
                                    batch.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                                        batch.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                                {batch.status}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center text-xs text-slate-500 mt-2 gap-4">
                                <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {new Date(batch.createdAt).toLocaleDateString()}
                                </span>
                                <span>Hoja: {batch.sheetTarget}</span>
                            </div>
                        </CardContent>
                        <CardFooter className="pt-0 flex justify-end">
                            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-600">
                                Ver Detalle <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </div>
    );
}
