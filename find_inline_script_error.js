const fs = require('fs');
const html = fs.readFileSync('hostel_maintenance.html', 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/m);
if (!match) {
  console.error('No inline script found');
  process.exit(1);
}
const code = match[1];
const lines = code.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const snippet = lines.slice(0, i + 1).join('\n');
  try {
    new Function(snippet);
  } catch (e) {
    console.error('ERROR AT LINE', i + 1);
    console.error('LINE CONTENT:', lines[i]);
    console.error('ERROR MESSAGE:', e.message);
    console.error('STACK:', e.stack);
    process.exit(1);
  }
}
console.log('ALL LINES PARSED OK');
