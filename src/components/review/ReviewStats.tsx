/**
 * Review Stats Component
 * 
 * P2.2: Shows statistics for the review dashboard
 */

'use client';

import { StagingRow } from '@/types';
import { Card } from '@/components/ui/card';
import { CheckCircle, AlertCircle, XCircle, Clock } from 'lucide-react';

interface ReviewStatsProps {
    items: StagingRow[];
}

export function ReviewStats({ items }: ReviewStatsProps) {
    const approved = items.filter(i => (i.status as string) === 'approved').length;
    const pending = items.filter(i => (i.status as string).startsWith('pending')).length;
    const ignored = items.filter(i => (i.status as string) === 'ignored' || (i.status as string) === 'rejected').length;
    const lowConfidence = items.filter(i => i.match_confidence && i.match_confidence < 0.5).length;

    const stats = [
        {
            label: 'Approved',
            value: approved,
            icon: CheckCircle,
            color: 'text-green-600',
            bgColor: 'bg-green-50'
        },
        {
            label: 'Pending Review',
            value: pending,
            icon: Clock,
            color: 'text-yellow-600',
            bgColor: 'bg-yellow-50'
        },
        {
            label: 'Low Confidence',
            value: lowConfidence,
            icon: AlertCircle,
            color: 'text-orange-600',
            bgColor: 'bg-orange-50'
        },
        {
            label: 'Ignored',
            value: ignored,
            icon: XCircle,
            color: 'text-gray-600',
            bgColor: 'bg-gray-50'
        }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                    <Card key={stat.label} className="p-4">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                                <Icon className={`h-5 w-5 ${stat.color}`} />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stat.value}</p>
                                <p className="text-sm text-muted-foreground">{stat.label}</p>
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}
