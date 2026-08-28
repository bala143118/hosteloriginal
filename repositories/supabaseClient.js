const { createClient } = require('@supabase/supabase-js');

let client = null;
let connectionTested = false;
let isConnected = false;

function getSupabaseClient() {
    if (client) return client;

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                process.env.SUPABASE_ANON_KEY || 
                process.env.SUPABASE_KEY || 
                process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.warn('[Supabase] SUPABASE_URL or SUPABASE key missing in environment.');
        return null;
    }

    try {
        client = createClient(url, key, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
        return client;
    } catch (err) {
        console.error('[Supabase] Failed to initialize Supabase client:', err.message);
        return null;
    }
}

async function isSupabaseHealthy() {
    const sb = getSupabaseClient();
    if (!sb) return false;
    try {
        const { error } = await sb.from('users').select('id').limit(1);
        if (error && error.code !== 'PGRST116') {
            return false;
        }
        isConnected = true;
        return true;
    } catch (e) {
        isConnected = false;
        return false;
    }
}

module.exports = {
    getSupabaseClient,
    isSupabaseHealthy
};
