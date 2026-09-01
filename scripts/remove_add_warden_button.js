const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Remove the Add New Warden button from Warden Management page
const btn1Regex = /\s*<button id="addWardenButton"[\s\S]*?<\/button>/;
if (btn1Regex.test(html)) {
  html = html.replace(btn1Regex, '');
  console.log('Removed #addWardenButton from index.html');
}

// 2. Remove the Add Warden button on Admin Dashboard overview card
const btn2Regex = /\s*<button type="button" onclick="event\.stopPropagation\(\);\s*navigateTo\('admin-wardens'\);\s*setTimeout\(openAddWardenModal,\s*100\);"[^<]*<i class="fa-solid fa-plus mr-1"><\/i>\s*Add Warden\s*<\/button>/;
if (btn2Regex.test(html)) {
  html = html.replace(btn2Regex, '');
  console.log('Removed Add Warden button from admin dashboard card in index.html');
}

fs.writeFileSync('index.html', html, 'utf8');

// 3. Update script.js text
let js = fs.readFileSync('script.js', 'utf8');
if (js.includes('Click "Add New Warden" above to add one.')) {
  js = js.replace('Click "Add New Warden" above to add one.', '');
  console.log('Updated empty warden list message in script.js');
}
fs.writeFileSync('script.js', js, 'utf8');
