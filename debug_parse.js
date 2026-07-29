const fs = require('fs');
const html = fs.readFileSync('hostel_maintenance.html', 'utf8');
const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start);
if (start === -1 || end === -1) {
  console.error('script not found');
  process.exit(1);
}
const code = html.slice(start + '<script>'.length, end);
const lines = code.split(/\r?\n/);
const snippet = lines.slice(0, 3).join('\n');
console.log('SNIPPET:');
console.log(JSON.stringify(snippet));
console.log('CHARS:', Array.from(snippet).map(c => c.codePointAt(0)));
try {
  new Function(snippet);
  console.log('PARSED OK');
} catch (e) {
  console.error('PARSE ERROR:', e.message);
  console.error(e.stack);
}
