
import { matchItems } from '../src/lib/processing/matcher';
import { ItemDetectado, ExtractedExcelItem } from '../src/types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Mock Items - Use distinct layers to verify layer selection steering
const mockItems: ItemDetectado[] = [
    {
        id: uuidv4(),
        type: 'length',
        name_raw: 'Tabique Volcanita',
        layer_raw: 'fa_tabiques_sala',
        layer_normalized: 'fa_tabiques_sala',
        value_raw: 10,
        unit_raw: 'm',
        value_si: 10,
        value_m: 10,
        zone_id: 'z1',
        zone_name: 'SALA DE REUNIONES'
    },
    {
        id: uuidv4(),
        type: 'length',
        name_raw: 'Tabique Volcanita',
        layer_raw: 'fa_tabiques_bodega',
        layer_normalized: 'fa_tabiques_bodega',
        value_raw: 5,
        unit_raw: 'm',
        value_si: 5,
        value_m: 5,
        zone_id: 'z2',
        zone_name: 'BODEGA'
    },
    {
        id: uuidv4(),
        type: 'length',
        name_raw: 'Tabique General',
        layer_raw: 'fa_tabiques_gen',
        layer_normalized: 'fa_tabiques_gen',
        value_raw: 20,
        unit_raw: 'm',
        value_si: 20,
        value_m: 20,
        // No zone
    }
];

// Mock Excel Requests
const excelRequestSala: ExtractedExcelItem = {
    id: '1',
    description: 'Tabique Sala de Reuniones',
    unit: 'm',
    quantity: 10,
    unitPrice: 0,
    totalPrice: 0
};

const excelRequestBodega: ExtractedExcelItem = {
    id: '2',
    description: 'Tabique en Bodega',
    unit: 'm',
    quantity: 5,
    unitPrice: 0,
    totalPrice: 0
};

async function test() {
    try {
        console.log('--- Test Start ---');

        // Test 1: Sala
        console.log('\n--- Test 1: Matching "Tabique Sala" ---');
        const resultSala = matchItems([excelRequestSala], mockItems, 'TestSheet');
        const matchSala = resultSala[0].matched_items?.[0];

        console.log(`Matched Item Zone: ${matchSala?.zone_name}`);
        console.log(`Matched Layer: ${matchSala?.layer_normalized}`);
        console.log(`Score: ${resultSala[0].match_confidence}`);
        console.log(`Reason: ${resultSala[0].match_reason}`);

        let pass1 = false;
        // Should match fa_tabiques_sala (SALA)
        if (matchSala?.zone_name === 'SALA DE REUNIONES' && matchSala?.layer_normalized === 'fa_tabiques_sala') {
            console.log('✅ PASS: Correctly matched to SALA layer');
            pass1 = true;
        } else {
            console.error('❌ FAIL: Did not match to SALA layer');
        }

        // Test 2: Bodega
        console.log('\n--- Test 2: Matching "Tabique Bodega" ---');
        const resultBodega = matchItems([excelRequestBodega], mockItems, 'TestSheet');
        const matchBodega = resultBodega[0].matched_items?.[0];

        console.log(`Matched Item Zone: ${matchBodega?.zone_name}`);
        console.log(`Matched Layer: ${matchBodega?.layer_normalized}`);
        console.log(`Score: ${resultBodega[0].match_confidence}`);

        let pass2 = false;
        // Should match fa_tabiques_bodega (BODEGA)
        if (matchBodega?.zone_name === 'BODEGA' && matchBodega?.layer_normalized === 'fa_tabiques_bodega') {
            console.log('✅ PASS: Correctly matched to BODEGA layer');
            pass2 = true;
        } else {
            console.error('❌ FAIL: Did not match to BODEGA layer');
        }

        if (pass1 && pass2) {
            console.log('ALL TESTS PASSED');
            fs.writeFileSync('test-result.txt', 'PASS');
        } else {
            console.error('TESTS FAILED');
            fs.writeFileSync('test-result.txt', 'FAIL');
        }

    } catch (e: any) {
        console.error("CRITICAL ERROR:", e);
        fs.writeFileSync('test-result.txt', `ERROR: ${e.stack || e}`);
    }
}

test();
