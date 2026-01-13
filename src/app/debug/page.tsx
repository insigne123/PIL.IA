"use client";

import { LogViewer } from '@/components/debug/LogViewer';

export default function DebugPage() {
    return (
        <div className="container mx-auto py-8">
            <h1 className="text-3xl font-bold mb-6">🔧 Debug Console</h1>
            <LogViewer />
        </div>
    );
}
