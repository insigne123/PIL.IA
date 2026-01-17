
import DxfParser from 'dxf-parser';
import fs from 'fs';
import path from 'path';

async function debugText() {
    console.log('--- DEBUG: Searching for ALL "INTERIOR" text ---');
    const filePath = path.join(process.cwd(), 'LDS_PAK - (LC) (1).dxf');
    if (!fs.existsSync(filePath)) {
        console.error('File not found');
        return;
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parser = new DxfParser();
    let dxf;
    try {
        dxf = parser.parseSync(fileContent);
    } catch (e) {
        console.error('Parse error:', e);
        return;
    }

    // Check Blocks
    if (dxf.blocks) {
        for (const blockName in dxf.blocks) {
            const block = dxf.blocks[blockName];
            if (block.entities) {
                for (const entity of block.entities) {
                    if ((entity.type === 'MTEXT' || entity.type === 'TEXT') &&
                        (entity.text && (entity.text.includes('INTERIOR') || entity.text.includes('interior')))) {
                        console.log(`--- FOUND "INTERIOR" in block "${blockName}" ---`);
                        console.log(JSON.stringify(entity, null, 2));
                    }
                }
            }
        }
    }

    // Check Model Space
    if (dxf.entities) {
        for (const entity of dxf.entities) {
            if ((entity.type === 'MTEXT' || entity.type === 'TEXT') &&
                (entity.text && (entity.text.includes('INTERIOR') || entity.text.includes('interior')))) {
                console.log(`--- FOUND "INTERIOR" in Model Space ---`);
                console.log(JSON.stringify(entity, null, 2));
            }
        }
    }
}

debugText().catch(console.error);
