"use client";

import React, { useState } from 'react';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, X, AlertTriangle, ChevronDown } from 'lucide-react';
import { StagingRow } from '@/types';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface StagingTableProps {
    data: StagingRow[];
    onUpdateRow: (id: string, updates: Partial<StagingRow>) => void;
}

export function StagingTable({ data, onUpdateRow }: StagingTableProps) {
    const [filter, setFilter] = useState<'all' | 'pending' | 'approved'>('all');

    const filteredData = data.filter(r => filter === 'all' || r.status === filter);

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')} size="sm">
                    Todos ({data.length})
                </Button>
                <Button variant={filter === 'pending' ? 'default' : 'outline'} onClick={() => setFilter('pending')} size="sm" className="text-yellow-600 border-yellow-200 bg-yellow-50 hover:bg-yellow-100">
                    Pendientes ({data.filter(d => d.status === 'pending').length})
                </Button>
                <Button variant={filter === 'approved' ? 'default' : 'outline'} onClick={() => setFilter('approved')} size="sm" className="text-green-600 border-green-200 bg-green-50 hover:bg-green-100">
                    Aprobados ({data.filter(d => d.status === 'approved').length})
                </Button>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">Status</TableHead>
                            <TableHead className="w-[300px]">Item Excel</TableHead>
                            <TableHead className="w-[250px]">Match CAD</TableHead>
                            <TableHead className="w-[250px]">Razonamiento IA</TableHead>
                            <TableHead className="w-[100px]">Cant. Final</TableHead>
                            <TableHead className="w-[80px]">Unidad</TableHead>
                            <TableHead className="w-[120px]">Precio Unit.</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredData.map((row) => (
                            <TableRow key={row.id} className={cn(
                                row.status === 'approved' ? "bg-green-50/50" : "",
                                row.match_confidence < 0.3 ? "bg-red-50/50" : ""
                            )}>
                                <TableCell>
                                    {row.status === 'approved' ? (
                                        <Check className="text-green-600 h-5 w-5" />
                                    ) : row.match_confidence < 0.4 ? (
                                        <AlertTriangle className="text-red-500 h-5 w-5" />
                                    ) : (
                                        <div className="h-2 w-2 rounded-full bg-yellow-400" />
                                    )}
                                </TableCell>
                                <TableCell className="font-medium text-xs">
                                    {row.excel_item_text}
                                </TableCell>
                                <TableCell className="text-xs">
                                    {row.source_items && row.source_items.length > 0 ? (
                                        <div className="flex flex-col">
                                            <span className="font-bold">{row.source_items[0].name_raw || row.source_items[0].layer_raw}</span>
                                            <span className="text-slate-500">{row.source_items[0].type} ({row.source_items[0].unit_raw})</span>
                                        </div>
                                    ) : (
                                        <span className="text-slate-400 italic">Sin match automático</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600 italic">
                                    {row.match_reason ? row.match_reason : '-'}
                                </TableCell>
                                <TableCell>
                                    <Input
                                        type="number"
                                        value={row.qty_final}
                                        onChange={(e) => onUpdateRow(row.id, { qty_final: parseFloat(e.target.value) || 0 })}
                                        className="h-8 w-24"
                                    />
                                </TableCell>
                                <TableCell>
                                    <Input
                                        value={row.excel_unit}
                                        onChange={(e) => onUpdateRow(row.id, { excel_unit: e.target.value })}
                                        className="h-8 w-16"
                                    />
                                </TableCell>
                                <TableCell>
                                    <Input
                                        type="number"
                                        placeholder="0.00"
                                        value={row.price_selected || ''}
                                        onChange={(e) => onUpdateRow(row.id, { price_selected: parseFloat(e.target.value) || 0 })}
                                        className="h-8 w-24"
                                    />
                                </TableCell>
                                <TableCell className="text-right">
                                    {row.status !== 'approved' && (
                                        <Button size="sm" variant="ghost" onClick={() => onUpdateRow(row.id, { status: 'approved' })}>
                                            <Check className="h-4 w-4 text-green-600" />
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
