/**
 * Review Dashboard Component
 * 
 * P2.2: Main dashboard for reviewing pending staging items
 * Shows statistics, filters, and list of items needing review
 */

'use client';

import { useState, useMemo } from 'react';
import { StagingRow } from '@/types';
import { ReviewCard } from './ReviewCard';
import { ReviewStats } from './ReviewStats';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface ReviewDashboardProps {
    items: StagingRow[];
    batchId: string;
    onItemUpdated?: () => void;
}

type FilterType = 'all' | 'pending' | 'low_confidence' | 'zero_qty' | 'type_mismatch';
type SortType = 'confidence' | 'row_index' | 'qty';

export function ReviewDashboard({ items, batchId, onItemUpdated }: ReviewDashboardProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('pending');
    const [sortBy, setSortBy] = useState<SortType>('confidence');

    // Filter items
    const filteredItems = useMemo(() => {
        let filtered = items;

        // Apply type filter
        if (filterType === 'pending') {
            filtered = filtered.filter(i => i.status === 'pending');
        } else if (filterType === 'low_confidence') {
            filtered = filtered.filter(i => i.match_confidence && i.match_confidence < 0.5);
        } else if (filterType === 'zero_qty') {
            filtered = filtered.filter(i => i.qty_final === 0 && i.source_items && i.source_items.length > 0);
        } else if (filterType === 'type_mismatch') {
            filtered = filtered.filter(i => i.hard_reject_reasons && i.hard_reject_reasons.length > 0);
        }

        // Apply search
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(i =>
                i.excel_item_text.toLowerCase().includes(term) ||
                i.source_items?.[0]?.layer_normalized.toLowerCase().includes(term)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            if (sortBy === 'confidence') {
                return (a.match_confidence || 0) - (b.match_confidence || 0);
            } else if (sortBy === 'row_index') {
                return a.excel_row_index - b.excel_row_index;
            } else if (sortBy === 'qty') {
                return (a.qty_final || 0) - (b.qty_final || 0);
            }
            return 0;
        });

        return filtered;
    }, [items, filterType, searchTerm, sortBy]);

    const pendingCount = items.filter(i => i.status === 'pending').length;
    const approvedCount = items.filter(i => i.status === 'approved').length;

    return (
        <div className="space-y-6">
            {/* Statistics */}
            <ReviewStats items={items} />

            {/* Filters and Search */}
            <Card className="p-4">
                <div className="flex flex-col md:flex-row gap-4">
                    {/* Search */}
                    <div className="flex-1">
                        <Input
                            placeholder="Search items or layers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full"
                        />
                    </div>

                    {/* Filter */}
                    <Select value={filterType} onValueChange={(v) => setFilterType(v as FilterType)}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Items ({items.length})</SelectItem>
                            <SelectItem value="pending">Pending ({pendingCount})</SelectItem>
                            <SelectItem value="low_confidence">Low Confidence</SelectItem>
                            <SelectItem value="zero_qty">Zero Quantity</SelectItem>
                            <SelectItem value="type_mismatch">Type Mismatch</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* Sort */}
                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortType)}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="confidence">By Confidence</SelectItem>
                            <SelectItem value="row_index">By Row Number</SelectItem>
                            <SelectItem value="qty">By Quantity</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Results count */}
                <div className="mt-3 text-sm text-muted-foreground">
                    Showing {filteredItems.length} of {items.length} items
                    {searchTerm && ` matching "${searchTerm}"`}
                </div>
            </Card>

            {/* Items List */}
            <div className="space-y-4">
                {filteredItems.length === 0 ? (
                    <Card className="p-8 text-center text-muted-foreground">
                        <p className="text-lg">No items to review</p>
                        <p className="text-sm mt-2">
                            {pendingCount === 0
                                ? '🎉 All items have been processed!'
                                : 'Try adjusting your filters or search term'}
                        </p>
                    </Card>
                ) : (
                    filteredItems.map((item) => (
                        <ReviewCard
                            key={item.id}
                            item={item}
                            batchId={batchId}
                            onUpdated={onItemUpdated}
                        />
                    ))
                )}
            </div>

            {/* Summary Footer */}
            {filteredItems.length > 0 && (
                <Card className="p-4 bg-muted/50">
                    <div className="flex items-center justify-between text-sm">
                        <div>
                            <Badge variant="outline" className="mr-2">
                                {approvedCount} Approved
                            </Badge>
                            <Badge variant="secondary">
                                {pendingCount} Pending
                            </Badge>
                        </div>
                        <div className="text-muted-foreground">
                            {Math.round((approvedCount / items.length) * 100)}% Complete
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
