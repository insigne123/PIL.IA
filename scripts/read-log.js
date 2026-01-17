
const fs = require('fs');
const content = fs.readFileSync('scripts/verify-spatial.log', 'utf16le');
console.log(content);
