import { SupabaseClient } from '@supabase/supabase-js';
import { parseDxf } from '../src/lib/processing/dxf';
import { parseExcel } from '../src/lib/processing/excel';
import { matchItems } from '../src/lib/processing/matcher';
import { ItemDetectado, StagingRow } from '../src/types';
import { writeExcel } from '../src/lib/processing/writer';
import { generateHeatmapPdf } from '../src/lib/pdf-heatmap';

export async function executeJob(supabase: SupabaseClient, job: any) {
    // 1. Fetch File Info
    const { data: file, error } = await supabase
        .from('batch_files')
        .select('*')
        .eq('id', job.batch_file_id)
        .single();

    if (error || !file) throw new Error("File not found");

    if (job.phase === 'CONVERT') {
        // Mock Conversion for MVP
        if (file.file_type === 'dwg') {
            await supabase.from('batch_files').update({
                status: 'error',
                error_message: "Conversión DWG a DXF no soportada en MVP sin ODA"
            }).eq('id', file.id);
            throw new Error("Generic DWG conversion failed");
        }
    }

    if (job.phase === 'EXTRACT') {
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('yago-source')
            .download(file.storage_path);

        if (downloadError || !fileData) throw new Error("Download failed");

        const buffer = await fileData.arrayBuffer();
        let extractedItems: any = null;
        let detectedUnitVal: any = null; // Scoped variable for update

        if (file.file_type === 'dxf') {
            const text = await new Response(fileData).text();

            // Get Batch Unit Preference
            const { data: batchData } = await supabase.from('batches').select('unit_selected').eq('id', file.batch_id).single();
            const planUnit = (batchData?.unit_selected as any) || 'm';

            const { items, detectedUnit } = await parseDxf(text, planUnit);
            detectedUnitVal = detectedUnit;

            if (detectedUnit && detectedUnit !== planUnit) {
                console.warn(`[Unit Mismatch] Batch says '${planUnit}' but DXF header says '${detectedUnit}'. Using '${planUnit}'.`);
                // Optional: We could update the batch here if we wanted fully automatic mode
            }

            extractedItems = items;
        } else if (file.file_type === 'excel') {
            const result = await parseExcel(buffer);
            extractedItems = result.items;

            // Save Excel Map structure
            await supabase.from('excel_maps').insert({
                batch_id: file.batch_id,
                sheet_name: result.structure.sheetName,
                header_row: result.structure.headerRow,
                col_desc: result.structure.columns.description,
                col_unit: result.structure.columns.unit,
                col_qty: result.structure.columns.qty,
                col_price: result.structure.columns.price,
                detected_by: 'auto'
            });
        }

        // Save JSON to Storage
        const jsonPath = `${file.batch_id}/${file.id}.json`;
        await supabase.storage
            .from('yago-processing')
            .upload(jsonPath, JSON.stringify(extractedItems), { upsert: true });

        // Update Batch File
        await supabase.from('batch_files').update({
            status: 'extracted',
            // @ts-ignore: Assuming column exists in updated migration
            storage_json_path: jsonPath,
            detected_unit: detectedUnitVal
        }).eq('id', file.id);

        // Check Trigger
        await checkAndTriggerMatching(supabase, file.batch_id);
    }

    if (job.phase === 'MAP') {
        await executeMapping(supabase, job.batch_id);
    }

    if (job.phase === 'GENERATE') {
        await executeGeneration(supabase, job.batch_id, job.batch_file_id);
    }
}

async function executeGeneration(supabase: SupabaseClient, batchId: string, excelFileId: string) {
    // 1. Get Staging Rows
    const { data: rows, error: rowsError } = await supabase.from('staging_rows').select('*').eq('batch_id', batchId);

    if (rowsError) {
        console.error("Error fetching staging rows:", rowsError);
        throw new Error(`Database error: ${rowsError.message}`);
    }

    if (!rows || rows.length === 0) {
        throw new Error("No staging rows found. Please complete the processing phase first (batch status should be 'ready').");
    }

    // 2. Get Excel Structure
    const { data: map } = await supabase.from('excel_maps').select('*').eq('batch_id', batchId).single();
    if (!map) throw new Error("Excel Map not found");

    const structure = {
        sheetName: map.sheet_name,
        headerRow: map.header_row,
        columns: {
            description: map.col_desc,
            unit: map.col_unit,
            qty: map.col_qty,
            price: map.col_price
        }
    };

    // 3. Get Original File
    const { data: file } = await supabase.from('batch_files').select('*').eq('id', excelFileId).single();
    if (!file) throw new Error("Excel file not found");

    const { data: fileData, error: downloadError } = await supabase.storage
        .from('yago-source')
        .download(file.storage_path);

    if (downloadError || !fileData) throw new Error("Download failed");
    const originalBuffer = await fileData.arrayBuffer();

    // 4. Write Excel
    const modifiedBuffer = await writeExcel(originalBuffer, rows as StagingRow[], structure);

    // 5. Upload Output (Excel)
    const outputPath = `${batchId}/YAGO_${file.original_filename}`;
    const { error: uploadError } = await supabase.storage
        .from('yago-output')
        .upload(outputPath, modifiedBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true });

    if (uploadError) throw new Error("Upload output failed: " + uploadError.message);

    // 5.1 Generate and Upload PDF
    const pdfBuffer = await generateHeatmapPdf(rows as StagingRow[], `Batch ${batchId}`);
    const pdfPath = `${batchId}/Heatmap_Report.pdf`;
    await supabase.storage
        .from('yago-output')
        .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    // 6. Record Output
    await supabase.from('outputs').insert({
        batch_id: batchId,
        excel_path: outputPath,
        pdf_path: pdfPath
    });

    // 7. Complete Batch
    await supabase.from('batches').update({ status: 'completed' }).eq('id', batchId);
}

