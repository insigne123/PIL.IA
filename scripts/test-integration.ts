import path from 'path';
import { parseDxfWithPython } from '../src/lib/processing/dxf-python-service';
import fs from 'fs';

async function testIntegration() {
    const dxfPath = process.argv[2];
    if (!dxfPath) {
        console.error("Please provide a DXF file path");
        process.exit(1);
    }

    console.log(`Testing integration with: ${dxfPath}`);

    try {
        // 1. Test Python Service Directly
        console.log("--> Calling Python Service...");
        const result = await parseDxfWithPython(dxfPath);

        if (result.status === 'success' && result.items) {
            console.log("✅ Python Service Success!");
            console.log(`   Total Items: ${result.items.length}`);

            // Analyze Statistics
            const layers = new Set(result.items.map((i: any) => i.layer_normalized));
            console.log(`   Unique Layers: ${layers.size}`);

            // Check Specific Key Items
            const waterproofing = result.items.find((i: any) =>
                i.layer_normalized === 'g-dim' && i.color === 1 // Red is usually 1 in AutoCAD index
            );

            // Note: ezdxf might return color as integer index (1=Red, 2=Yellow, etc) or RGB tuple.
            // We need to verify what format our script sends.
            // Let's print a sample item logic.

            const gdimItems = result.items.filter((i: any) => i.layer_normalized === 'g-dim');
            console.log(`   G-DIM Items: ${gdimItems.length}`);
            if (gdimItems.length > 0) {
                console.log("   Sample G-DIM Item:", JSON.stringify(gdimItems[0], null, 2));
            }

            // Check Areas
            const areaItems = result.items.filter((i: any) => i.type === 'area');
            const totalArea = areaItems.reduce((sum: number, i: any) => sum + i.value_si, 0);
            console.log(`   Total Area detected: ${totalArea.toFixed(2)}`);

        } else {
            console.error("❌ Python Service returned failure:", result);
        }

    } catch (error) {
        console.error("❌ Integration Test Failed:", error);
    }
}

testIntegration();
