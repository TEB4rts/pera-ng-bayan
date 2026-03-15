// intelligence/flags/procurement-flags.js
'use strict';

const db = require('../../db');
const logger = require('../../utils/logger');

/**
 * ProcurementFlagEngine
 *
 * Runs all procurement anomaly detection rules against the database.
 * Each rule returns a list of flagged transactions with reasons.
 *
 * Based on patterns from COA audit reports, Ombudsman cases,
 * and PCIJ investigative methodology.
 */
class ProcurementFlagEngine {
  constructor() {
    this.rules = [
      this.checkSingleBidder,
      this.checkRapidAward,
      this.checkNewVendor,
      this.checkContractSplitting,
      this.checkConsecutiveSoleSource,
      this.checkEndOfYearRush,
      this.checkAbcProximity,
      this.checkResidentialVendor,
      this.checkRepeatingVendorConcentration,
      this.checkNoCompetitionJustification,
    ];
  }

  async runAll() {
    logger.info('🔍 Running procurement flag analysis...');
    const allFlags = [];

    for (const rule of this.rules) {
      try {
        const flags = await rule.call(this);
        allFlags.push(...flags);
        logger.info(`  ✅ ${rule.name}: ${flags.length} flags`);
      } catch (err) {
        logger.error(`  ❌ ${rule.name} failed: ${err.message}`);
      }
    }

    await db.upsertFlags(allFlags);
    logger.success(`✅ Procurement analysis complete: ${allFlags.length} total flags`);
    return allFlags;
  }

