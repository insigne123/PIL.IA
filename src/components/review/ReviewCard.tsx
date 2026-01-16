/**
 * Review Card Component
 * 
 * P2.2: Individual card for reviewing a staging item
 * Shows current match, alternatives, quality issues, and actions
 */

'use client';

import { useState } from 'react';
import { StagingRow } from '@/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { CandidateCard } from './CandidateCard';
import { AlertCircle, CheckCircle, XCircle, Edit } from 'lucide-react';

interface ReviewCardProps {
    item: StagingRow;
    batchId: string;
    onUpdated?: () => void;
}

export function ReviewCard({ item, batchId, onUpdated }: ReviewCardProps) {
    const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleApprove = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/staging/${item.id}/approve`, {
                method: 'POST'
            });

            if (response.ok) {
                onUpdated?.();
            }
        } catch (error) {
            console.error('Error approving item:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectAlternative = async () => {
        if (!selectedCandidate) return;

        setIsLoading(true);
        try {
            const response = await fetch(`/api/staging/${item.id}/select-alternative`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ layerName: selectedCandidate })
            });

            if (response.ok) {
                onUpdated?.();
            }
        } catch (error) {
            console.error('Error selecting alternative:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleMarkManual = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/staging/${item.id}/manual`, {
                method: 'POST'
            });

            if (response.ok) {
                onUpdated?.();
            }
        } catch (error) {
            console.error('Error marking as manual:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleIgnore = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/staging/${item.id}/ignore`, {
                method: 'POST'
            });

            if (response.ok) {
                onUpdated?.();
            }
        } catch (error) {
            console.error('Error ignoring item:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const confidenceColor = (conf?: number) => {
        if (!conf) return 'secondary';
        if (conf > 0.7) return 'default';  // Changed from 'success'
        if (conf > 0.4) return 'outline';   // Changed from 'warning'
        return 'destructive';
    };

    return (
        <Card className="p-6">
            {/* Header: Excel Item Info */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm text-muted-foreground">Row {item.excel_row_index}</span>
                        <Badge variant="outline">{item.excel_unit}</Badge>
                        {item.expected_measure_type && (
                            <Badge variant="secondary">{item.expected_measure_type}</Badge>
                        )}
                        {item.excel_subtype && (
                            <Badge variant="outline" className="text-xs">
                                {item.excel_subtype}
                            </Badge>
                        )}
                    </div>
                    <h3 className="text-lg font-semibold">{item.excel_item_text}</h3>
                </div>

                <Badge variant={item.status === 'approved' ? 'default' : 'secondary'}>
                    {item.status}
                </Badge>
            </div>

            {/* Current Match */}
            <div className="mb-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Current Match
                </h4>
                {item.source_items?.[0] ? (
                    <div className="bg-muted/50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">{item.source_items[0].layer_normalized}</div>
                                <div className="text-sm text-muted-foreground mt-1">
                                    Type: {item.source_items[0].type} | Qty: {item.qty_final?.toFixed(2) || 0}
                                </div>
                            </div>
                            {item.match_confidence !== undefined && (
                                <Badge variant={confidenceColor(item.match_confidence)}>
                                    {(item.match_confidence * 100).toFixed(0)}%
                                </Badge>
                            )}
                        </div>
                        {item.match_reason && (
                            <p className="text-sm text-muted-foreground mt-2">{item.match_reason}</p>
                        )}
                    </div>
                ) : (
                    <p className="text-muted-foreground text-sm">No match found</p>
                )}
            </div>

            {/* Alternative Candidates */}
            {item.top_candidates && item.top_candidates.length > 0 && (
                <div className="mb-4">
                    <h4 className="text-sm font-medium mb-2">Alternative Candidates</h4>
                    <div className="space-y-2">
                        {item.top_candidates.slice(0, 5).map((candidate) => (
                            <CandidateCard
                                key={candidate.layer}
                                candidate={{
                                    ...candidate,
                                    type: candidate.layer, // Fallback for type
                                    score: candidate.score_semantic, // Map property
                                    rejected: false
                                }}
                                selected={selectedCandidate === candidate.layer}
                                onSelect={() => setSelectedCandidate(candidate.layer)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Quality Issues / Warnings */}
            {(item.warnings && item.warnings.length > 0) && (
                <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Quality Issues</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc list-inside space-y-1 mt-2">
                            {item.warnings.map((warning, i) => (
                                <li key={i} className="text-sm">{warning}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            {/* Suggestions */}
            {item.suggestions && item.suggestions.length > 0 && (
                <Alert className="mb-4">
                    <AlertTitle>Suggestions</AlertTitle>
                    <AlertDescription>
                        <ul className="list-disc list-inside space-y-1 mt-2">
                            {item.suggestions.map((suggestion) => (
                                <li key={suggestion.id} className="text-sm">{suggestion.label}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t">
                <Button
                    onClick={handleApprove}
                    disabled={isLoading}
                    variant="default"
                    size="sm"
                >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve Current
                </Button>

                {selectedCandidate && (
                    <Button
                        onClick={handleSelectAlternative}
                        disabled={isLoading}
                        variant="secondary"
                        size="sm"
                    >
                        Use {selectedCandidate}
                    </Button>
                )}

                <Button
                    onClick={handleMarkManual}
                    disabled={isLoading}
                    variant="outline"
                    size="sm"
                >
                    <Edit className="h-4 w-4 mr-2" />
                    Manual Entry
                </Button>

                <Button
                    onClick={handleIgnore}
                    disabled={isLoading}
                    variant="ghost"
                    size="sm"
                >
                    <XCircle className="h-4 w-4 mr-2" />
                    Ignore
                </Button>
            </div>
        </Card>
    );
}
