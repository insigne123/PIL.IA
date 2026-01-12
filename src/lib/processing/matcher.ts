import Fuse from 'fuse.js';
import { ItemDetectado, StagingRow, Unit } from '@/types';
import { ExtractedExcelItem } from './excel';
import { v4 as uuidv4 } from 'uuid';

export function matchItems(excelItems: ExtractedExcelItem[], dxfItems: ItemDetectado[], sheetName: string): StagingRow[] {

    // Configure Fuse to search within CAD items
    // We want to find which CAD item matches the Excel Description
    const fuse = new Fuse(dxfItems, {
        keys: ['name_raw', 'layer_normalized'],
        includeScore: true,
        threshold: 0.6, // 0.0 is perfect, 0.6 is loose
        shouldSort: true,
        ignoreLocation: true
    });

    const rows: StagingRow[] = excelItems.map(excelItem => {
        const result = fuse.search(excelItem.description);

        let bestMatch: ItemDetectado[] = [];
        let confidence = 0;
        let reason = "No valid match found";

        if (result.length > 0) {
            const match = result[0];
            // Invert score to confidence (0 score -> 1 confidence)
            const score = match.score || 1;
            confidence = 1 - score;

            if (confidence > 0.4) {
                bestMatch = [match.item];
                reason = `Matched with "${match.item.name_raw || match.item.layer_raw}" (${(confidence * 100).toFixed(0)}%)`;
            }
        }

        // Calculate Qty
        let qtyFinal = 0;
        let heightFactor = undefined;

        if (bestMatch.length > 0) {
            const match = bestMatch[0];
            // Logic: 
            // If Excel unit is m2 and match is length, apply default height (handled in UI or here? Here default 1, UI applies factor)
            // But StagingRow has 'height_factor'.
            // If unit is matches (m vs m, un vs block), just take value.

            qtyFinal = match.value_m;

            if (excelItem.unit.toLowerCase().includes('m2') && match.type === 'length') {
                heightFactor = 2.4; // Default
                qtyFinal = match.value_m * heightFactor;
            }
        } else {
            // Keep existing Excel qty if present for "Manual" verification
            if (excelItem.qty !== null) qtyFinal = excelItem.qty;
        }

        return {
            id: uuidv4(),
            excel_sheet: sheetName,
            excel_row_index: excelItem.row,
            excel_item_text: excelItem.description,
            excel_unit: excelItem.unit,
            source_items: bestMatch,
            matched_items: bestMatch,
            // aggregation_rule: 'sum',
            match_confidence: confidence,
            confidence: confidence > 0.8 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
            match_reason: reason,
            qty_final: qtyFinal,
            height_factor: heightFactor,
            price_selected: excelItem.price || undefined,
            price_candidates: [], // TODO: Price Engine
            status: confidence > 0.8 ? 'approved' : 'pending' // Auto-approve high confidence? Maybe just 'pending' for MVP safety.
        };
    });

    return rows;
}
