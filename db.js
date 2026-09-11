const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'HostelFix',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'bala',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected pool client error:', err.message);
});

async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.NODE_ENV === 'development' && duration > 500) {
            console.debug(`[PostgreSQL Query] Executed in ${duration}ms: ${text.substring(0, 100)}`);
        }
        return res;
    } catch (err) {
        console.error('[PostgreSQL Query Error]', err.message, 'SQL:', text);
        throw err;
    }
}

async function testConnection() {
    try {
        const res = await pool.query('SELECT NOW() as now, current_database() as db_name, version() as pg_version');
        const info = res.rows[0];
        console.log(`[PostgreSQL] Connection successful! Connected to database '${info.db_name}' at ${info.now}`);
        return { success: true, info };
    } catch (err) {
        console.error('[PostgreSQL Connection Error]', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    pool,
    query,
    testConnection
};
