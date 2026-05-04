/**
 * Express Quota Test Suite
 * PowerShell-compatible test commands
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'myapikey';
const API_SECRET = 'myapisecret';

function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: {
                'x-api-key': API_KEY,
                'x-api-secret': API_SECRET,
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: JSON.parse(data)
                    });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  Express Quota v2.0 - Automated Test Suite');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Test 1: Health check
    console.log('TEST 1: Health Check');
    const health = await makeRequest('/api/health');
    console.log(`  Status: ${health.status}`);
    console.log(`  Response: ${JSON.stringify(health.body)}\n`);

    // Test 2: Get initial quota
    console.log('TEST 2: Get Quota Status');
    const quota = await makeRequest('/api/quota');
    console.log(`  Status: ${quota.status}`);
    console.log(`  Budget: £${quota.body.budget.total} | Remaining: £${quota.body.budget.remaining}`);
    console.log(`  Categories: FOOD(£${quota.body.categories.FOOD.remaining}) WATER(£${quota.body.categories.WATER.remaining})`);
    console.log(`  Rate Limit Remaining: ${quota.headers['x-ratelimit-remaining']}\n`);

    // Test 3: Purchase milk (£2.00)
    console.log('TEST 3: Purchase Milk (£2.00)');
    const milk = await makeRequest('/api/purchase', 'POST', {
        category: 'FOOD',
        amount: 2.00,
        items: ['milk 1L'],
        deliveryFee: 0
    });
    console.log(`  Status: ${milk.status}`);
    console.log(`  Transaction: ${milk.body.transaction?.id || 'BLOCKED'}`);
    console.log(`  Total: £${milk.body.transaction?.totalAmount || 'N/A'}`);
    console.log(`  Remaining: £${milk.body.balance?.remaining || milk.body.currentBalance?.global}\n`);

    // Test 4: Purchase bread (£2.50) + delivery (£2.50)
    console.log('TEST 4: Purchase Bread + Delivery (£5.00 total)');
    const bread = await makeRequest('/api/purchase', 'POST', {
        category: 'FOOD',
        amount: 2.50,
        items: ['bread loaf'],
        deliveryFee: 2.50
    });
    console.log(`  Status: ${bread.status}`);
    console.log(`  Transaction: ${bread.body.transaction?.id || 'BLOCKED'}`);
    console.log(`  Remaining: £${bread.body.balance?.remaining || bread.body.currentBalance?.global}\n`);

    // Test 5: Attempt over-budget purchase (should fail)
    console.log('TEST 5: Over-Budget Purchase (should fail)');
    const over = await makeRequest('/api/purchase', 'POST', {
        category: 'SHELTER',
        amount: 100.00,
        items: ['house deposit']
    });
    console.log(`  Status: ${over.status}`);
    console.log(`  Error: ${over.body.error}`);
    console.log(`  Violations: ${over.body.violations?.join('; ')}\n`);

    // Test 6: Get transaction history
    console.log('TEST 6: Transaction History');
    const history = await makeRequest('/api/transactions');
    console.log(`  Status: ${history.status}`);
    console.log(`  Total Transactions: ${history.body.total}`);
    history.body.transactions.forEach((tx, i) => {
        console.log(`  [${i+1}] ${tx.id.substring(0,8)}... | ${tx.category} | £${tx.totalAmount} | ${tx.status}`);
    });
    console.log();

    // Test 7: Final quota check
    console.log('TEST 7: Final Quota Status');
    const final = await makeRequest('/api/quota');
    console.log(`  Total Spent: £${final.body.budget.spent}`);
    console.log(`  Total Remaining: £${final.body.budget.remaining}`);
    console.log(`  Utilization: ${final.body.budget.utilizationPercent}%\n`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  All tests completed.');
    console.log('═══════════════════════════════════════════════════════════════\n');
}

runTests().catch(console.error);
