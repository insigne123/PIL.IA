"use client";

import React, { useState, useEffect } from 'react';
import { History, GitCompare, RotateCcw, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { versioningService, type BatchVersion, type VersionDiff } from '@/lib/services/versioning';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface VersionHistoryProps {
    batchId: string;
}

export function VersionHistory({ batchId }: VersionHistoryProps) {
    const [versions, setVersions] = useState<BatchVersion[]>([]);
    const [loading, setLoading] = useState(true);
    const [compareLoading, setCompareLoading] = useState(false);
    const [compareDialog, setCompareDialog] = useState(false);
    const [selectedVersions, setSelectedVersions] = useState<[string?, string?]>([]);
    const [diff, setDiff] = useState<VersionDiff | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadVersions();
    }, [batchId]);

    const loadVersions = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await versioningService.listVersions(batchId);
            setVersions(data);
        } catch (err) {
            console.error('Failed to load versions:', err);
            setError('Error al cargar historial de versiones');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSnapshot = async () => {
        try {
            setError(null);
            await versioningService.createSnapshot(batchId, 'Snapshot manual');
            await loadVersions();
        } catch (err) {
            console.error('Failed to create snapshot:', err);
            setError('Error al crear snapshot');
        }
    };

    const handleCompare = async () => {
        if (selectedVersions[0] && selectedVersions[1]) {
            try {
                setCompareLoading(true);
                setError(null);
                const result = await versioningService.compareVersions(
                    selectedVersions[0],
                    selectedVersions[1]
                );
                setDiff(result);
                setCompareDialog(true);
            } catch (err) {
                console.error('Failed to compare versions:', err);
                setError('Error al comparar versiones. Intenta nuevamente.');
            } finally {
                setCompareLoading(false);
            }
        }
    };

    const handleRestore = async (versionId: string) => {
        if (confirm('¿Estás seguro de restaurar esta versión? Se creará un backup automático.')) {
            try {
                setError(null);
                await versioningService.restoreVersion(versionId);
                await loadVersions();
            } catch (err) {
                console.error('Failed to restore version:', err);
                setError('Error al restaurar versión. Verifica los permisos.');
            }
        }
    };

    const handleDelete = async (versionId: string) => {
        if (confirm('¿Estás seguro de eliminar esta versión?')) {
            try {
                setError(null);
                await versioningService.deleteVersion(versionId);
                await loadVersions();
            } catch (err) {
                console.error('Failed to delete version:', err);
                setError('Error al eliminar versión');
            }
        }
    };

    const toggleVersionSelection = (versionId: string) => {
        if (selectedVersions[0] === versionId) {
            setSelectedVersions([selectedVersions[1], undefined]);
        } else if (selectedVersions[1] === versionId) {
            setSelectedVersions([selectedVersions[0], undefined]);
        } else if (!selectedVersions[0]) {
            setSelectedVersions([versionId, selectedVersions[1]]);
        } else if (!selectedVersions[1]) {
            setSelectedVersions([selectedVersions[0], versionId]);
        } else {
            setSelectedVersions([versionId, selectedVersions[1]]);
        }
    };

    if (loading) {
        return <div className="text-center py-8">Cargando historial...</div>;
    }

    return (
        <div className="space-y-4">
            {/* Error Alert */}
            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    <h3 className="text-lg font-semibold">Historial de Versiones</h3>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCompare}
                        disabled={selectedVersions.filter(Boolean).length !== 2 || compareLoading}
                    >
                        <GitCompare className="h-4 w-4 mr-2" />
                        {compareLoading ? 'Comparando...' : 'Comparar'}
                    </Button>
                    <Button size="sm" onClick={handleCreateSnapshot}>
                        Crear Snapshot
                    </Button>
                </div>
            </div>

            {/* Versions List */}
            <div className="space-y-2">
                {versions.length === 0 && (
                    <Alert>
                        <AlertDescription>
                            No hay versiones guardadas. Se crean automáticamente al exportar o puedes crear snapshots manuales.
                        </AlertDescription>
                    </Alert>
                )}

                {versions.map((version) => (
                    <Card
                        key={version.id}
                        className={`cursor-pointer transition-colors ${selectedVersions.includes(version.id) ? 'border-blue-500 bg-blue-50' : ''
                            }`}
                        onClick={() => toggleVersionSelection(version.id)}
                    >
                        <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        Versión {version.versionNumber}
                                        {version.versionNumber === versions[0]?.versionNumber && (
                                            <Badge variant="default">Actual</Badge>
                                        )}
                                    </CardTitle>
                                    <CardDescription className="mt-1">
                                        {version.changesSummary || 'Sin descripción'}
                                    </CardDescription>
                                </div>
                                <div className="flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRestore(version.id);
                                        }}
                                        disabled={version.versionNumber === versions[0]?.versionNumber}
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(version.id);
                                        }}
                                        disabled={version.versionNumber === versions[0]?.versionNumber}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between text-sm text-slate-600">
                                <span>
                                    {formatDistanceToNow(new Date(version.createdAt), {
                                        addSuffix: true,
                                        locale: es,
                                    })}
                                </span>
                                <span>{version.snapshot.length} ítems</span>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Comparison Dialog */}
            <Dialog open={compareDialog} onOpenChange={setCompareDialog}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Comparación de Versiones</DialogTitle>
                        <DialogDescription>
                            Diferencias entre las versiones seleccionadas
                        </DialogDescription>
                    </DialogHeader>

                    {diff && (
                        <div className="space-y-4">
                            {/* Summary */}
                            <div className="grid grid-cols-3 gap-4">
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Total Cambios</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-2xl font-bold">{diff.summary.totalChanges}</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Impacto Precio</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className={`text-2xl font-bold ${diff.summary.priceImpact >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {diff.summary.priceImpact >= 0 ? '+' : ''}
                                            ${diff.summary.priceImpact.toLocaleString('es-CL')}
                                        </p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Impacto Cantidad</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className={`text-2xl font-bold ${diff.summary.qtyImpact >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {diff.summary.qtyImpact >= 0 ? '+' : ''}
                                            {diff.summary.qtyImpact.toFixed(2)}
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Changes Details */}
                            <div className="space-y-3">
                                {diff.added.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold text-green-600 mb-2">
                                            Ítems Agregados ({diff.added.length})
                                        </h4>
                                        <div className="space-y-1">
                                            {diff.added.map((item) => (
                                                <div key={item.id} className="text-sm bg-green-50 p-2 rounded">
                                                    {item.excel_item_text}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {diff.removed.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold text-red-600 mb-2">
                                            Ítems Eliminados ({diff.removed.length})
                                        </h4>
                                        <div className="space-y-1">
                                            {diff.removed.map((item) => (
                                                <div key={item.id} className="text-sm bg-red-50 p-2 rounded">
                                                    {item.excel_item_text}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {diff.modified.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold text-blue-600 mb-2">
                                            Ítems Modificados ({diff.modified.length})
                                        </h4>
                                        <div className="space-y-2">
                                            {diff.modified.map((item, idx) => (
                                                <div key={idx} className="text-sm bg-blue-50 p-2 rounded">
                                                    <p className="font-medium">{item.after.excel_item_text}</p>
                                                    <ul className="list-disc list-inside text-xs text-slate-600 mt-1">
                                                        {item.changes.map((change, i) => (
                                                            <li key={i}>{change}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCompareDialog(false)}>
                            Cerrar
                        </Button>
                        <Button>
                            <Download className="h-4 w-4 mr-2" />
                            Exportar Diff
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