async function checkAndTriggerMatching(supabase: SupabaseClient, batchId: string) {
    const { data: files } = await supabase
        .from('batch_files')
        .select('status')
        .eq('batch_id', batchId);

    if (!files) return;
    const allExtracted = files.every(f => f.status === 'extracted');

    if (allExtracted) {
        console.log(`All files for batch ${batchId} extracted. Starting matching...`);
        await executeMapping(supabase, batchId);
    }
}

async function executeMapping(supabase: SupabaseClient, batchId: string) {
    // 0. Get Batch Info
    const { data: batch } = await supabase.from('batches').select('*').eq('id', batchId).single();
    if (!batch) return;

    // 1. Get all extracted JSONs
    const { data: files } = await supabase.from('batch_files').select('*').eq('batch_id', batchId);
    if (!files) return;

    let excelItems: any[] = [];
    let dxfItems: ItemDetectado[] = [];

    // Load Data
    for (const f of files) {
        if (!f.storage_json_path) continue;
        const { data } = await supabase.storage.from('yago-processing').download(f.storage_json_path);
        if (!data) continue;
        const json = JSON.parse(await data.text());

        if (f.file_type === 'excel') {
            excelItems = json;
        } else {
            // Ensure json is an array before spreading
            if (Array.isArray(json)) {
                dxfItems = [...dxfItems, ...json];
            } else {
                console.warn(`DXF file ${f.id} returned non-array data, skipping`);
            }
        }
    }

    if (excelItems.length === 0) {
        console.warn("No Excel items found");
        return;
    }

    const sheetTarget = batch.sheet_target || 'Presupuesto';

    // 4. Match Items (Hybrid: Fuzzy + AI)
    let stagingRows = matchItems(excelItems, dxfItems, sheetTarget);

    // AI ENHANCEMENT:
    // Filter rows with low confidence to refine with AI
    // We process them in parallel batches to speed up
    if (process.env.GOOGLE_GENAI_API_KEY) {
        const { matchItemFlow } = await import('@/ai/match-items');

        // Prepare Rich Candidates (Name + Type)
        // Deduplicate by layer name but keep type info 
        // (If layer has both blocks and lines, we prefer block if it has more items? or keep both?)
        // Simplification: One entry per layer, prioritizing 'block' if mixed.
        const candidateMap = new Map<string, { name: string, type: string, sample_value: number }>();
        dxfItems.forEach(i => {
            if (!candidateMap.has(i.layer_normalized)) {
                candidateMap.set(i.layer_normalized, { name: i.layer_normalized, type: i.type, sample_value: i.value_m });
            }
        });
        const candidatePayload = Array.from(candidateMap.values());

        const lowConfidenceRows = stagingRows.filter(r => (r as any).match_confidence < 0.6);

        console.log(`AI Refining ${lowConfidenceRows.length} items with Dimensional Analysis...`);

        // Simple batch processing
        for (const row of lowConfidenceRows) {
            try {
                const aiResult = await matchItemFlow({
                    item_description: row.excel_item_text,
                    item_unit: row.excel_unit,
                    candidate_layers: candidatePayload
                });

                if (aiResult.selected_layer && aiResult.confidence > 0.5) {
                    // Find the items belonging to this layer
                    const betterMatches = dxfItems.filter(i => i.layer_normalized === aiResult.selected_layer);
                    if (betterMatches.length > 0) {
                        (row as any).matched_items = betterMatches;
                        (row as any).match_confidence = aiResult.confidence;
                        (row as any).match_reason = "AI: " + aiResult.reasoning;
                        (row as any).status = aiResult.confidence > 0.8 ? 'approved' : 'pending';

                        // Recalculate Qty
                        let qty = 0;
                        betterMatches.forEach(m => qty += m.value_m);
                        row.qty_final = qty;
                    }
                }
            } catch (err) {
                console.error("AI Match Error for", row.excel_item_text, err);
            }
        }
    }

    // 5. Insert into Staging
    const dbRows = stagingRows.map(row => ({
        id: row.id,
        batch_id: batchId,
        excel_sheet: row.excel_sheet,
        excel_row_index: row.excel_row_index,
        excel_item_text: row.excel_item_text,
        excel_unit: row.excel_unit,
        source_items: (row as any).matched_items,
        qty_final: row.qty_final,
        height_factor: row.height_factor || 1.0,
        price_selected: row.price_selected,
        price_candidates: row.price_candidates,
        confidence: (row as any).match_confidence > 0.8 ? 'high' : ((row as any).match_confidence > 0.4 ? 'medium' : 'low'),
        match_reason: (row as any).match_reason || null,
        status: (row as any).status || 'pending'
    }));

    const { error } = await supabase.from('staging_rows').insert(dbRows);
    if (error) {
        console.error("Error inserting staging rows", error);
    } else {
        await supabase.from('batches').update({ status: 'ready' }).eq('id', batchId);
    }
}
