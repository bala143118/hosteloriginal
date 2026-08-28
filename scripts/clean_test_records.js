const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSupabaseClient } = require('../repositories/supabaseClient');

async function cleanTestRecords() {
    const sb = getSupabaseClient();
    if (!sb) {
        console.error('Failed to get Supabase client');
        return;
    }

    console.log('Cleaning up temporary test technician and student records from Supabase...');
    
    const emailsToDelete = [
        'tech_bob_1787668326306@hostelfix.edu',
        'tech_bob_1787666457119@hostelfix.edu',
        'tech_bob_1787666346336@hostelfix.edu',
        'tech_bob_1787665929716@hostelfix.edu',
        'test_student_1787665929716@hostelfix.edu',
        'teststudent_1785951421855@hostelfix.edu'
    ];

    for (const email of emailsToDelete) {
        const { error } = await sb.from('users').delete().ilike('email', email);
        if (error) {
            console.warn(`Could not delete ${email}:`, error.message);
        } else {
            console.log(`Deleted test record: ${email}`);
        }
    }

    const { data: remaining } = await sb.from('users').select('user_id, name, email, role');
    console.log('\nRemaining Users in Database:');
    console.log(remaining);
}

cleanTestRecords();
