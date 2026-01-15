/**
 * Candidate Card Component
 * 
 * P2.2: Shows a single candidate layer option with geometry metrics
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle, XCircle } from 'lucide-react';

interface CandidateCardProps {
    candidate: {
        layer: string;
        type: string;
        score: number;
        rejected: boolean;
        reject_reason?: string;
        geometry?: {
            area?: number;
            length?: number;
            blocks?: number;
            hatches?: number;
            closed_polys?: number;
        };
        selected?: boolean;
    };
    selected: boolean;
    onSelect: () => void;
}

export function CandidateCard({ candidate, selected, onSelect }: CandidateCardProps) {
    return (
        <div
            className={cn(
                'border rounded-lg p-3 cursor-pointer transition-all',
                selected && 'border-primary bg-primary/5',
                candidate.rejected && 'opacity-60',
                !selected && !candidate.rejected && 'hover:border-primary/50'
            )}
            onClick={onSelect}
        >
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    {selected && <CheckCircle className="h-4 w-4 text-primary" />}
                    {candidate.rejected && <XCircle className="h-4 w-4 text-destructive" />}
                    <span className="font-medium text-sm">{candidate.layer}</span>
                </div>
                <Badge variant={candidate.rejected ? 'destructive' : 'default'} className="text-xs">
                    {(candidate.score * 100).toFixed(0)}%
                </Badge>
            </div>

            {candidate.geometry && (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {candidate.geometry.area && (
                        <span>{candidate.geometry.area.toFixed(2)} m²</span>
                    )}
                    {candidate.geometry.length && (
                        <span>{candidate.geometry.length.toFixed(2)} m</span>
                    )}
                    {candidate.geometry.blocks && (
                        <span>{candidate.geometry.blocks} blocks</span>
                    )}
                    {candidate.geometry.hatches && (
                        <span className="text-xs">({candidate.geometry.hatches} HATCHes)</span>
                    )}
                </div>
            )}

            {candidate.reject_reason && (
                <p className="text-xs text-destructive mt-2">{candidate.reject_reason}</p>
            )}
        </div>
    );
}
