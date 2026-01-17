
import fs from 'fs';
import path from 'path';

// Load validation CSV
const CSV_PATH = path.resolve(__dirname, '..', '00. LdS PA - Planilla cotizaciขn OOCC MV CONSTRUCTORA rev1.csv');
const STAGING_PATH = path.resolve(__dirname, '..', 'staging_data_final.json');

// Parse CSV to extract expected quantities
function parseValidationCSV(content: string): Map<string, { expected: number; unit: string }> {
    const lines = content.split('\n');
    const result = new Map<string, { expected: number; unit: string }>();

    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 4) {
            const item = parts[1]?.trim().replace(/"/g, '');
            const unit = parts[2]?.trim();
            const qtyStr = parts[3]?.trim().replace(/"/g, '').replace(/,/g, '.');
            const qty = parseFloat(qtyStr);

            if (item && !isNaN(qty) && qty > 0 && unit) {
                // Normalize item name for matching
                const normalized = item.toLowerCase().substring(0, 50);
                result.set(normalized, { expected: qty, unit });
            }
        }
    }
    return result;
}

// Load staging data
function loadStagingData(): any[] {
    const content = fs.readFileSync(STAGING_PATH, 'utf-8');
    return JSON.parse(content);
}

// Compare and generate report
function compare() {
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const expectedMap = parseValidationCSV(csvContent);
    const stagingData = loadStagingData();

    console.log('='.repeat(120));
    console.log('COMPARACIÓN: Valores Calculados vs Valores Esperados (CSV Validación)');
    console.log('='.repeat(120));
    console.log('');

    let correct = 0;
    let wrong = 0;
    let missing = 0;
    let noExpected = 0;

    const results: Array<{
        item: string;
        unit: string;
        expected: number | null;
        calculated: number | null;
        diff: string;
        status: 'OK' | 'WRONG' | 'MISSING' | 'NO_REF';
    }> = [];

    for (const row of stagingData) {
        if (row.status === 'title' || row.status === 'ignored') continue;

        const itemText = row.excel_item_text?.toLowerCase().substring(0, 50) || '';
        const unit = row.excel_unit || '';
        const calculated = row.qty_final;

        // Try to find in expected map
        let expectedData = null;
        for (const [key, val] of expectedMap.entries()) {
            if (itemText.includes(key.substring(0, 20)) || key.includes(itemText.substring(0, 20))) {
                expectedData = val;
                break;
            }
        }

        if (!expectedData) {
            noExpected++;
            results.push({
                item: row.excel_item_text?.substring(0, 60) || 'Unknown',
                unit,
                expected: null,
                calculated,
                diff: 'N/A',
                status: 'NO_REF'
            });
            continue;
        }

        const expected = expectedData.expected;

        if (calculated === null || calculated === undefined) {
            missing++;
            results.push({
                item: row.excel_item_text?.substring(0, 60) || 'Unknown',
                unit,
                expected,
                calculated: null,
                diff: '∞',
                status: 'MISSING'
            });
        } else {
            // Check if within 10% tolerance
            const tolerance = 0.10;
            const diff = Math.abs(calculated - expected) / expected;

            if (diff <= tolerance) {
                correct++;
                results.push({
                    item: row.excel_item_text?.substring(0, 60) || 'Unknown',
                    unit,
                    expected,
                    calculated,
                    diff: `${(diff * 100).toFixed(1)}%`,
                    status: 'OK'
                });
            } else {
                wrong++;
                results.push({
                    item: row.excel_item_text?.substring(0, 60) || 'Unknown',
                    unit,
                    expected,
                    calculated,
                    diff: `${(diff * 100).toFixed(0)}%`,
                    status: 'WRONG'
                });
            }
        }
    }

    // Print summary
    const total = correct + wrong + missing;
    console.log('RESUMEN:');
    console.log(`  ✅ Correctos (±10%): ${correct} / ${total} (${(correct / total * 100).toFixed(1)}%)`);
    console.log(`  ❌ Incorrectos: ${wrong} / ${total} (${(wrong / total * 100).toFixed(1)}%)`);
    console.log(`  ⚠️ Sin calcular: ${missing} / ${total} (${(missing / total * 100).toFixed(1)}%)`);
    console.log(`  ➖ Sin referencia: ${noExpected}`);
    console.log('');

    // Print detailed table of wrong items
    console.log('='.repeat(120));
    console.log('DETALLE DE ITEMS INCORRECTOS:');
    console.log('='.repeat(120));
    console.log('');
    console.log('Item'.padEnd(62) + 'Unidad'.padEnd(8) + 'Esperado'.padStart(12) + 'Calculado'.padStart(12) + 'Diff'.padStart(10));
    console.log('-'.repeat(104));

    for (const r of results.filter(r => r.status === 'WRONG' || r.status === 'MISSING')) {
        const expStr = r.expected !== null ? r.expected.toFixed(2) : '-';
        const calcStr = r.calculated !== null ? r.calculated.toFixed(2) : 'NULL';
        console.log(
            r.item.padEnd(62) +
            r.unit.padEnd(8) +
            expStr.padStart(12) +
            calcStr.padStart(12) +
            r.diff.padStart(10)
        );
    }

    // Save to file
    const report = results.map(r => ({
        ...r,
        item: r.item.substring(0, 60)
    }));
    fs.writeFileSync('accuracy_report.json', JSON.stringify(report, null, 2));
    console.log('\nReporte guardado en accuracy_report.json');
}

compare();
