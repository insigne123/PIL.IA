"use client";

import React, { useRef, useState } from 'react';
import { UploadCloud, FileType, CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface FileUploaderProps {
    onFilesSelected: (files: File[]) => void;
    accept?: string;
    maxSizeMB?: number;
}

export function FileUploader({ onFilesSelected, accept = ".dwg,.dxf,.xlsx,.xlsm,.csv", maxSizeMB = 50 }: FileUploaderProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            // Optional: Validate types here if needed beyond 'accept'
            onFilesSelected(files);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            onFilesSelected(files);
        }
    };

    return (
        <Card
            className={cn(
                "border-2 border-dashed p-8 text-center transition-colors cursor-pointer flex flex-col items-center justify-center gap-4 bg-slate-50",
                isDragOver ? "border-primary bg-primary/5" : "border-slate-300 hover:border-slate-400"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
        >
            <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept={accept}
                onChange={handleChange}
            />
            <div className="bg-white p-3 rounded-full shadow-sm">
                <UploadCloud className="h-8 w-8 text-slate-500" />
            </div>
            <div>
                <h3 className="text-lg font-semibold text-slate-800">Sube tus archivos aquí</h3>
                <p className="text-sm text-slate-500 mt-1">
                    Arrastra y suelta DXF, DWG o Excel, o haz clic para explorar.
                </p>
            </div>
            <div className="text-xs text-slate-400">
                Máximo {maxSizeMB}MB por archivo
            </div>
        </Card>
    );
}
