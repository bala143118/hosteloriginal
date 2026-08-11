const http = require('http');
const payload = JSON.stringify({
  student: 'Automated Test',
  email: 'auto@test.edu',
  registrationNumber: 'REG-AUTO-1',
  hostelBlock: 'Block C',
  roomNumber: 'C-303',
  dressCount: 2,
  pickupDate: '2026-07-26',
  details: '2 shirts'
});

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/laundry-requests',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS', res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('BODY', data));
});

req.on('error', (e) => console.error('ERROR', e.message));
req.write(payload);
req.end();
