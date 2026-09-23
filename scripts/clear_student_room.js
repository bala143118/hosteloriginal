const db = require('../db');
const fs = require('fs');
const path = require('path');

async function clean() {
    console.log('Clearing default hostelBlock and roomNumber for student accounts in PostgreSQL...');
    await db.query(`UPDATE users SET "hostelBlock" = '', "roomNumber" = '' WHERE role = 'student'`);
    
    const dbPath = path.join(__dirname, '..', 'data', 'db.json');
    if (fs.existsSync(dbPath)) {
        const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        data.users = (data.users || []).map(u => {
            if (u.role === 'student') {
                return { ...u, hostelBlock: '', roomNumber: '' };
            }
            return u;
        });
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
        console.log('Updated data/db.json successfully.');
    }
    console.log('Done!');
    process.exit(0);
}

clean().catch(err => {
    console.error(err);
    process.exit(1);
});
