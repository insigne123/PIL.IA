
import fs from 'fs';
import path from 'path';

const FILES = [
    'LDS_PAK - (LC)-02_CONSTRUCCION.pdf',
    'LDS_PAK - (LC)-05_PAVIMENTOS.pdf'
];

async function analyzePdf(filename: string) {
    const filePath = path.resolve(__dirname, '..', filename);
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filename}`);
        return;
    }

    console.log(`\nAnalyzing ${filename}...`);
    const buffer = fs.readFileSync(filePath);

    // Convert to string (might be messy due to binary, but we look for keywords)
    // Note: Compressed streams won't show operators, but we might see /Filter /FlateDecode
    const content = buffer.toString('latin1'); // Preserve bytes

    // Check for compression
    const isCompressed = content.includes('/Filter /FlateDecode') || content.includes('/Filter/FlateDecode');
    console.log(`  • Compressed: ${isCompressed ? 'Yes (Content hidden)' : 'No (Raw operators visible)'}`);

    // Even if compressed, we can look for basic dictionary entries that suggest content type
    const fontCount = (content.match(/\/Font\b/g) || []).length;
    const xObjectCount = (content.match(/\/XObject\b/g) || []).length;
    const imageCount = (content.match(/\/Subtype \/Image/g) || []).length + (content.match(/\/Subtype\/Image/g) || []).length;

    console.log(`  • Fonts detected: ${fontCount}`);
    console.log(`  • XObjects detected: ${xObjectCount}`);
    console.log(`  • Images detected: ${imageCount}`);

    // Heuristics
    if (fontCount > 0) {
        console.log(`  ✅ Likely contains vector TEXT (Fonts found)`);
    } else {
        console.log(`  ⚠️ No fonts found - might be purely raster or fonts embedded in obscure way`);
    }

    if (imageCount > 0 && fontCount === 0) {
        console.log(`  ❌ Likely RASTER ONLY (Images found, no fonts)`);
    } else if (imageCount > 0 && fontCount > 0) {
        console.log(`  ⚠️ HYBRID (Contains both images and text)`);
    } else if (imageCount === 0 && fontCount > 0) {
        console.log(`  ✅ Likely VECTOR (Fonts found, no images)`);
    }

    // Look for vector keywords (only works if uncompressed or partially uncompressed)
    // Common in uncompressed: ' m ' (move), ' l ' (line), ' c ' (curve), ' re ' (rect)
    // But since most PDFs are compressed, this is unreliable without decompression.
    // However, existence of "Stream" usually implies content.
}

async function run() {
    for (const file of FILES) {
        await analyzePdf(file);
    }
}

run();
