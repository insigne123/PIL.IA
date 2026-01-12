// Versioning service for batch snapshots and comparisons

import { supabase } from '@/lib/supabase';
import type { StagingRow } from '@/types';

export interface BatchVersion {
    id: string;
    batchId: string;
    versionNumber: number;
    snapshot: StagingRow[];
    changesSummary?: string;
    createdBy: string;
    createdAt: string;
}

export interface VersionDiff {
    added: StagingRow[];
    removed: StagingRow[];
    modified: Array<{
        before: StagingRow;
        after: StagingRow;
        changes: string[];
    }>;
    summary: {
        totalChanges: number;
        priceImpact: number;
        qtyImpact: number;
    };
}

export class VersioningService {
    private supabase = supabase;

    /**
     * Create a new version snapshot of the current batch state
     * @param batchId - UUID of the batch to snapshot
     * @param summary - Description of what changed in this version
     * @returns Promise resolving to the created BatchVersion
     * @throws Error if snapshot creation fails
     * @example
     * ```ts
     * const version = await versioningService.createSnapshot(
     *   'batch-uuid',
     *   'Before applying automatic pricing'
     * );
     * ```
     */
    async createSnapshot(
        batchId: string,
        summary: string
    ): Promise<BatchVersion> {
        const user = await this.supabase.auth.getUser();
        const userId = user.data.user?.id || 'unknown';

        const { data, error } = await this.supabase.rpc('create_batch_snapshot', {
            p_batch_id: batchId,
            p_summary: summary,
            p_user_id: userId,
        });

        if (error) {
            console.error('Failed to create snapshot:', error);
            throw error;
        }

        // Fetch the created version
        return this.getVersion(data);
    }

    /**
     * List all versions for a batch
     */
    async listVersions(batchId: string): Promise<BatchVersion[]> {
        const { data, error } = await this.supabase
            .from('batch_versions')
            .select('*')
            .eq('batch_id', batchId)
            .order('version_number', { ascending: false });

        if (error) {
            console.error('Failed to list versions:', error);
            return [];
        }

        return data as BatchVersion[];
    }

    /**
     * Get a specific version
     */
    async getVersion(versionId: string): Promise<BatchVersion> {
        const { data, error } = await this.supabase
            .from('batch_versions')
            .select('*')
            .eq('id', versionId)
            .single();

        if (error) {
            console.error('Failed to get version:', error);
            throw error;
        }

        return data as BatchVersion;
    }

    /**
     * Compare two batch versions and compute differences
     * @param versionFromId - UUID of the "from" version (older)
     * @param versionToId - UUID of the "to" version (newer)
     * @returns Promise resolving to VersionDiff with added/removed/modified items
     * @throws Error if versions don't exist
     * @example
     * ```ts
     * const diff = await versioningService.compareVersions(
     *   'version-1-uuid',
     *   'version-2-uuid'
     * );
     * console.log(`${diff.summary.totalChanges} changes`);
     * console.log(`Price impact: $${diff.summary.priceImpact}`);
     * ```
     */
    async compareVersions(
        versionFromId: string,
        versionToId: string
    ): Promise<VersionDiff> {
        // Check if comparison is cached
        const cached = await this.getCachedComparison(versionFromId, versionToId);
        if (cached) {
            return cached;
        }

        // Fetch both versions
        const [versionFrom, versionTo] = await Promise.all([
            this.getVersion(versionFromId),
            this.getVersion(versionToId),
        ]);

        // Compute diff
        const diff = this.computeDiff(versionFrom.snapshot, versionTo.snapshot);

        // Cache the comparison
        await this.cacheComparison(versionFromId, versionToId, diff);

        return diff;
    }

    /**
     * Restore a batch to a previous version
     */
    async restoreVersion(versionId: string): Promise<void> {
        const user = await this.supabase.auth.getUser();
        const userId = user.data.user?.id || 'unknown';

        const { error } = await this.supabase.rpc('restore_batch_version', {
            p_version_id: versionId,
            p_user_id: userId,
        });

        if (error) {
            console.error('Failed to restore version:', error);
            throw error;
        }
    }

    /**
     * Delete a version
     */
    async deleteVersion(versionId: string): Promise<void> {
        const { error } = await this.supabase
            .from('batch_versions')
            .delete()
            .eq('id', versionId);

        if (error) {
            console.error('Failed to delete version:', error);
            throw error;
        }
    }

