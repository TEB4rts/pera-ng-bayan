// api/server.js
'use strict';

const express = require('express');
const cors = require('cors');
const db = require('../db');
const logger = require('../utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Request logging ──────────────────────────────────────
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ── Health check ──────────────────────────────────────────
app.get('/health', (req, res) => {
  const stats = db.getStats();
  res.json({ status: 'ok', ...stats, timestamp: new Date().toISOString() });
});

// ── Contracts ─────────────────────────────────────────────
app.get('/api/v1/contracts', (req, res) => {
  const {
    agency, vendor, region, year, min, max,
    mode, flagged, category, page = 1, limit = 50,
  } = req.query;

  const conditions = [];
  const params = [];

  if (agency) { conditions.push('agency_code = ?'); params.push(agency.toUpperCase()); }
  if (vendor) { conditions.push('vendor_name LIKE ?'); params.push(`%${vendor}%`); }
  if (region) { conditions.push('contract_location_region = ?'); params.push(region); }
  if (year) { conditions.push('amount_fiscal_year = ?'); params.push(parseInt(year)); }
  if (min) { conditions.push('amount_awarded_amount >= ?'); params.push(parseFloat(min)); }
  if (max) { conditions.push('amount_awarded_amount <= ?'); params.push(parseFloat(max)); }
  if (mode) { conditions.push('contract_procurement_mode = ?'); params.push(mode.toUpperCase()); }
  if (category) { conditions.push('contract_category = ?'); params.push(category); }
  if (flagged === 'true') {
    conditions.push(`(flags_single_bidder = 1 OR flags_rapid_award = 1 OR 
      flags_above_price_guide = 1 OR flags_contract_splitting = 1)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const contracts = db.query(
    `SELECT * FROM transactions ${where} ORDER BY contract_award_date DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );

  const total = db.queryOne(
    `SELECT COUNT(*) as n FROM transactions ${where}`,
    params
  )?.n || 0;

  res.json({
    data: contracts,
    meta: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

app.get('/api/v1/contracts/:id', (req, res) => {
  const contract = db.queryOne('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // Get related flags
  const flags = db.query('SELECT * FROM flags WHERE transaction_id = ?', [req.params.id]);

  // Get COA findings for this agency
  const coaFindings = db.query(
    'SELECT * FROM coa_findings WHERE agency_name = ? AND report_year >= ?',
    [contract.agency_name, (contract.amount_fiscal_year || 2020) - 1]
  );

  res.json({ ...contract, flags, coaFindings });
});

// ── Vendors ───────────────────────────────────────────────
app.get('/api/v1/vendors/:name/contracts', (req, res) => {
  const vendorName = decodeURIComponent(req.params.name);
  const contracts = db.query(
    `SELECT * FROM transactions WHERE vendor_name LIKE ? ORDER BY contract_award_date DESC LIMIT 100`,
    [`%${vendorName}%`]
  );

  const stats = db.queryOne(
    `SELECT COUNT(*) as total_contracts, SUM(amount_awarded_amount) as total_amount,
     COUNT(DISTINCT agency_name) as agencies_count,
     MIN(contract_award_date) as first_contract, MAX(contract_award_date) as last_contract
     FROM transactions WHERE vendor_name LIKE ?`,
    [`%${vendorName}%`]
  );

  const flags = db.query(
    'SELECT * FROM flags WHERE vendor_name LIKE ? ORDER BY detected_at DESC',
    [`%${vendorName}%`]
  );

  res.json({ vendor: vendorName, stats, contracts, flags });
});

// ── Agencies ──────────────────────────────────────────────
app.get('/api/v1/agencies', (req, res) => {
  const agencies = db.query(`
    SELECT 
      agency_code,
      agency_name,
      COUNT(*) as contract_count,
      SUM(amount_awarded_amount) as total_amount,
      COUNT(DISTINCT vendor_name) as unique_vendors,
      SUM(flags_single_bidder + flags_rapid_award + flags_above_price_guide) as total_flags,
      MAX(contract_award_date) as last_activity
    FROM transactions
    GROUP BY agency_code, agency_name
    ORDER BY total_amount DESC
  `);
  res.json({ data: agencies });
});

app.get('/api/v1/agencies/:code', (req, res) => {
  const code = req.params.code.toUpperCase();

  const summary = db.queryOne(`
    SELECT agency_code, agency_name,
      COUNT(*) as contract_count,
      SUM(amount_awarded_amount) as total_amount,
      COUNT(DISTINCT vendor_name) as unique_vendors,
      AVG(amount_awarded_amount) as avg_contract_amount,
      SUM(CASE WHEN contract_procurement_mode = 'PUBLIC_BIDDING' THEN 1 ELSE 0 END) as competitive_count,
      SUM(CASE WHEN contract_procurement_mode != 'PUBLIC_BIDDING' THEN 1 ELSE 0 END) as non_competitive_count
    FROM transactions WHERE agency_code = ?
  `, [code]);

  if (!summary) return res.status(404).json({ error: 'Agency not found' });

  const topVendors = db.query(`
    SELECT vendor_name, COUNT(*) as contracts, SUM(amount_awarded_amount) as total
    FROM transactions WHERE agency_code = ?
    GROUP BY vendor_name ORDER BY total DESC LIMIT 10
  `, [code]);

  const coaFindings = db.query(
    'SELECT * FROM coa_findings WHERE agency_name LIKE ? ORDER BY report_year DESC',
    [`%${code}%`]
  );

  const recentFlags = db.query(
    'SELECT * FROM flags WHERE agency_name LIKE ? ORDER BY detected_at DESC LIMIT 20',
    [`%${code}%`]
  );

  res.json({ summary, topVendors, coaFindings, recentFlags });
});

// ── Flags ─────────────────────────────────────────────────
app.get('/api/v1/flags', (req, res) => {
  const { severity, rule, agency, status = 'OPEN', since, page = 1, limit = 50 } = req.query;

  const conditions = [`status = ?`];
  const params = [status];

  if (severity) { conditions.push('severity = ?'); params.push(severity); }
  if (rule) { conditions.push('rule_id = ?'); params.push(rule.toUpperCase()); }
  if (agency) { conditions.push('agency_name LIKE ?'); params.push(`%${agency}%`); }
  if (since) {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(since));
    conditions.push('detected_at >= ?');
    params.push(daysAgo.toISOString());
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const flags = db.query(
    `SELECT * FROM flags ${where} ORDER BY 
     CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
     detected_at DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );

  const total = db.queryOne(`SELECT COUNT(*) as n FROM flags ${where}`, params)?.n || 0;

  res.json({ data: flags, meta: { total, page: parseInt(page), limit: parseInt(limit) } });
});

// ── Natural language search ───────────────────────────────
app.post('/api/v1/query', (req, res) => {
  const { q } = req.body;
  if (!q) return res.status(400).json({ error: 'Query required' });

  // Simple keyword extraction — in production, use an LLM
  const results = simpleNLQuery(q);
  res.json(results);
});

function simpleNLQuery(query) {
  const q = query.toLowerCase();

  // Extract agency
  const agencyMatch = q.match(/\b(dpwh|doh|deped|dswd|dilg|da|dnd|dof|pcso|philhealth)\b/i);
  const yearMatch = q.match(/\b(20\d{2})\b/);
  const amountMatch = q.match(/(?:over|above|more than)\s*₱?([\d,]+)\s*(million|billion|m|b)?/i);

  const conditions = [];
  const params = [];

  if (agencyMatch) { conditions.push('agency_code = ?'); params.push(agencyMatch[1].toUpperCase()); }
  if (yearMatch) { conditions.push('amount_fiscal_year = ?'); params.push(parseInt(yearMatch[1])); }

  if (q.includes('flagged') || q.includes('suspicious')) {
    conditions.push('(flags_single_bidder = 1 OR flags_rapid_award = 1)');
  }
  if (q.includes('single bidder')) {
    conditions.push('flags_single_bidder = 1');
  }
  if (q.includes('sole source')) {
    conditions.push('contract_procurement_mode IN ("SOLE_SOURCE", "DIRECT_CONTRACTING")');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const contracts = db.query(
    `SELECT * FROM transactions ${where} ORDER BY amount_awarded_amount DESC LIMIT 20`,
    params
  );

  const total = db.queryOne(
    `SELECT COUNT(*) as n, SUM(amount_awarded_amount) as total FROM transactions ${where}`,
    params
  );

  return {
    query,
    interpretation: { agency: agencyMatch?.[1], year: yearMatch?.[1] },
    summary: total,
    results: contracts,
  };
}

// ── Statistics / Dashboard ────────────────────────────────
app.get('/api/v1/stats', (req, res) => {
  const stats = db.getStats();

  const byAgency = db.query(`
    SELECT agency_code, SUM(amount_awarded_amount) as total
    FROM transactions GROUP BY agency_code ORDER BY total DESC LIMIT 10
  `);

  const byMode = db.query(`
    SELECT contract_procurement_mode, COUNT(*) as count, SUM(amount_awarded_amount) as total
    FROM transactions GROUP BY contract_procurement_mode ORDER BY total DESC
  `);

  const byYear = db.query(`
    SELECT amount_fiscal_year, COUNT(*) as count, SUM(amount_awarded_amount) as total
    FROM transactions WHERE amount_fiscal_year IS NOT NULL
    GROUP BY amount_fiscal_year ORDER BY amount_fiscal_year DESC
  `);

  const recentFlags = db.query(`
    SELECT * FROM flags WHERE status = 'OPEN'
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END
    LIMIT 5
  `);

  res.json({ stats, byAgency, byMode, byYear, recentFlags });
});

// ── Start server ──────────────────────────────────────────
app.listen(PORT, () => {
  logger.success(`\n⚖️  Pera ng Bayan API running at http://localhost:${PORT}`);
  logger.info(`   Health: http://localhost:${PORT}/health`);
  logger.info(`   Contracts: http://localhost:${PORT}/api/v1/contracts`);
  logger.info(`   Flags: http://localhost:${PORT}/api/v1/flags`);
});

module.exports = app;
