import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { parseDxf } from '../src/lib/processing/dxf';
import { parseExcel } from '../src/lib/processing/excel';
import { matchItems } from '../src/lib/processing/matcher';
import { ItemDetectado, StagingRow, Suggestion } from '../src/types';
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
            // Try to read with different encodings
            let text: string;
            let parseError: Error | null = null;

            try {
                // First attempt: UTF-8 (default)
                text = await new Response(fileData).text();

                // Get Batch Unit Preference
                const { data: batchData } = await supabase.from('batches').select('unit_selected').eq('id', file.batch_id).single();
                const planUnit = (batchData?.unit_selected as any) || 'm';

                const { items, detectedUnit } = await parseDxf(text, planUnit);
                detectedUnitVal = detectedUnit;

                if (detectedUnit && detectedUnit !== planUnit) {
                    console.warn(`[Unit Mismatch] Batch says '${planUnit}' but DXF header says '${detectedUnit}'. Using '${planUnit}'.`);
                }

                extractedItems = items;
            } catch (firstError: any) {
                parseError = firstError;
                console.warn('[DXF] UTF-8 parsing failed, trying Latin-1 encoding...', firstError.message);

                try {
                    // Second attempt: Latin-1 (Windows-1252)
                    const decoder = new TextDecoder('windows-1252');
                    text = decoder.decode(buffer);

                    const { data: batchData } = await supabase.from('batches').select('unit_selected').eq('id', file.batch_id).single();
                    const planUnit = (batchData?.unit_selected as any) || 'm';

                    const { items, detectedUnit } = await parseDxf(text, planUnit);
                    detectedUnitVal = detectedUnit;

                    if (detectedUnit && detectedUnit !== planUnit) {
                        console.warn(`[Unit Mismatch] Batch says '${planUnit}' but DXF header says '${detectedUnit}'. Using '${planUnit}'.`);
                    }

                    extractedItems = items;
                    console.log('[DXF] Successfully parsed with Latin-1 encoding');
                } catch (secondError: any) {
                    console.error('[DXF] Both UTF-8 and Latin-1 parsing failed');
                    throw new Error(`Error al procesar archivo DXF: ${parseError?.message || 'Unknown'}. El archivo puede estar corrupto o tener un formato incompatible.`);
                }
            }
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
        .select('*')
        .eq('batch_id', batchId);

    if (!files) return;
    const allExtracted = files.every(f => f.status === 'extracted');

    if (allExtracted) {
        // FAST VALIDATION: Check Units BEFORE starting slow Matching
        const { data: batch } = await supabase.from('batches').select('unit_selected, status').eq('id', batchId).single();
        const batchUnit = batch?.unit_selected;

        const mismatchFile = files.find(f => f.detected_unit && f.detected_unit !== 'unknown' && f.detected_unit !== batchUnit);

        if (mismatchFile) {
            console.warn(`[Pipeline] Unit Mismatch detected. Halting Matching. detected=${mismatchFile.detected_unit}, batch=${batchUnit}`);
            await supabase.from('batches').update({ status: 'waiting_review' }).eq('id', batchId);
            return;
        }

        // FIX: Atomic update to prevent race condition
        // Only trigger matching if batch is still in 'processing' state
        const { data: updatedBatch, error: updateError } = await supabase
            .from('batches')
            .update({ status: 'mapping' })
            .eq('id', batchId)
            .eq('status', 'processing') // Conditional: only if still processing
            .select()
            .single();

        if (updateError || !updatedBatch) {
            // Another worker already started mapping, or batch is in different state
            console.log(`[Pipeline] Batch ${batchId} already being mapped or in different state. Skipping.`);
            return;
        }

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

    // 4. PRE-CLASSIFICATION (Quick Win 3: Force "Punto" items to low confidence)
    // This ensures they go through AI refinement where the Block rule is applied
    excelItems.forEach((item: any) => {
        const desc = (item.description || '').toLowerCase();
        if ((desc.startsWith('punto ') || desc.startsWith('puntos ')) &&
            !desc.includes('canaliz') && !desc.includes('ducto') && !desc.includes('tuber')) {
            // Mark for AI refinement by forcing low initial confidence
            item._force_ai_refinement = true;
        }
    });

    // 4. Match Items (Hybrid: Fuzzy + AI)
    let stagingRows = matchItems(excelItems, dxfItems, sheetTarget);

    // POST-FUZZY PROCESSING: Apply all classification rules
    stagingRows = stagingRows.map((row: any) => {
        const desc = (row.excel_item_text || '').toLowerCase();

        // FIX 1: Auto-classify GLOBAL/SERVICE items (with proper normalization)
        const isServiceScope =
            desc.includes('instalacion') ||  // Normalized (no tilde)
            desc.includes('instalación') ||  // With tilde
            desc.includes('provision e instalacion') ||
            desc.includes('provisión e instalación') ||
            (desc.includes('certificado') && !desc.includes('rotulado')) ||
            desc.includes('tramite') ||
            desc.includes('trámite') ||
            desc.includes('legaliz');

        if (isServiceScope) {
            return {
                ...row,
                matched_items: [],
                source_items: [],
                match_confidence: 0.95,
                match_reason: "Logic: Item de Servicio/Alcance (No requiere dibujo)",
                status: 'approved',
                qty_final: 1
            };
        }

        // FIX 2: Pre-classify "Punto" items to force AI refinement
        if ((desc.startsWith('punto ') || desc.startsWith('puntos ')) &&
            !desc.includes('canaliz') && !desc.includes('ducto') && !desc.includes('tuber')) {
            console.log(`[Punto Pre-classification] Forcing 'c:\Users\nicog\Downloads\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\PIL.IA{row.excel_item_text}' to AI refinement`);
            return { ...row, match_confidence: 0.3, confidence: 'low' }; // Force AI refinement
        }

        // FIX 3: Auto-approve valid lengths from fuzzy matcher
        if (row.source_items && row.source_items.length > 0) {
            const firstItem = row.source_items[0];
            if (firstItem.type === 'length' && row.qty_final >= 1.0 && row.match_confidence >= 0.5) {
                console.log(`[Auto-approve Fuzzy] Valid length ${row.qty_final.toFixed(2)}m for '${row.excel_item_text}'`);
                return { ...row, status: 'approved' };
            }
        }

        return row;
    });

    // AI ENHANCEMENT:
    // Filter rows with low confidence to refine with AI
    // We process them in parallel batches to speed up
    if (process.env.GOOGLE_GENAI_API_KEY) {
        const { matchItemFlow } = await import('@/ai/match-items');

        // Prepare Rich Candidates (Name + Type)
        // Deduplicate by layer name but keep type info 
        // (If layer has both blocks and lines, we prefer block if it has more items? or keep both?)
        // Simplification: One entry per layer, prioritizing 'block' if mixed.
        // Prepare Rich Candidates (Name + Type)
        // IMPROVED: Group by Layer + BlockName for blocks to distinguish specific components
        const candidateMap = new Map<string, { name: string, type: string, sample_value: number, ids: string[] }>();

        dxfItems.forEach(i => {
            // Skip tiny text or noise if needed, but for now let's focus on logic
            let key = i.layer_normalized;
            let displayName = i.layer_normalized;

            // For Blocks, distinguishing by name is CRITICAL (e.g. UPS vs Socket)
            if (i.type === 'block' && i.name_raw) {
                key = `${i.layer_normalized}::${i.name_raw}`;
                displayName = `${i.name_raw} (Layer: ${i.layer_normalized})`;
            }

            if (!candidateMap.has(key)) {
                candidateMap.set(key, {
                    name: displayName,
                    type: i.type,
                    sample_value: i.value_m,
                    ids: [i.id] // Keep track of representant IDs? No, we filter later by match
                });
            }
        });
        const candidatePayload = Array.from(candidateMap.values())
            .map(c => ({ name: c.name, type: c.type, sample_value: c.sample_value }));

        const lowConfidenceRows = stagingRows.filter(r => (r as any).match_confidence < 0.6);

        console.log(`AI Refining ${lowConfidenceRows.length} items with Dimensional Analysis...`);

        // Parallel batch processing (5 items at a time to avoid rate limits)
        const BATCH_SIZE = 5;
        for (let i = 0; i < lowConfidenceRows.length; i += BATCH_SIZE) {
            const batch = lowConfidenceRows.slice(i, i + BATCH_SIZE);
            console.log(`Processing AI batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(lowConfidenceRows.length / BATCH_SIZE)} (items ${i + 1}-${Math.min(i + BATCH_SIZE, lowConfidenceRows.length)}/${lowConfidenceRows.length})`);

            await Promise.all(batch.map(async (row) => {
                try {
                    // --- TYPE ENFORCEMENT LOGIC ---
                    const desc = row.excel_item_text.toLowerCase();
                    const unit = (row.excel_unit || '').toLowerCase().trim();
                    let enforcedType: 'block' | 'length' | 'global' | null = null;

                    // Note: GLOBAL/SERVICE auto-classification now happens in post-fuzzy processing
                    // This section only handles items that reach AI refinement

                    // 0. Explicit Unit Detection (Hard Rules)
                    if (['m', 'ml', 'mts', 'metro', 'metros'].includes(unit)) {
                        enforcedType = 'length';
                    } else if (['un', 'u', 'c/u', 'und', 'unidad', 'c/u.', 'pza', 'pieza'].includes(unit)) {
                        enforcedType = 'block';
                    } else if (['gl', 'glb', 'global', 'est', 'est.'].includes(unit)) {
                        enforcedType = 'global';
                    }

                    // Fallback to Description Regex (Priority Algorithm)
                    if (!enforcedType) {
                        // 1. Global Items (Non-Geometric) - Highest Priority
                        if (desc.includes('instalacion') || desc.includes('instalación') || desc.includes('certificado') || desc.includes('plano') || desc.includes('tramite') || desc.includes('inscripcion') || desc.includes('legaliz') || desc.includes('rotulacion') || desc.includes('as built')) {
                            enforcedType = 'global';
                        }
                        // 2. Linear/Route Items (Strong Length Keywords) - Priority over Blocks
                        // "Alimentador desde caja..." should be LENGTH, even if it has "caja".
                        else if (desc.includes('canaliz') || desc.includes('tuber') || desc.includes('alimentador') || desc.includes('enlauchado') || desc.includes('cable') || desc.includes('conductor') || desc.includes('ducto') || desc.includes('escalerilla')) {
                            enforcedType = 'length';
                        }
                        // 3. Point Rule (Victory Feature) - "Punto X" is almost always BLOCK
                        // Unless it mentions conduit/channel explicitly.
                        // 3. Point Rule (Victory Feature) - "Punto X" is almost always BLOCK
                        // Unless it mentions conduit/channel explicitly.
                        // Force logic for "Punto" items if not already matched as length
                        else if ((desc.startsWith('punto ') || desc.startsWith('puntos ')) && !desc.includes('canaliz') && !desc.includes('tuber') && !desc.includes('ducto') && !desc.includes('conduit')) {
                            enforcedType = 'block';
                        }
                        // 4. Block Items (Countable) - Strong Keywords
                        else if (desc.includes('tablero') || desc.includes('punto') || desc.includes('gabinete') || desc.includes('ups') || desc.includes('sensor') || desc.includes('modulo') || desc.includes('remarcador') || desc.includes('equipo') || desc.includes('rack') || desc.includes('interruptor') || desc.includes('enchufe') || desc.includes('luminaria') || desc.includes('foco')) {
                            enforcedType = 'block';
                        }
                        // 5. Weak Block Keywords (Fallback)
                        // Only match "caja" if it wasn't caught as "Alimentador" (Length)
                        else if (desc.includes('caja')) {
                            enforcedType = 'block';
                        }
                    }

                    // HANDLE GLOBAL ITEMS IMMEDIATELY
                    if (enforcedType === 'global') {
                        (row as any).matched_items = [];
                        (row as any).match_confidence = 0.9;
                        (row as any).match_reason = "Logic: Item Global/Administrativo (No requiere dibujo)";
                        (row as any).status = 'approved';
                        row.qty_final = 1;
                        // Suggestion: None needed for approved global
                        return; // Skip AI matching
                    }

                    // FILTER CANDIDATES BASED ON TYPE
                    let filteredCandidates = candidatePayload;
                    if (enforcedType === 'block') {
                        filteredCandidates = candidatePayload.filter(c => c.type === 'block');
                        if (filteredCandidates.length === 0) {
                            // Fallback: if no blocks found, maybe they are drawn as lines? 
                            // But for now, strict enforcement is better to avoid "0.95m Tablero".
                            console.warn(`[Type Enforcement] Item '${row.excel_item_text}' requires BLOCK but no block candidates found.`);
                        }
                    } else if (enforcedType === 'length') {
                        filteredCandidates = candidatePayload.filter(c => c.type === 'length');
                    }

                    // If we filtered out everything, fallback to original or skip
                    const candidatesToUse = filteredCandidates.length > 0 ? filteredCandidates : candidatePayload;

                    const aiResult = await matchItemFlow({
                        item_description: row.excel_item_text,
                        item_unit: row.excel_unit,
                        item_class_hint: enforcedType || undefined, // Pass hint to AI
                        candidate_layers: candidatesToUse // Use filtered candidates
                    });

                    if (aiResult.selected_layer && aiResult.confidence > 0.5) {
                        // Find the items belonging to this layer
                        let betterMatches: ItemDetectado[] = [];

                        // Parse "BlockName (Layer: LayerName)" format used for Blocks in candidateMap
                        const granularMatch = aiResult.selected_layer.match(/^(.*) \(Layer: (.*)\)$/);

                        if (granularMatch) {
                            // CASE A: Specific Block selected
                            const bName = granularMatch[1];
                            const bLayer = granularMatch[2];
                            // STRICT FILTER: Only return BLOCKS with that name and layer. Ignore lines.
                            betterMatches = dxfItems.filter(i =>
                                i.layer_normalized === bLayer &&
                                i.name_raw === bName &&
                                i.type === 'block'
                            );
                        } else {
                            // CASE B: Whole Layer selected (Typical for Lengths/Areas)
                            // STRICT FILTER: Exclude blocks to avoid mixing types (e.g. 4 blocks + 0.9m length)
                            // If the AI selected a whole layer, it usually means linear elements.
                            betterMatches = dxfItems.filter(i =>
                                i.layer_normalized === aiResult.selected_layer &&
                                i.type !== 'block'
                            );
                        }

                        // FINAL TYPE CHECK (Post-AI)
                        // If we enforced BLOCK but ended up with LENGTH items (shouldn't happen with filtered candidates but safety first)
                        if (enforcedType === 'block' && betterMatches.some(m => m.type !== 'block')) {
                            console.warn(`[Type Enforcement] Rejected AI match for '${row.excel_item_text}' because it returned non-block items.`);
                            betterMatches = [];
                        }

                        if (betterMatches.length > 0) {
                            (row as any).matched_items = betterMatches;
                            (row as any).match_confidence = aiResult.confidence;
                            (row as any).match_reason = "AI: " + aiResult.reasoning;

                            // Recalculate Qty with Clean Length Filter
                            let qty = 0;
                            if (betterMatches[0].type === 'block') {
                                // VICTORY FIX: Sum values instead of counting items, for multi-insertion blocks
                                qty = betterMatches.reduce((acc, m) => acc + (m.value_raw || 1), 0);
                            } else {
                                // CLEAN LENGTH FILTER: Ignore tiny segments < 0.2m (Noise)
                                betterMatches.forEach(m => {
                                    if (m.value_m > 0.2) {
                                        qty += m.value_m;
                                    }
                                });
                            }
                            row.qty_final = qty;

                            // --- SANITY CHECKS (Tri-state) + REFINED STATUS ---
                            let status = aiResult.confidence > 0.8 ? 'approved' : 'pending';
                            let warning = "";
                            let statusReason = ""; // For refined status categorization

                            // 1. Linear Sanity
                            if (enforcedType === 'length') {
                                // A. INVALID (Noise) - Hard Fail → pending_no_geometry
                                if (qty < 0.5) {
                                    status = 'pending_no_geometry';
                                    statusReason = 'insufficient_geometry';
                                    row.qty_final = 0; // Force to 0 to prevent pricing
                                    warning = `[CRITICAL] Longitud < 0.5m (${qty.toFixed(2)}m). Invalidada por ser ruido gráfico.`;
                                    (row as any).match_reason += ` | ERR: ${warning}`;
                                    console.warn(`[Sanity Critical] ${row.excel_item_text}: ${warning}`);
                                }
                                // B. REVIEW REQUIRED (Suspicious) - Soft Fail
                                else if (qty < 2.0) {
                                    status = 'pending';
                                    warning = `[Sanity Warn] Longitud baja (${qty.toFixed(2)}m). Revisar si es simbología.`;
                                    (row as any).match_reason += ` | WARN: ${warning}`;
                                }
                                // C. HIGH SCALE ERROR
                                else if (qty > 5000) {
                                    status = 'pending';
                                    warning = `[Sanity Warn] Longitud extrema (${qty.toFixed(2)}m). Posible error de escala DXF.`;
                                    (row as any).match_reason += ` | WARN: ${warning}`;
                                }
                                // QUICK WIN 4: Auto-approve valid lengths
                                else if (qty >= 1.0 && !warning) {
                                    status = 'approved';
                                    console.log(`[Auto-approve] Valid length ${qty.toFixed(2)}m for '${row.excel_item_text}'`);
                                }
                            }

                            // 2. Block Keyword Overlap (Quick Win)
                            if (enforcedType === 'block') {
                                // Critical items must match semantically
                                const iDesc = desc; // already lowercased
                                if ((iDesc.includes('ups') || iDesc.includes('gabinete') || iDesc.includes('rack')) && betterMatches.length > 0) {
                                    const matchName = betterMatches[0].name_raw.toLowerCase();
                                    const hasOverlap = matchName.includes('ups') || matchName.includes('nobreak') || matchName.includes('rack') || matchName.includes('gab') || matchName.includes('cabinet');

                                    if (!hasOverlap) {
                                        status = 'pending_semantics';
                                        statusReason = 'semantic_mismatch';
                                        warning = `[Semantics] Block match '${betterMatches[0].name_raw}' does not contain required keywords for UPS/Rack.`;
                                        (row as any).match_reason += ` | WARN: ${warning}`;
                                    }
                                }

                                if (!Number.isInteger(qty)) {
                                    status = 'pending';
                                    warning = `[Sanity] Cantidad fraccionaria para bloque (${qty}).`;
                                    (row as any).match_reason += ` | WARN: ${warning}`;
                                }
                            }

                            (row as any).status = status;
                            (row as any).status_reason = statusReason;

                            // 3. Suggestions System (Victory Feature)
                            if (status.startsWith('pending')) {
                                const suggestions: Suggestion[] = [];

                                // A. Invalid Length -> Suggest Alt Layer
                                if (enforcedType === 'length' && qty < 0.5) {
                                    // Search for same-keyword layers with valid length
                                    const keywords = desc.split(' ').filter(w => w.length > 4);
                                    const altLinears = candidatesToUse.filter(c =>
                                        c.type === 'length' &&
                                        c.sample_value > 2.0 &&
                                        keywords.some(k => c.name.toLowerCase().includes(k))
                                    );

                                    altLinears.slice(0, 2).forEach(alt => {
                                        suggestions.push({
                                            id: crypto.randomUUID(),
                                            action_type: 'SELECT_ALT_LAYER',
                                            label: `Usar capa alternativa: ${alt.name} (${alt.sample_value.toFixed(1)}m)`,
                                            payload: { layer: alt.name, value: alt.sample_value },
                                            confidence: 'medium'
                                        });
                                    });

                                    // Suggest Manual Qty
                                    suggestions.push({
                                        id: crypto.randomUUID(),
                                        action_type: 'MANUAL_QTY',
                                        label: 'Ingresar Metros Manualmente',
                                        confidence: 'high'
                                    });
                                }

                                // B. Semantic Mismatch (UPS vs Tomada)
                                if (warning.includes('[Semantics]')) {
                                    suggestions.push({
                                        id: crypto.randomUUID(),
                                        action_type: 'MARK_GLOBAL',
                                        label: 'Convertir a Global (No Dibujado)',
                                        payload: { qty: 1 },
                                        confidence: 'high'
                                    });
                                }

                                (row as any).suggestions = suggestions;
                            }
                        }
                    }
                } catch (err) {
                    console.error("AI Match Error for", row.excel_item_text, err);
                }
            }));
        }

        console.log(`AI Refinement complete. Processed ${lowConfidenceRows.length} items.`);
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
        match_confidence: (row as any).match_confidence,
        match_reason: (row as any).match_reason || null,
        status: (row as any).status || 'pending',
        suggestions: (row as any).suggestions || null
    }));

    const { error } = await supabase.from('staging_rows').insert(dbRows);
    if (error) {
        console.error("Error inserting staging rows", error);
    } else {
        await supabase.from('batches').update({ status: 'ready' }).eq('id', batchId);
    }
}
