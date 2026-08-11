const fs = require('fs');
const html = fs.readFileSync('hostel_maintenance.html', 'utf8');
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.indexOf('</script>', scriptStart);
if (scriptStart === -1 || scriptEnd === -1) {
  console.error('inline script not found');
  process.exit(1);
}
const code = html.slice(scriptStart + '<script>'.length, scriptEnd);
const lines = code.split(/\r?\n/);
console.log('scriptStart', scriptStart, 'scriptEnd', scriptEnd);
console.log('FIRST 20 LINES:');
for (let i=0;i<20 && i<lines.length;i++) {
  const line = lines[i];
  console.log(`${i+1}: ${JSON.stringify(line)}`);
  if (line.includes('navigateTo') || i < 10) {
    console.log('   codes:', Array.from(line).map(ch => ch.charCodeAt(0)));
  }
}
console.log('last line:', lines[lines.length-1]);
console.log('line count', lines.length);
