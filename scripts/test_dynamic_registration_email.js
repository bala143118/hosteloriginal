const fetch = globalThis.fetch || require('node-fetch');

async function testRegistration() {
  const testEmail = `teststudent_${Date.now()}@example.com`;
  console.log(`[Test] Registering new student with dynamic email: ${testEmail}...`);

  const res = await fetch('http://localhost:5000/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dynamic Test Student',
      email: testEmail,
      password: 'password123',
      role: 'student',
      roomNumber: '202',
      hostelBlock: 'Block B'
    })
  });

  const data = await res.json();
  console.log('[Test] Status:', res.status);
  console.log('[Test] Response:', data);

  if (res.ok && data.message && data.message.includes(testEmail)) {
    console.log('✅ Dynamic registration email dispatched successfully to:', testEmail);
  } else {
    console.error('❌ Failed registration test');
    process.exit(1);
  }
}

testRegistration().catch(err => {
  console.error(err);
  process.exit(1);
});
