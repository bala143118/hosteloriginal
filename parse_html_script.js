const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('hostel_maintenance.html', 'utf8');
const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start);
if (start === -1 || end === -1) {
  console.error('script not found');
  process.exit(1);
}
const code = html.slice(start + '<script>'.length, end);
try {
  new vm.Script(code, { filename: 'inline-script.js' });
  console.log('Script parsed successfully');
} catch (e) {
  console.error('Parse error:', e.message);
  console.error('Line:', e.lineNumber || e.line);
  console.error('Column:', e.columnNumber || e.column);
  console.error(e.stack);
  process.exit(1);
}
