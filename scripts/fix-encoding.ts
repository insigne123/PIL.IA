
import fs from 'fs';
import path from 'path';

const filePath = path.resolve(process.cwd(), 'src/lib/processing/matcher.ts');

try {
    const buffer = fs.readFileSync(filePath);
    // Try to decode as UTF-8. If it has BOM, strip it.
    let content = buffer.toString('utf8');
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
        console.log('Removed BOM');
    }

    // Write back as plain UTF-8
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed encoding for matcher.ts');
} catch (e) {
    console.error(e);
}