  /**
   * Rule 1: Single bidder on competitive procurement
   * When only one vendor submits a bid on a public bidding,
   * it strongly suggests collusion or advance information sharing.
   */
  async checkSingleBidder() {
    const contracts = await db.query(`
      SELECT * FROM transactions
      WHERE flags_single_bidder = 1
      AND contract_procurement_mode = 'PUBLIC_BIDDING'
      AND amount_awarded_amount > 1000000
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'SINGLE_BIDDER',
      severity: c.amount_awarded_amount > 50000000 ? 'critical' : 'high',
      title: 'Single bidder on competitive procurement',
      description: `Only one bidder submitted for a ₱${formatAmount(c.amount_awarded_amount)} contract that required public bidding. This is a strong indicator of bid-fixing or advance information sharing.`,
      recommendation: 'Request COA audit. Verify if vendor had advance knowledge. Check if same vendor wins repeatedly.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }

  /**
   * Rule 2: Rapid award — bid opening to award less than 7 days
   * RA 9184 and its IRR require minimum evaluation periods.
   * Awards made in less than 7 days suggest pre-selected vendors.
   */
  async checkRapidAward() {
    const contracts = await db.query(`
      SELECT *,
        JULIANDAY(contract_award_date) - JULIANDAY(contract_opening_date) as days_to_award
      FROM transactions
      WHERE contract_opening_date IS NOT NULL
      AND contract_award_date IS NOT NULL
      AND JULIANDAY(contract_award_date) - JULIANDAY(contract_opening_date) < 7
      AND amount_awarded_amount > 500000
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'RAPID_AWARD',
      severity: 'high',
      title: 'Award made less than 7 days after bid opening',
      description: `Contract awarded only ${c.days_to_award} day(s) after bid opening. RA 9184 requires a minimum evaluation period. This speed suggests a pre-selected vendor.`,
      recommendation: 'Request BAC resolution and evaluation documents via FOI.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }

  /**
   * Rule 3: New vendor wins large contract
   * Vendors registered less than 6 months before winning contracts
   * above ₱5M are high risk — no track record, possible shell company.
   */
  async checkNewVendor() {
    const contracts = await db.query(`
      SELECT t.*, v.registration_date
      FROM transactions t
      JOIN vendors v ON t.vendor_name = v.name
      WHERE v.registration_date IS NOT NULL
      AND t.amount_awarded_amount > 5000000
      AND (JULIANDAY(t.contract_award_date) - JULIANDAY(v.registration_date)) < 180
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'NEW_VENDOR',
      severity: c.amount_awarded_amount > 50000000 ? 'critical' : 'high',
      title: 'New vendor wins large contract',
      description: `Vendor "${c.vendor_name}" was registered less than 6 months before winning a ₱${formatAmount(c.amount_awarded_amount)} contract. No track record to verify capability.`,
      recommendation: 'Verify vendor\'s business registration, financial capacity, and technical qualifications. Check if related to any government official.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }

  /**
   * Rule 4: Contract splitting
   * Breaking large contracts into smaller ones just below ₱1M
   * (the threshold for public bidding) to avoid competitive procurement.
   * Classic "palusot" — classic workaround.
   */
  async checkContractSplitting() {
    const suspiciousGroups = await db.query(`
      SELECT
        agency_name,
        vendor_name,
        COUNT(*) as contract_count,
        SUM(amount_awarded_amount) as total_amount,
        MIN(amount_awarded_amount) as min_contract,
        MAX(amount_awarded_amount) as max_contract,
        MIN(contract_award_date) as first_date,
        MAX(contract_award_date) as last_date
      FROM transactions
      WHERE contract_procurement_mode IN ('SMALL_VALUE', 'NEGOTIATED')
      AND amount_awarded_amount BETWEEN 500000 AND 999999
      GROUP BY agency_name, vendor_name
      HAVING contract_count >= 3
      AND (JULIANDAY(last_date) - JULIANDAY(first_date)) < 90
      ORDER BY total_amount DESC
    `);

    return suspiciousGroups.map(g => ({
      transactionId: `SPLIT-${g.agency_name}-${g.vendor_name}`.replace(/\s/g, '-'),
      ruleId: 'CONTRACT_SPLITTING',
      severity: g.total_amount > 10000000 ? 'critical' : 'high',
      title: 'Possible contract splitting to avoid public bidding',
      description: `Agency awarded ${g.contract_count} contracts to "${g.vendor_name}" worth ₱${formatAmount(g.total_amount)} total — all below the ₱1M public bidding threshold, within 90 days. Combined amount would have required competitive bidding.`,
      recommendation: 'File COA complaint. Request all Purchase Orders via FOI. Verify if projects are related.',
      detectedAt: new Date().toISOString(),
      agencyName: g.agency_name,
      vendorName: g.vendor_name,
      amount: g.total_amount,
    }));
  }

  /**
   * Rule 5: Consecutive sole-source to same vendor
   * Agency repeatedly using non-competitive modes for same vendor.
   */
  async checkConsecutiveSoleSource() {
    const groups = await db.query(`
      SELECT
        agency_name,
        vendor_name,
        COUNT(*) as sole_source_count,
        SUM(amount_awarded_amount) as total_amount
      FROM transactions
      WHERE contract_procurement_mode IN ('SOLE_SOURCE', 'DIRECT_CONTRACTING', 'NEGOTIATED')
      AND contract_award_date >= date('now', '-1 year')
      GROUP BY agency_name, vendor_name
      HAVING sole_source_count >= 3
      ORDER BY total_amount DESC
    `);

    return groups.map(g => ({
      transactionId: `SOLE-${g.agency_name}-${g.vendor_name}`.replace(/\s/g, '-'),
      ruleId: 'CONSECUTIVE_SOLE_SOURCE',
      severity: g.total_amount > 20000000 ? 'critical' : 'high',
      title: 'Repeated sole-source awards to same vendor',
      description: `"${g.agency_name}" awarded ${g.sole_source_count} non-competitive contracts to "${g.vendor_name}" totaling ₱${formatAmount(g.total_amount)} in the past year. Pattern suggests preferred vendor relationship.`,
      recommendation: 'Verify sole-source justifications. Check if public bidding should have been conducted. Audit the BAC.',
      detectedAt: new Date().toISOString(),
      agencyName: g.agency_name,
      vendorName: g.vendor_name,
      amount: g.total_amount,
    }));
  }

  /**
   * Rule 6: End-of-year spending rush
   * Large contracts in November-December suggest "use it or lose it"
   * budget padding — less scrutiny, rushed procurement.
   */
  async checkEndOfYearRush() {
    const contracts = await db.query(`
      SELECT *
      FROM transactions
      WHERE strftime('%m', contract_award_date) IN ('11', '12')
      AND amount_awarded_amount > 10000000
      AND contract_procurement_mode IN ('NEGOTIATED', 'DIRECT_CONTRACTING', 'EMERGENCY')
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'END_OF_YEAR_RUSH',
      severity: 'medium',
      title: 'Large non-competitive contract awarded in November/December',
      description: `₱${formatAmount(c.amount_awarded_amount)} contract awarded in the last quarter via ${c.contract_procurement_mode}. End-of-year rush procurement is a recognized corruption risk.`,
      recommendation: 'Verify urgency justification. Check if similar needs existed earlier in the year.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }

  /**
   * Rule 7: ABC proximity — awarded amount within 0.5% of ABC
   * In honest competitive bidding, awards cluster below ABC.
   * Awards at exactly 99.5-100% of ABC = classic bid-fixing.
   */
  async checkAbcProximity() {
    const contracts = await db.query(`
      SELECT *,
        (amount_awarded_amount / NULLIF(amount_approved_budget, 0) * 100) as pct_of_abc
      FROM transactions
      WHERE amount_approved_budget > 1000000
      AND amount_awarded_amount > 0
      AND (amount_awarded_amount / NULLIF(amount_approved_budget, 0)) BETWEEN 0.995 AND 1.001
      AND contract_procurement_mode = 'PUBLIC_BIDDING'
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'ABC_PROXIMITY',
      severity: 'high',
      title: 'Award suspiciously close to approved budget ceiling',
      description: `Awarded amount (₱${formatAmount(c.amount_awarded_amount)}) is ${c.pct_of_abc.toFixed(2)}% of the ABC (₱${formatAmount(c.amount_approved_budget)}). In genuine competition, bids come in significantly below ABC. This pattern suggests the bidder knew the exact budget.`,
      recommendation: 'Review BAC minutes. Check if bid documents were leaked. Verify if other bidders submitted.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }

  /**
   * Rule 8: Residential vendor address
   * Vendors with residential addresses winning large government contracts
   * are likely shell companies or dummies.
   */
  async checkResidentialVendor() {
    const contracts = await db.query(`
      SELECT t.*, v.address
      FROM transactions t
      JOIN vendors v ON t.vendor_name = v.name
      WHERE t.amount_awarded_amount > 5000000
      AND (
        v.address LIKE '%Brgy%'
        OR v.address LIKE '%Barangay%'
        OR v.address LIKE '%Subd%'
        OR v.address LIKE '%Village%'
        OR v.address LIKE '%Blk%Block%'
      )
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'RESIDENTIAL_VENDOR',
      severity: 'high',
      title: 'Vendor appears to use residential address',
      description: `"${c.vendor_name}" (address: ${c.vendor_address}) won a ₱${formatAmount(c.amount_awarded_amount)} contract. Residential addresses suggest the vendor may be a shell company or dummy corporation.`,
      recommendation: 'Verify business registration with SEC and BNRS. Check if address is a real commercial establishment.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }

  /**
   * Rule 9: Vendor concentration — one vendor dominates agency
   * If one vendor wins >50% of an agency's total contracts,
   * it suggests a preferred vendor relationship or corruption.
   */
  async checkRepeatingVendorConcentration() {
    const concentration = await db.query(`
      SELECT
        t.agency_name,
        t.vendor_name,
        SUM(t.amount_awarded_amount) as vendor_total,
        agency_totals.total as agency_total,
        (SUM(t.amount_awarded_amount) / agency_totals.total * 100) as concentration_pct
      FROM transactions t
      JOIN (
        SELECT agency_name, SUM(amount_awarded_amount) as total
        FROM transactions
        WHERE contract_award_date >= date('now', '-1 year')
        GROUP BY agency_name
        HAVING total > 10000000
      ) agency_totals ON t.agency_name = agency_totals.agency_name
      WHERE t.contract_award_date >= date('now', '-1 year')
      GROUP BY t.agency_name, t.vendor_name
      HAVING concentration_pct > 40
      ORDER BY concentration_pct DESC
    `);

    return concentration.map(c => ({
      transactionId: `CONC-${c.agency_name}-${c.vendor_name}`.replace(/\s/g, '-'),
      ruleId: 'VENDOR_CONCENTRATION',
      severity: c.concentration_pct > 70 ? 'critical' : 'high',
      title: 'One vendor dominates agency procurement',
      description: `"${c.vendor_name}" received ${c.concentration_pct.toFixed(1)}% (₱${formatAmount(c.vendor_total)}) of "${c.agency_name}"'s total procurement in the past year. Extreme vendor concentration is a strong indicator of a preferred vendor relationship.`,
      recommendation: 'Audit all BAC decisions. Check for conflict of interest. Review if competition was genuine.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.vendor_total,
    }));
  }

  /**
   * Rule 10: No justification for non-competitive procurement
   */
  async checkNoCompetitionJustification() {
    const contracts = await db.query(`
      SELECT *
      FROM transactions
      WHERE contract_procurement_mode IN ('SOLE_SOURCE', 'DIRECT_CONTRACTING')
      AND amount_awarded_amount > 5000000
      AND (flags_no_justification = 1 OR contract_justification IS NULL OR contract_justification = '')
    `);

    return contracts.map(c => ({
      transactionId: c.id,
      ruleId: 'NO_JUSTIFICATION',
      severity: 'high',
      title: 'Non-competitive procurement with no justification on file',
      description: `₱${formatAmount(c.amount_awarded_amount)} contract awarded via ${c.contract_procurement_mode} with no justification document on record in PhilGEPS. RA 9184 requires documented justification for all non-competitive procurement.`,
      recommendation: 'Request justification documents via FOI. File COA complaint if no justification exists.',
      detectedAt: new Date().toISOString(),
      agencyName: c.agency_name,
      vendorName: c.vendor_name,
      amount: c.amount_awarded_amount,
    }));
  }
}

function formatAmount(amount) {
  if (!amount) return '0';
  if (amount >= 1000000000) return `${(amount / 1000000000).toFixed(2)}B`;
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(0)}K`;
  return amount.toLocaleString();
}

module.exports = ProcurementFlagEngine;
