const fs = require('fs');
const html = fs.readFileSync('hostel_maintenance.html', 'utf8');
const match = html.match(/<script>([\s\S]*)<\/script>/m);
if (!match) {
  console.error('No inline script found');
  process.exit(1);
}
const code = match[1];
console.log('INLINE_SCRIPT_START');
console.log(code);
console.log('INLINE_SCRIPT_END');
try {
  new Function(code);
  console.log('PARSE_OK');
} catch (err) {
  console.error(err.stack || err.toString());
  process.exit(1);
}
