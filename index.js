// db/index.js
// SQLite database layer for Pera ng Bayan
// Using SQLite for zero-dependency, single-file database
// Easily upgradeable to PostgreSQL for production

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/pera-ng-bayan.db');
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db) {
  db.exec(`
    -- Core transactions table
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_reference_number TEXT,
      jurisdiction TEXT DEFAULT 'PH-National',
      source_url TEXT,

      -- Agency
      agency_name TEXT,
      agency_code TEXT,
      agency_region TEXT,

      -- Vendor
      vendor_name TEXT,
      vendor_tin TEXT,
      vendor_philgeps_id TEXT,
      vendor_address TEXT,

      -- Amounts
      amount_approved_budget REAL DEFAULT 0,
      amount_awarded_amount REAL DEFAULT 0,
      amount_disbursed REAL DEFAULT 0,
      amount_variance_pct REAL,
      amount_currency TEXT DEFAULT 'PHP',
      amount_fiscal_year INTEGER,
      amount_quantity REAL,

      -- Contract
      contract_title TEXT,
      contract_procurement_mode TEXT,
      contract_procurement_mode_raw TEXT,
      contract_category TEXT,
      contract_award_date TEXT,
      contract_opening_date TEXT,
      contract_publish_date TEXT,
      contract_justification TEXT,
      contract_location_region TEXT,
      contract_location_province TEXT,
      contract_location_municipality TEXT,
      contract_location_barangay TEXT,
      contract_coordinates TEXT,

      -- Flags (computed by intelligence layer)
      flags_single_bidder INTEGER DEFAULT 0,
      flags_rapid_award INTEGER DEFAULT 0,
      flags_new_vendor INTEGER DEFAULT 0,
      flags_above_price_guide INTEGER DEFAULT 0,
      flags_coa_finding_exists INTEGER DEFAULT 0,
      flags_contract_splitting INTEGER DEFAULT 0,
      flags_sole_source INTEGER DEFAULT 0,
      flags_no_justification INTEGER DEFAULT 0,
      flags_ghost_project_risk INTEGER DEFAULT 0,
      flags_political_connection INTEGER DEFAULT 0,

      -- Metadata
      ingested_at TEXT DEFAULT (datetime('now')),
      last_updated TEXT DEFAULT (datetime('now')),
      raw_data TEXT  -- JSON blob of original data
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_transactions_agency ON transactions(agency_code);
    CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions(vendor_name);
    CREATE INDEX IF NOT EXISTS idx_transactions_award_date ON transactions(contract_award_date);
    CREATE INDEX IF NOT EXISTS idx_transactions_fiscal_year ON transactions(amount_fiscal_year);
    CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount_awarded_amount);
    CREATE INDEX IF NOT EXISTS idx_transactions_region ON transactions(contract_location_region);
    CREATE INDEX IF NOT EXISTS idx_transactions_procurement_mode ON transactions(contract_procurement_mode);

    -- Vendors table
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      tin TEXT,
      philgeps_id TEXT,
      sec_registration TEXT,
      address TEXT,
      classification TEXT,
      registration_date TEXT,
      last_active TEXT,
      total_contracts INTEGER DEFAULT 0,
      total_amount REAL DEFAULT 0,
      flags TEXT, -- JSON array of flag IDs
      ingested_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(name);
    CREATE INDEX IF NOT EXISTS idx_vendors_tin ON vendors(tin);

    -- COA findings
    CREATE TABLE IF NOT EXISTS coa_findings (
      id TEXT PRIMARY KEY,
      source TEXT DEFAULT 'coa.gov.ph',
      agency_name TEXT,
      report_year INTEGER,
      report_url TEXT,
      finding_type TEXT,
      severity TEXT,
      description TEXT,
      amount REAL,
      status TEXT DEFAULT 'OPEN',
      related_transaction_id TEXT,
      extracted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (related_transaction_id) REFERENCES transactions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_coa_agency ON coa_findings(agency_name);
    CREATE INDEX IF NOT EXISTS idx_coa_type ON coa_findings(finding_type);
    CREATE INDEX IF NOT EXISTS idx_coa_year ON coa_findings(report_year);

    -- Anomaly flags
    CREATE TABLE IF NOT EXISTS flags (
      id TEXT PRIMARY KEY,
      transaction_id TEXT,
      rule_id TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      title TEXT NOT NULL,
      description TEXT,
      recommendation TEXT,
      agency_name TEXT,
      vendor_name TEXT,
      amount REAL,
      overpricing_amount REAL,
      status TEXT DEFAULT 'OPEN',
      detected_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_flags_severity ON flags(severity);
    CREATE INDEX IF NOT EXISTS idx_flags_rule ON flags(rule_id);
    CREATE INDEX IF NOT EXISTS idx_flags_agency ON flags(agency_name);
    CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);

    -- DBM budget data
    CREATE TABLE IF NOT EXISTS budget_data (
      id TEXT PRIMARY KEY,
      agency_name TEXT,
      agency_code TEXT,
      fiscal_year INTEGER,
      appropriation REAL,
      allotment REAL,
      obligation REAL,
      disbursement REAL,
      program TEXT,
      purpose TEXT,
      fund_source TEXT,
      ingested_at TEXT DEFAULT (datetime('now'))
    );

    -- Political connections
    CREATE TABLE IF NOT EXISTS political_connections (
      id TEXT PRIMARY KEY,
      official_name TEXT,
      position TEXT,
      district TEXT,
      region TEXT,
      party TEXT,
      vendor_name TEXT,
      connection_type TEXT, -- DONOR, RELATIVE, ASSOCIATE, SAME_ADDRESS
      evidence TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Ingestion log
    CREATE TABLE IF NOT EXISTS ingestion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      started_at TEXT,
      completed_at TEXT,
      records_ingested INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_message TEXT
    );
  `);
}