    /**
     * Compute diff between two snapshots
     */
    private computeDiff(
        snapshotFrom: StagingRow[],
        snapshotTo: StagingRow[]
    ): VersionDiff {
        const fromMap = new Map(snapshotFrom.map((row) => [row.id, row]));
        const toMap = new Map(snapshotTo.map((row) => [row.id, row]));

        const added: StagingRow[] = [];
        const removed: StagingRow[] = [];
        const modified: Array<{
            before: StagingRow;
            after: StagingRow;
            changes: string[];
        }> = [];

        // Find added and modified
        for (const [id, rowTo] of toMap.entries()) {
            const rowFrom = fromMap.get(id);
            if (!rowFrom) {
                added.push(rowTo);
            } else {
                const changes = this.detectChanges(rowFrom, rowTo);
                if (changes.length > 0) {
                    modified.push({
                        before: rowFrom,
                        after: rowTo,
                        changes,
                    });
                }
            }
        }

        // Find removed
        for (const [id, rowFrom] of fromMap.entries()) {
            if (!toMap.has(id)) {
                removed.push(rowFrom);
            }
        }

        // Calculate impacts
        const priceImpact = this.calculatePriceImpact(modified, added, removed);
        const qtyImpact = this.calculateQtyImpact(modified, added, removed);

        return {
            added,
            removed,
            modified,
            summary: {
                totalChanges: added.length + removed.length + modified.length,
                priceImpact,
                qtyImpact,
            },
        };
    }

    /**
     * Detect changes between two rows
     */
    private detectChanges(before: StagingRow, after: StagingRow): string[] {
        const changes: string[] = [];

        if (before.qty_final !== after.qty_final) {
            changes.push(
                `Cantidad: ${before.qty_final} → ${after.qty_final}`
            );
        }

        if (before.unit_price_ref !== after.unit_price_ref) {
            changes.push(
                `Precio unitario: ${before.unit_price_ref || 'N/A'} → ${after.unit_price_ref || 'N/A'}`
            );
        }

        if (before.status !== after.status) {
            changes.push(`Estado: ${before.status} → ${after.status}`);
        }

        if (before.height_factor !== after.height_factor) {
            changes.push(
                `Factor altura: ${before.height_factor || 'N/A'} → ${after.height_factor || 'N/A'}`
            );
        }

        return changes;
    }

    /**
     * Calculate total price impact
     */
    private calculatePriceImpact(
        modified: VersionDiff['modified'],
        added: StagingRow[],
        removed: StagingRow[]
    ): number {
        let impact = 0;

        // Modified items
        for (const item of modified) {
            const priceBefore = (item.before.unit_price_ref || 0) * item.before.qty_final;
            const priceAfter = (item.after.unit_price_ref || 0) * item.after.qty_final;
            impact += priceAfter - priceBefore;
        }

        // Added items
        for (const item of added) {
            impact += (item.unit_price_ref || 0) * item.qty_final;
        }

        // Removed items
        for (const item of removed) {
            impact -= (item.unit_price_ref || 0) * item.qty_final;
        }

        return impact;
    }

    /**
     * Calculate total quantity impact
     */
    private calculateQtyImpact(
        modified: VersionDiff['modified'],
        added: StagingRow[],
        removed: StagingRow[]
    ): number {
        let impact = 0;

        for (const item of modified) {
            impact += item.after.qty_final - item.before.qty_final;
        }

        for (const item of added) {
            impact += item.qty_final;
        }

        for (const item of removed) {
            impact -= item.qty_final;
        }

        return impact;
    }

    /**
     * Get cached comparison
     */
    private async getCachedComparison(
        versionFromId: string,
        versionToId: string
    ): Promise<VersionDiff | null> {
        const { data, error } = await this.supabase
            .from('version_comparisons')
            .select('*')
            .eq('version_from', versionFromId)
            .eq('version_to', versionToId)
            .single();

        if (error || !data) {
            return null;
        }

        return data.diff_details as VersionDiff;
    }

    /**
     * Cache a comparison
     */
    private async cacheComparison(
        versionFromId: string,
        versionToId: string,
        diff: VersionDiff
    ): Promise<void> {
        const { error } = await this.supabase.from('version_comparisons').insert({
            version_from: versionFromId,
            version_to: versionToId,
            items_added: diff.added.length,
            items_removed: diff.removed.length,
            items_modified: diff.modified.length,
            total_price_change: diff.summary.priceImpact,
            total_qty_change: diff.summary.qtyImpact,
            diff_details: diff,
        });

        if (error) {
            console.error('Failed to cache comparison:', error);
        }
    }
}

export const versioningService = new VersioningService();
