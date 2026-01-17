
import fs from 'fs';
import path from 'path';
import { parseDxf } from '../src/lib/processing/dxf';

const filePath = 'LDS_PAK - (LC) (1).dxf';
const fullPath = path.resolve(process.cwd(), filePath);

async function verify() {
    console.error(`Parsing ${fullPath}...`); // Use stderr for status
    const content = fs.readFileSync(fullPath, 'utf8');

    try {
        const { items } = await parseDxf(content, 'm');

        console.error(`Parsed ${items.length} items.`);

        // Count items with zones
        const zoned = items.filter(i => i.zone_name);
        console.error(`Items with Zone Assignment: ${zoned.length}`);

        // Check for SALA
        const sala = zoned.find(i => i.zone_name && i.zone_name.includes('SALA'));
        if (!sala) {
            console.error('❌ No items assigned to SALA');
        } else {
            console.error(`✅ Found SALA items: ${sala.zone_name}`);
        }

        // Print sample zoned items (JSON)
        console.log(JSON.stringify(items.filter(i => i.zone_name).slice(0, 5).map(i => ({
            name: i.name_raw,
            zone: i.zone_name,
            value: i.value_si
        })), null, 2));

    } catch (e) {
        console.error("Critical Error", e);
    }
}

process.on('unhandledRejection', (r) => console.error(r));

verify();
