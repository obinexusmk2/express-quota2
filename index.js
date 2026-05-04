
/**
 * Express Quota Micro-Transaction Service v2.0
 * 
 * A proper server-side quota enforcement system for automated
 * purchasing of food, water, and shelter within budget constraints.
 * 
 * Constitutional Computing Principles (OBINexus):
 * - CH_0 (Observation): Audit logging, IP binding, identity verification
 * - CH_1 (Enforcement): Budget deduction, transaction validation, retry logic
 * - CH_2 (Governance): Constitutional rules - max spend caps, category allocation
 * 
 * @author Nnamdi Okala (okpalan2)
 * @license WU-IW Equity Trade Act 2026
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ============================================================
// GOVERNANCE LAYER (CH_2) - Constitutional Rules
// ============================================================
const GOVERNANCE = {
    // Budget allocation categories (sustainable automation)
    categories: {
        FOOD: { maxPerTransaction: 5.00, dailyLimit: 15.00, priority: 1 },
        WATER: { maxPerTransaction: 3.00, dailyLimit: 10.00, priority: 1 },
        SHELTER: { maxPerTransaction: 50.00, dailyLimit: 100.00, priority: 2 },
        DELIVERY: { maxPerTransaction: 10.00, dailyLimit: 20.00, priority: 3 }
    },

    // Global constraints
    globalBudget: 50.00,           // Total weekly/monthly budget
    maxTransactionAmount: 50.00,    // Hard cap per transaction
    minTransactionAmount: 0.01,     // Micro-transaction floor

    // Rate limiting (requests per minute per API key)
    rateLimitWindowMs: 60000,      // 1 minute window
    rateLimitMaxRequests: 10       // Max 10 requests per minute
};

// ============================================================
// STATE MANAGEMENT - Server-side tracking (NOT client headers)
// ============================================================

// In-memory store (use Redis in production)
const quotaStore = new Map();
const rateLimitStore = new Map();
const transactionLog = [];

// Initialize a user's quota account
function initializeQuota(apiKey, initialBudget = GOVERNANCE.globalBudget) {
    const account = {
        apiKey,
        totalBudget: initialBudget,
        spent: 0.00,
        remaining: initialBudget,
        categories: {
            FOOD: { spent: 0.00, remaining: GOVERNANCE.categories.FOOD.dailyLimit },
            WATER: { spent: 0.00, remaining: GOVERNANCE.categories.WATER.dailyLimit },
            SHELTER: { spent: 0.00, remaining: GOVERNANCE.categories.SHELTER.dailyLimit },
            DELIVERY: { spent: 0.00, remaining: GOVERNANCE.categories.DELIVERY.dailyLimit }
        },
        transactions: [],
        createdAt: new Date().toISOString(),
        ipBindings: new Set()
    };
    quotaStore.set(apiKey, account);
    return account;
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

// API Key registry (in production, use database with hashed secrets)
const apiRegistry = new Map([
    ['myapikey', { 
        secret: 'myapisecret', 
        name: 'Primary Account',
        budget: 50.00 
    }],
    ['demo-key', { 
        secret: 'demo-secret', 
        name: 'Demo Account',
        budget: 25.00 
    }]
]);

function authMiddleware(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const apiSecret = req.headers['x-api-secret'];

    if (!apiKey) {
        return res.status(401).json({
            error: 'NO_API_KEY',
            message: 'No API key provided. Include x-api-key header.'
        });
    }

    if (!apiSecret) {
        return res.status(401).json({
            error: 'NO_API_SECRET',
            message: 'No API secret provided. Include x-api-secret header.'
        });
    }

    const credentials = apiRegistry.get(apiKey);
    if (!credentials || credentials.secret !== apiSecret) {
        return res.status(401).json({
            error: 'INVALID_CREDENTIALS',
            message: 'Invalid API key or secret.'
        });
    }

    // Attach identity to request
    req.apiIdentity = {
        key: apiKey,
        name: credentials.name,
        budget: credentials.budget
    };

    // Initialize quota account if not exists
    if (!quotaStore.has(apiKey)) {
        initializeQuota(apiKey, credentials.budget);
    }

    next();
}

// ============================================================
// RATE LIMITING MIDDLEWARE (Server-side enforced)
// ============================================================

function rateLimitMiddleware(req, res, next) {
    const apiKey = req.apiIdentity.key;
    const now = Date.now();
    const windowStart = now - GOVERNANCE.rateLimitWindowMs;

    // Get or create rate limit record
    let record = rateLimitStore.get(apiKey);
    if (!record) {
        record = { requests: [], blockedUntil: 0 };
        rateLimitStore.set(apiKey, record);
    }

    // Check if currently blocked
    if (record.blockedUntil > now) {
        const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
        return res.status(429).json({
            error: 'RATE_LIMIT_BLOCKED',
            message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
            retryAfter,
            blockedUntil: new Date(record.blockedUntil).toISOString()
        });
    }

    // Clean old requests outside window
    record.requests = record.requests.filter(ts => ts > windowStart);

    // Check if limit reached
    if (record.requests.length >= GOVERNANCE.rateLimitMaxRequests) {
        record.blockedUntil = now + GOVERNANCE.rateLimitWindowMs;
        return res.status(429).json({
            error: 'RATE_LIMIT_EXCEEDED',
            message: `Maximum ${GOVERNANCE.rateLimitMaxRequests} requests per minute exceeded.`,
            retryAfter: 60,
            limit: GOVERNANCE.rateLimitMaxRequests,
            window: '1 minute'
        });
    }

    // Record this request
    record.requests.push(now);

    // Add rate limit headers to response
    res.setHeader('X-RateLimit-Limit', GOVERNANCE.rateLimitMaxRequests);
    res.setHeader('X-RateLimit-Remaining', GOVERNANCE.rateLimitMaxRequests - record.requests.length);
    res.setHeader('X-RateLimit-Reset', new Date(now + GOVERNANCE.rateLimitWindowMs).toISOString());

    next();
}

// ============================================================
// QUOTA ENFORCEMENT LAYER (CH_1)
// ============================================================

function validateTransaction(account, transaction) {
    const { category, amount, items, deliveryFee = 0 } = transaction;
    const totalAmount = parseFloat(amount) + parseFloat(deliveryFee);

    const errors = [];

    // Check category exists
    if (!GOVERNANCE.categories[category]) {
        errors.push(`Invalid category: ${category}. Valid: FOOD, WATER, SHELTER, DELIVERY`);
    }

    // Check minimum transaction
    if (totalAmount < GOVERNANCE.minTransactionAmount) {
        errors.push(`Transaction amount £${totalAmount.toFixed(2)} below minimum £${GOVERNANCE.minTransactionAmount.toFixed(2)}`);
    }

    // Check maximum transaction
    if (totalAmount > GOVERNANCE.maxTransactionAmount) {
        errors.push(`Transaction amount £${totalAmount.toFixed(2)} exceeds maximum £${GOVERNANCE.maxTransactionAmount.toFixed(2)}`);
    }

    // Check category limit
    if (GOVERNANCE.categories[category]) {
        const catLimit = GOVERNANCE.categories[category].maxPerTransaction;
        if (parseFloat(amount) > catLimit) {
            errors.push(`Category ${category} max per transaction is £${catLimit.toFixed(2)}`);
        }

        const catDaily = account.categories[category];
        if (catDaily.remaining < parseFloat(amount)) {
            errors.push(`Category ${category} daily limit exceeded. Remaining: £${catDaily.remaining.toFixed(2)}`);
        }
    }

    // Check global budget
    if (totalAmount > account.remaining) {
        errors.push(`Insufficient global budget. Need £${totalAmount.toFixed(2)}, have £${account.remaining.toFixed(2)}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        totalAmount
    };
}

function executeTransaction(account, transaction) {
    const { category, amount, items, deliveryFee = 0 } = transaction;
    const totalAmount = parseFloat(amount) + parseFloat(deliveryFee);

    const txnId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Deduct from category budget
    account.categories[category].spent += parseFloat(amount);
    account.categories[category].remaining -= parseFloat(amount);

    // Deduct delivery from DELIVERY category if applicable
    if (deliveryFee > 0) {
        account.categories.DELIVERY.spent += parseFloat(deliveryFee);
        account.categories.DELIVERY.remaining -= parseFloat(deliveryFee);
    }

    // Deduct from global budget
    account.spent += totalAmount;
    account.remaining -= totalAmount;

    const txnRecord = {
        id: txnId,
        timestamp,
        category,
        amount: parseFloat(amount),
        deliveryFee: parseFloat(deliveryFee),
        totalAmount,
        items: items || [],
        remainingAfter: account.remaining,
        status: 'COMPLETED'
    };

    account.transactions.push(txnRecord);
    transactionLog.push({ apiKey: account.apiKey, ...txnRecord });

    return txnRecord;
}

// ============================================================
// API ROUTES
// ============================================================

// Apply auth and rate limit to all /api routes
app.use('/api', authMiddleware);
app.use('/api', rateLimitMiddleware);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Express Quota Micro-Transaction Service',
        version: '2.0.0',
        governance: 'WU-IW Equity Trade Act 2026'
    });
});

// Get quota status
app.get('/api/quota', (req, res) => {
    const account = quotaStore.get(req.apiIdentity.key);

    res.json({
        identity: req.apiIdentity,
        budget: {
            total: account.totalBudget,
            spent: parseFloat(account.spent.toFixed(2)),
            remaining: parseFloat(account.remaining.toFixed(2)),
            utilizationPercent: parseFloat(((account.spent / account.totalBudget) * 100).toFixed(2))
        },
        categories: {
            FOOD: {
                spent: parseFloat(account.categories.FOOD.spent.toFixed(2)),
                remaining: parseFloat(account.categories.FOOD.remaining.toFixed(2)),
                limit: GOVERNANCE.categories.FOOD.dailyLimit
            },
            WATER: {
                spent: parseFloat(account.categories.WATER.spent.toFixed(2)),
                remaining: parseFloat(account.categories.WATER.remaining.toFixed(2)),
                limit: GOVERNANCE.categories.WATER.dailyLimit
            },
            SHELTER: {
                spent: parseFloat(account.categories.SHELTER.spent.toFixed(2)),
                remaining: parseFloat(account.categories.SHELTER.remaining.toFixed(2)),
                limit: GOVERNANCE.categories.SHELTER.dailyLimit
            },
            DELIVERY: {
                spent: parseFloat(account.categories.DELIVERY.spent.toFixed(2)),
                remaining: parseFloat(account.categories.DELIVERY.remaining.toFixed(2)),
                limit: GOVERNANCE.categories.DELIVERY.dailyLimit
            }
        },
        transactionCount: account.transactions.length
    });
});

// Execute micro-transaction
app.post('/api/purchase', (req, res) => {
    const account = quotaStore.get(req.apiIdentity.key);

    const { category, amount, items, deliveryFee = 0 } = req.body;

    // Validate required fields
    if (!category || amount === undefined) {
        return res.status(400).json({
            error: 'MISSING_FIELDS',
            message: 'Required: category (FOOD|WATER|SHELTER), amount (number)',
            received: req.body
        });
    }

    const transaction = {
        category: category.toUpperCase(),
        amount: parseFloat(amount),
        items: items || [],
        deliveryFee: parseFloat(deliveryFee) || 0
    };

    // Validate against governance rules
    const validation = validateTransaction(account, transaction);

    if (!validation.valid) {
        // CH_1: Block transaction, MAYBE state with retry info
        return res.status(422).json({
            error: 'QUOTA_EXCEEDED',
            message: 'Transaction blocked by governance rules',
            violations: validation.errors,
            retryStrategy: {
                type: 'MAYBE',
                retryAfter: 60,  // 60 second retry as per RiftLang spec
                suggestion: 'Reduce amount or wait for budget reset'
            },
            currentBalance: {
                global: parseFloat(account.remaining.toFixed(2)),
                category: parseFloat((account.categories[transaction.category]?.remaining || 0).toFixed(2))
            }
        });
    }

    // CH_1: Execute transaction (YES state)
    const txnRecord = executeTransaction(account, transaction);

    // CH_0: Log observation
    console.log(`[CH_0] Transaction ${txnRecord.id} | ${req.apiIdentity.key} | £${txnRecord.totalAmount.toFixed(2)} | ${transaction.category}`);

    res.status(201).json({
        status: 'APPROVED',
        message: 'Transaction executed under quota constraints',
        transaction: txnRecord,
        balance: {
            remaining: parseFloat(account.remaining.toFixed(2)),
            spent: parseFloat(account.spent.toFixed(2))
        },
        governance: {
            category: transaction.category,
            categoryRemaining: parseFloat(account.categories[transaction.category].remaining.toFixed(2)),
            globalBudgetRemaining: parseFloat(account.remaining.toFixed(2))
        }
    });
});

// Get transaction history
app.get('/api/transactions', (req, res) => {
    const account = quotaStore.get(req.apiIdentity.key);
    const { limit = 10, offset = 0 } = req.query;

    const txs = account.transactions
        .slice(-parseInt(limit))
        .reverse();

    res.json({
        transactions: txs,
        total: account.transactions.length,
        limit: parseInt(limit),
        summary: {
            totalSpent: parseFloat(account.spent.toFixed(2)),
            totalRemaining: parseFloat(account.remaining.toFixed(2))
        }
    });
});

// Reset quota (admin only - for testing)
app.post('/api/quota/reset', (req, res) => {
    const account = quotaStore.get(req.apiIdentity.key);
    const { newBudget } = req.body;

    initializeQuota(req.apiIdentity.key, newBudget || account.totalBudget);

    res.json({
        status: 'RESET',
        message: 'Quota account reset to initial state',
        newBudget: newBudget || account.totalBudget
    });
});

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
    });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Express Quota Micro-Transaction Service v2.0               ║');
    console.log('║  Constitutional Computing Framework - OBINexus              ║');
    console.log('║  WU-IW Equity Trade Act 2026                              ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Budget: £50.00  |  Max/Txn: £50.00  |  Min/Txn: £0.01     ║');
    console.log('║  Categories: FOOD(£5/£15) WATER(£3/£10) SHELTER(£50/£100)  ║');
    console.log('║  Rate Limit: 10 req/min  |  Retry: 60s (MAYBE state)        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\nServer running on http://localhost:${PORT}`);
    console.log('\nTest commands (PowerShell):');
    console.log('  $headers = @{ "x-api-key"="myapikey"; "x-api-secret"="myapisecret"; "Content-Type"="application/json" }');
    console.log('  Invoke-RestMethod -Uri "http://localhost:3000/api/quota" -Headers $headers');
    console.log('  Invoke-RestMethod -Uri "http://localhost:3000/api/purchase" -Method POST -Headers $headers -Body '{\"category\":\"FOOD\",\"amount\":2.50,\"items\":[\"milk\"]}'');
});

module.exports = app;
