
const fs = require('fs');
const content = fs.readFileSync('scripts/verify-spatial.log', 'utf16le');
const lines = content.split('\n');
lines.forEach(line => {
    if (line.includes('[DXF Spatial]')) {
        console.log(line.trim());
    }
});