// ── Query helpers ──────────────────────────────────────────

const db = {
  query(sql, params = []) {
    try {
      return getDb().prepare(sql).all(...(Array.isArray(params) ? params : [params]));
    } catch (err) {
      throw new Error(`DB query failed: ${err.message}\nSQL: ${sql}`);
    }
  },

  queryOne(sql, params = []) {
    try {
      return getDb().prepare(sql).get(...(Array.isArray(params) ? params : [params]));
    } catch (err) {
      throw new Error(`DB queryOne failed: ${err.message}`);
    }
  },

  upsertTransactions(transactions) {
    const stmt = getDb().prepare(`
      INSERT INTO transactions (
        id, source, source_reference_number, jurisdiction, source_url,
        agency_name, agency_code, agency_region,
        vendor_name, vendor_tin, vendor_philgeps_id, vendor_address,
        amount_approved_budget, amount_awarded_amount, amount_variance_pct,
        amount_currency, amount_fiscal_year,
        contract_title, contract_procurement_mode, contract_procurement_mode_raw,
        contract_category, contract_award_date, contract_opening_date,
        contract_publish_date, contract_justification,
        contract_location_region, contract_location_province,
        contract_location_municipality, contract_location_barangay,
        flags_single_bidder, flags_rapid_award, flags_sole_source,
        last_updated
      ) VALUES (
        @id, @source, @sourceReferenceNumber, @jurisdiction, @sourceUrl,
        @agencyName, @agencyCode, @agencyRegion,
        @vendorName, @vendorTin, @vendorPhilgepsId, @vendorAddress,
        @amountApprovedBudget, @amountAwardedAmount, @amountVariancePct,
        @amountCurrency, @amountFiscalYear,
        @contractTitle, @contractProcurementMode, @contractProcurementModeRaw,
        @contractCategory, @contractAwardDate, @contractOpeningDate,
        @contractPublishDate, @contractJustification,
        @contractLocationRegion, @contractLocationProvince,
        @contractLocationMunicipality, @contractLocationBarangay,
        @flagsSingleBidder, @flagsRapidAward, @flagsSoleSource,
        datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        amount_awarded_amount = excluded.amount_awarded_amount,
        last_updated = excluded.last_updated
    `);

    const insertMany = getDb().transaction((items) => {
      for (const t of items) {
        stmt.run({
          id: t.id,
          source: t.source,
          sourceReferenceNumber: t.sourceReferenceNumber,
          jurisdiction: t.jurisdiction,
          sourceUrl: t.sourceUrl,
          agencyName: t.agency?.name,
          agencyCode: t.agency?.code,
          agencyRegion: t.agency?.region,
          vendorName: t.vendor?.name,
          vendorTin: t.vendor?.tin,
          vendorPhilgepsId: t.vendor?.philgepsRegistration,
          vendorAddress: t.vendor?.address,
          amountApprovedBudget: t.amount?.approvedBudget || 0,
          amountAwardedAmount: t.amount?.awardedAmount || 0,
          amountVariancePct: t.amount?.variancePercent,
          amountCurrency: t.amount?.currency || 'PHP',
          amountFiscalYear: t.amount?.fiscalYear,
          contractTitle: t.contract?.title,
          contractProcurementMode: t.contract?.procurementMode,
          contractProcurementModeRaw: t.contract?.procurementModeRaw,
          contractCategory: t.contract?.category,
          contractAwardDate: t.contract?.awardDate,
          contractOpeningDate: t.contract?.openingDate,
          contractPublishDate: t.contract?.publishDate,
          contractJustification: t.contract?.justification,
          contractLocationRegion: t.contract?.location?.region,
          contractLocationProvince: t.contract?.location?.province,
          contractLocationMunicipality: t.contract?.location?.municipality,
          contractLocationBarangay: t.contract?.location?.barangay,
          flagsSingleBidder: t.flags?.singleBidder ? 1 : 0,
          flagsRapidAward: t.flags?.rapidAward ? 1 : 0,
          flagsSoleSource: t.flags?.solSource ? 1 : 0,
        });
      }
    });

    insertMany(transactions);
    return transactions.length;
  },

  upsertFlags(flags) {
    const stmt = getDb().prepare(`
      INSERT OR REPLACE INTO flags (
        id, transaction_id, rule_id, severity, title,
        description, recommendation, agency_name, vendor_name,
        amount, overpricing_amount, detected_at
      ) VALUES (
        @id, @transactionId, @ruleId, @severity, @title,
        @description, @recommendation, @agencyName, @vendorName,
        @amount, @overpricingAmount, @detectedAt
      )
    `);

    const insertMany = getDb().transaction((items) => {
      for (const f of items) {
        stmt.run({
          ...f,
          id: f.id || `FLAG-${f.ruleId}-${f.transactionId || Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          overpricingAmount: f.overpricingAmount || null,
        });
      }
    });

    insertMany(flags);
  },

  upsertCoaFindings(findings) {
    const stmt = getDb().prepare(`
      INSERT OR REPLACE INTO coa_findings (
        id, source, agency_name, report_year, report_url,
        finding_type, severity, description, amount, status, extracted_at
      ) VALUES (
        @id, @source, @agencyName, @reportYear, @reportUrl,
        @findingType, @severity, @description, @amount, @status, @extractedAt
      )
    `);

    const insertMany = getDb().transaction((items) => {
      for (const f of items) stmt.run(f);
    });

    insertMany(findings);
  },

  getStats() {
    return {
      totalTransactions: this.queryOne('SELECT COUNT(*) as n FROM transactions')?.n || 0,
      totalAmount: this.queryOne('SELECT SUM(amount_awarded_amount) as n FROM transactions')?.n || 0,
      totalFlags: this.queryOne('SELECT COUNT(*) as n FROM flags WHERE status = "OPEN"')?.n || 0,
      criticalFlags: this.queryOne('SELECT COUNT(*) as n FROM flags WHERE severity = "critical" AND status = "OPEN"')?.n || 0,
      totalCoaFindings: this.queryOne('SELECT COUNT(*) as n FROM coa_findings')?.n || 0,
      lastUpdated: this.queryOne('SELECT MAX(last_updated) as n FROM transactions')?.n,
    };
  },
};

module.exports = db;
