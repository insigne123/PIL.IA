"use client";

import React, { useState, useEffect } from 'react';
import { logger, LogEntry, LogLevel } from '@/lib/logger';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Trash2, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function LogViewer() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filter, setFilter] = useState<LogLevel | 'all'>('all');

    const refreshLogs = () => {
        const allLogs = [...logger.getLogs(), ...logger.getStoredLogs()];
        // Remove duplicates by timestamp
        const uniqueLogs = allLogs.filter((log, index, self) =>
            index === self.findIndex((l) => l.timestamp === log.timestamp)
        );
        setLogs(uniqueLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    };

    useEffect(() => {
        refreshLogs();
        const interval = setInterval(refreshLogs, 2000);
        return () => clearInterval(interval);
    }, []);

    const filteredLogs = filter === 'all' ? logs : logs.filter(log => log.level === filter);

    const getLevelBadge = (level: LogLevel) => {
        const variants = {
            debug: 'bg-cyan-100 text-cyan-800',
            info: 'bg-green-100 text-green-800',
            warn: 'bg-yellow-100 text-yellow-800',
            error: 'bg-red-100 text-red-800'
        };
        return <Badge className={variants[level]}>{level.toUpperCase()}</Badge>;
    };

    const counts = {
        all: logs.length,
        debug: logs.filter(l => l.level === 'debug').length,
        info: logs.filter(l => l.level === 'info').length,
        warn: logs.filter(l => l.level === 'warn').length,
        error: logs.filter(l => l.level === 'error').length
    };

    return (
        <Card className="w-full">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>📋 System Logs</CardTitle>
                        <CardDescription>Real-time application logging for debugging</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={refreshLogs}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => logger.exportLogs()}>
                            <Download className="h-4 w-4 mr-2" />
                            Export
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => { logger.clear(); refreshLogs(); }}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Clear
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as LogLevel | 'all')}>
                    <TabsList className="mb-4">
                        <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                        <TabsTrigger value="debug">Debug ({counts.debug})</TabsTrigger>
                        <TabsTrigger value="info">Info ({counts.info})</TabsTrigger>
                        <TabsTrigger value="warn">Warn ({counts.warn})</TabsTrigger>
                        <TabsTrigger value="error">Error ({counts.error})</TabsTrigger>
                    </TabsList>

                    <div className="max-h-[600px] overflow-y-auto space-y-2 bg-slate-50 p-4 rounded-md">
                        {filteredLogs.length === 0 ? (
                            <p className="text-slate-400 text-center py-8">No logs to display</p>
                        ) : (
                            filteredLogs.map((log, idx) => (
                                <div key={idx} className="bg-white p-3 rounded border border-slate-200 text-sm">
                                    <div className="flex items-start justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            {getLevelBadge(log.level)}
                                            <span className="font-semibold">{log.message}</span>
                                        </div>
                                        <span className="text-xs text-slate-500">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    {log.context && (
                                        <pre className="text-xs bg-slate-100 p-2 rounded mt-2 overflow-x-auto">
                                            {JSON.stringify(log.context, null, 2)}
                                        </pre>
                                    )}
                                    {log.stack && (
                                        <pre className="text-xs bg-red-50 p-2 rounded mt-2 overflow-x-auto text-red-800">
                                            {log.stack}
                                        </pre>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </Tabs>
            </CardContent>
        </Card>
    );
}
