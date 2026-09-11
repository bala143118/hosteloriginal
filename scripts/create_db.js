const { Client } = require('pg');
require('dotenv').config();

async function createDatabaseIfNotExists() {
    const client = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'bala',
        database: 'postgres'
    });

    try {
        await client.connect();
        const dbName = process.env.DB_NAME || 'HostelFix';
        const checkRes = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        
        if (checkRes.rows.length === 0) {
            console.log(`[PostgreSQL] Database "${dbName}" does not exist. Creating database now...`);
            await client.query(`CREATE DATABASE "${dbName}";`);
            console.log(`[PostgreSQL] Database "${dbName}" created successfully!`);
        } else {
            console.log(`[PostgreSQL] Database "${dbName}" already exists.`);
        }
        await client.end();
    } catch (err) {
        console.error('[PostgreSQL Create DB Error]', err.message);
        await client.end();
        process.exit(1);
    }
}

createDatabaseIfNotExists();
