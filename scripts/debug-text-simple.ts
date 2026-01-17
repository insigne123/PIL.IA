
import DxfParser from 'dxf-parser';
import fs from 'fs';
import path from 'path';

async function debugText() {
    const filePath = path.join(process.cwd(), 'LDS_PAK - (LC) (1).dxf');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parser = new DxfParser();
    let dxf;
    try {
        dxf = parser.parseSync(fileContent);
    } catch (e) { console.error(e); return; }

    if (dxf.entities) {
        for (const entity of dxf.entities) {
            if ((entity.type === 'MTEXT' || entity.type === 'TEXT') &&
                (entity.text && (entity.text.includes('INTERIOR') || entity.text.includes('interior')))) {
                const pos = (entity as any).position || (entity as any).insertionPoint;
                console.log(`FOUND INTERIOR: ${pos ? JSON.stringify(pos) : 'NO_POS'}`);
            }
        }
    }
}
debugText();
