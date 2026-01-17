
import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

const FILES = [
    'LDS_PAK - (LC)-02_CONSTRUCCION.pdf',
    'LDS_PAK - (LC)-05_PAVIMENTOS.pdf'
];

async function extractText(filename: string) {
    const filePath = path.resolve(__dirname, '..', filename);
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filename}`);
        return;
    }

    console.log(`\nExtracting text from ${filename}...`);
    const dataBuffer = fs.readFileSync(filePath);

    try {
        const data = await pdf(dataBuffer);
        const text = data.text;


        const output = [];
        output.push(`  • Pages: ${data.numpages}`);
        output.push(`  • Info: ${JSON.stringify(data.info)}`);
        output.push(`  • Approx chars: ${text.length}`);

        // Search for keywords
        const keywords = ['TAB 01', 'TAB 02', 'Cielo', 'M2', 'm2', 'NPT', 'ESCALA'];
        output.push('\n  Keyword Search:');

        for (const kw of keywords) {
            const matches = text.match(new RegExp(kw, 'gi')) || [];
            output.push(`    - "${kw}": ${matches.length} matches`);
        }

        // Show sample text
        output.push('\n  Sample Text (first 500 chars):');
        output.push('  ' + text.substring(0, 500).replace(/\n/g, ' '));

        // Show text around 'TAB 01' if found
        const tabIndex = text.indexOf('TAB 01');
        if (tabIndex !== -1) {
            output.push('\n  Context around "TAB 01":');
            output.push('  ...' + text.substring(tabIndex - 50, tabIndex + 50).replace(/\n/g, ' ') + '...');
        }

        fs.writeFileSync('pdf_text_output.txt', output.join('\n'));
        console.log('Output written to pdf_text_output.txt');

    } catch (e) {
        console.error('  ❌ Error extracting text:', e);
        fs.writeFileSync('pdf_text_output.txt', `Error: ${e.message}`);
    }
}

async function run() {
    // Only try the first file to minimize errors
    await extractText(FILES[0]);
}

run();
