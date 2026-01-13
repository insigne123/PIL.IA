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
    return (
        <div className="space-y-4">
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
                            <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.map((row) => (
                            <TableRow key={row.id} className={cn(
                                "transition-all duration-300", // UX: Smooth transitions
                                row.status === 'approved' ? "bg-green-50/50" : "",
                                (row.match_confidence ?? 0) < 0.3 ? "bg-red-50/50" : ""
                            )}>
                                <TableCell>
                                    {row.status === 'approved' ? (
                                        <Check className="text-green-600 h-5 w-5" />
                                    ) : (row.match_confidence ?? 0) < 0.4 ? (
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
                                <TableCell className="text-xs">
                                    {row.match_reason ? (
                                        <div className="group relative inline-block">
                                            <div className="text-blue-500 cursor-help border-b border-dotted border-blue-500 text-[11px]">
                                                Ver explicación
                                            </div>
                                            <div className="absolute z-10 invisible group-hover:visible bg-slate-800 text-white text-[11px] p-2 rounded shadow-lg w-64 -left-2 top-5">
                                                {row.match_reason}
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-slate-400">-</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Input
                                        type="number"
                                        value={row.qty_final ?? ''}
                                        onChange={(e) => onUpdateRow(row.id, { qty_final: parseFloat(e.target.value) || 0 })}
                                        className="h-8 w-24"
                                    />
                                </TableCell>
                                <TableCell className="text-xs">{row.unit_final || row.excel_unit}</TableCell>
                                {/* PRICING COLUMNS */}
                                <TableCell>
                                    <div className="flex items-center gap-1">
                                        <span className={cn("text-sm whitespace-nowrap", !row.unit_price_ref && "text-slate-400 italic")}>
                                            {row.unit_price_ref
                                                ? new Intl.NumberFormat('es-CL', {
                                                    style: 'currency',
                                                    currency: 'CLP',
                                                    minimumFractionDigits: 0,
                                                    maximumFractionDigits: 0
                                                }).format(row.unit_price_ref)
                                                : "N/A"
                                            }
                                        </span>
                                        {row.price_sources && row.price_sources.length > 0 && (
                                            <div className="group relative inline-block ml-1">
                                                <div className="text-blue-500 cursor-help">
                                                    <AlertTriangle className="h-3 w-3 text-blue-500" />
                                                </div>
                                                <div className="absolute z-20 invisible group-hover:visible bg-white border border-slate-200 text-slate-800 text-xs p-3 rounded shadow-xl w-64 -left-32 top-6">
                                                    <h5 className="font-semibold mb-1">Fuentes de Precio:</h5>
                                                    <ul className="space-y-1">
                                                        {row.price_sources.map((s, idx) => (
                                                            <li key={idx} className="flex justify-between border-b pb-1 last:border-0">
                                                                <span className="text-slate-600 truncate max-w-[120px]" title={s.title}>{s.vendor}</span>
                                                                <span className="font-mono font-medium">${s.price.toLocaleString('es-CL')}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="font-semibold text-sm">
                                    {row.total_price_ref
                                        ? `$ ${row.total_price_ref.toLocaleString('es-CL')}`
                                        : "-"
                                    }
                                </TableCell>

                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        {row.status === 'pending' && (
                                            <>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:bg-green-50" onClick={() => onUpdateRow(row.id, { status: 'approved' })}>
                                                    <Check className="h-4 w-4" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600 hover:bg-red-50" onClick={() => onUpdateRow(row.id, { status: 'ignored' })}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </>
                                        )}
                                        {row.status !== 'pending' && (
                                            <Button size="sm" variant="ghost" onClick={() => onUpdateRow(row.id, { status: 'pending' })}>
                                                Editar
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
