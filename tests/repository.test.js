const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [k, ...v] = line.split('=');
        if (k && v.length) process.env[k.trim()] = v.join('=').trim();
    });
}

const repositories = require('../repositories');

async function runRepositoryTests() {
    console.log('\n============================================================');
    console.log('   🧪 HOSTELFIX SUPABASE REPOSITORY LAYER TESTS');
    console.log('============================================================\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        return async () => {
            try {
                await fn();
                console.log(`  ✅ [PASS] ${name}`);
                passed++;
            } catch (err) {
                console.log(`  ❌ [FAIL] ${name}: ${err.message}`);
                failed++;
            }
        };
    }

    const tests = [
        test('Supabase client module loads and is configured', async () => {
            if (!repositories.getSupabaseClient) throw new Error('getSupabaseClient missing');
            const client = repositories.getSupabaseClient();
            if (process.env.SUPABASE_URL && !client) throw new Error('Client failed to initialize');
        }),

        test('User repository interface is complete', async () => {
            const repo = repositories.userRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.findByEmail !== 'function') throw new Error('findByEmail missing');
            if (typeof repo.findByUserId !== 'function') throw new Error('findByUserId missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
            if (typeof repo.update !== 'function') throw new Error('update missing');
        }),

        test('Complaint repository interface is complete', async () => {
            const repo = repositories.complaintRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.findById !== 'function') throw new Error('findById missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
            if (typeof repo.updateStatus !== 'function') throw new Error('updateStatus missing');
            if (typeof repo.assignTechnician !== 'function') throw new Error('assignTechnician missing');
        }),

        test('GatePass repository interface is complete', async () => {
            const repo = repositories.gatePassRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.findById !== 'function') throw new Error('findById missing');
            if (typeof repo.findByQrToken !== 'function') throw new Error('findByQrToken missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
            if (typeof repo.updateStatus !== 'function') throw new Error('updateStatus missing');
        }),

        test('Laundry repository interface is complete', async () => {
            const repo = repositories.laundryRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.findById !== 'function') throw new Error('findById missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
            if (typeof repo.updateStatus !== 'function') throw new Error('updateStatus missing');
        }),

        test('Announcement repository interface is complete', async () => {
            const repo = repositories.announcementRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
        }),

        test('Inventory repository interface is complete', async () => {
            const repo = repositories.inventoryRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
            if (typeof repo.updateStock !== 'function') throw new Error('updateStock missing');
        }),

        test('SecurityEvent repository interface is complete', async () => {
            const repo = repositories.securityEventRepository;
            if (typeof repo.getAll !== 'function') throw new Error('getAll missing');
            if (typeof repo.create !== 'function') throw new Error('create missing');
            if (typeof repo.acknowledge !== 'function') throw new Error('acknowledge missing');
        })
    ];

    for (const t of tests) {
        await t();
    }

    console.log('\n------------------------------------------------------------');
    console.log(`  🎉 SUMMARY: ${passed}/${passed + failed} repository unit tests passed!`);
    console.log('------------------------------------------------------------\n');

    if (failed > 0) process.exit(1);
}

runRepositoryTests().catch(console.error);
