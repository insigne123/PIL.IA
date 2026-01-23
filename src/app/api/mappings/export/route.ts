/**
 * API endpoint for exporting learned mappings
 * P2.2: Allows users to export their learned Excel→Layer mappings as JSON
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllUserMappings, getLearningStats } from '@/lib/processing/learning-system';

export async function GET(req: NextRequest) {
    try {
        const userId = req.nextUrl.searchParams.get('userId');
        const format = req.nextUrl.searchParams.get('format') || 'json';

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
        }

        // Get all mappings
        const mappings = await getAllUserMappings(userId);

        // Get stats
        const stats = await getLearningStats(userId);

        const exportData = {
            exportedAt: new Date().toISOString(),
            userId,
            stats: {
                totalMappings: stats.totalMappings,
                totalUsage: stats.totalUsage,
                topLayers: stats.topLayers,
                byDiscipline: stats.byDiscipline,
            },
            mappings: mappings.map(m => ({
                excelDescription: m.excel_description,
                excelUnit: m.excel_unit,
                dxfLayer: m.dxf_layer,
                dxfType: m.dxf_type,
                confidence: m.confidence,
                timesUsed: m.times_used,
                lastUsed: m.last_used_at,
                discipline: m.discipline,
            })),
        };

        if (format === 'csv') {
            // Convert to CSV
            const headers = ['Excel Description', 'Excel Unit', 'DXF Layer', 'DXF Type', 'Confidence', 'Times Used', 'Last Used', 'Discipline'];
            const rows = exportData.mappings.map(m => [
                `"${m.excelDescription.replace(/"/g, '""')}"`,
                m.excelUnit,
                m.dxfLayer,
                m.dxfType,
                m.confidence,
                m.timesUsed,
                m.lastUsed,
                m.discipline || '',
            ].join(','));

            const csv = [headers.join(','), ...rows].join('\n');

            return new NextResponse(csv, {
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="mappings_${userId}_${new Date().toISOString().split('T')[0]}.csv"`,
                },
            });
        }

        // Return JSON
        return NextResponse.json({
            success: true,
            data: exportData,
        });

    } catch (error: any) {
        console.error('[Export Mappings] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
