const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, '../script.js');
let lines = fs.readFileSync(scriptPath, 'utf8').split(/\r?\n/);

// Find the line with .replace(/>/g
const idx = lines.findIndex(l => l.includes('.replace(/>/g'));
console.log('Found line at index:', idx);
if (idx !== -1) {
    const before = lines.slice(0, idx);
    const after = lines.slice(idx + 4); // skip .replace(/>/g..., .replace(/"/g..., .replace(/'/g..., }
    const escapeFunc = [
        "function escapeHtml(value = '') {",
        "    return String(value)",
        "        .replace(/&/g, '&amp;')",
        "        .replace(/</g, '&lt;')",
        "        .replace(/>/g, '&gt;')",
        "        .replace(/\"/g, '&quot;')",
        "        .replace(/'/g, '&#39;');",
        "}"
    ];
    lines = [...before, ...escapeFunc, ...after];
    fs.writeFileSync(scriptPath, lines.join('\n'), 'utf8');
    console.log('Successfully repaired script.js!');
}
