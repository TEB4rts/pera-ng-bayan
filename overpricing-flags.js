// intelligence/flags/overpricing-flags.js
'use strict';

const db = require('../../db');
const logger = require('../../utils/logger');

/**
 * OvepricingFlagEngine
 *
 * Detects overpriced government procurement by comparing
 * awarded amounts against:
 * 1. DBM Price Guide (official government price reference)
 * 2. PhilHealth Drug Formulary (for medicines)
 * 3. Regional infrastructure cost benchmarks
 * 4. Market retail prices for common items
 */

// DBM Price Guide benchmarks (simplified — full list in price-guide/dbm-prices.js)
const DBM_PRICE_GUIDE = {
  // IT Equipment (₱ per unit)
  'laptop': { max: 60000, unit: 'unit' },
  'desktop': { max: 45000, unit: 'unit' },
  'printer': { max: 25000, unit: 'unit' },
  'projector': { max: 35000, unit: 'unit' },
  'tablet': { max: 30000, unit: 'unit' },
  'cctv': { max: 8000, unit: 'unit' },

  // Vehicles (₱ per unit)
  'ambulance': { max: 3500000, unit: 'unit' },
  'patrol car': { max: 1800000, unit: 'unit' },
  'dump truck': { max: 3000000, unit: 'unit' },
  'fire truck': { max: 8000000, unit: 'unit' },

  // Common supplies
  'bond paper': { max: 250, unit: 'ream' },
  'ballpen': { max: 12, unit: 'piece' },
  'face mask': { max: 45, unit: 'piece' },
};

// Infrastructure cost benchmarks (₱ per unit, regional average)
const INFRASTRUCTURE_BENCHMARKS = {
  'road_concrete_km': { max: 15000000, unit: 'km' },         // ₱15M per km concrete road
  'road_asphalt_km': { max: 12000000, unit: 'km' },          // ₱12M per km asphalt road
  'school_building_classroom': { max: 2500000, unit: 'classroom' }, // ₱2.5M per classroom
  'health_center_sqm': { max: 25000, unit: 'sqm' },          // ₱25K per sqm health center
  'footbridge': { max: 5000000, unit: 'unit' },              // ₱5M per footbridge
  'flood_control_lm': { max: 50000, unit: 'linear meter' },  // ₱50K per linear meter flood control
};

class OvepricingFlagEngine {
  async runAll() {
    logger.info('💰 Running overpricing analysis...');
    const flags = [];

    flags.push(...await this.checkAgainstDbmPriceGuide());
    flags.push(...await this.checkInfrastructureCosts());
    flags.push(...await this.checkMedicinePrices());
    flags.push(...await this.checkSchoolBuildingCosts());

    await db.upsertFlags(flags);
    logger.success(`✅ Overpricing analysis: ${flags.length} flags`);
    return flags;
  }

  async checkAgainstDbmPriceGuide() {
    const flags = [];

    for (const [item, guide] of Object.entries(DBM_PRICE_GUIDE)) {
      const contracts = await db.query(`
        SELECT *
        FROM transactions
        WHERE LOWER(contract_title) LIKE '%${item}%'
        AND amount_awarded_amount > 0
        AND amount_quantity > 0
      `);

      for (const c of contracts) {
        const unitPrice = c.amount_awarded_amount / c.amount_quantity;
        const overpricingPct = ((unitPrice - guide.max) / guide.max * 100);

        if (overpricingPct > 10) {
          flags.push({
            transactionId: c.id,
            ruleId: 'OVERPRICED_DBM',
            severity: overpricingPct > 50 ? 'critical' : overpricingPct > 25 ? 'high' : 'medium',
            title: `Overpriced ${item} — ${overpricingPct.toFixed(0)}% above DBM price guide`,
            description: `Unit price of ₱${unitPrice.toLocaleString()} is ${overpricingPct.toFixed(1)}% above the DBM price guide maximum of ₱${guide.max.toLocaleString()} per ${guide.unit}.`,
            recommendation: 'Request price canvass documents via FOI. Compare with actual market prices.',
            detectedAt: new Date().toISOString(),
            agencyName: c.agency_name,
            vendorName: c.vendor_name,
            amount: c.amount_awarded_amount,
            overpricingAmount: (unitPrice - guide.max) * c.amount_quantity,
          });
        }
      }
    }

    return flags;
  }

  async checkInfrastructureCosts() {
    // Check DPWH and other infrastructure projects
    const contracts = await db.query(`
      SELECT *
      FROM transactions
      WHERE agency_code IN ('DPWH', 'DEPED', 'DOH', 'DILG')
      AND amount_awarded_amount > 1000000
      AND contract_category = 'Infrastructure'
    `);

    const flags = [];
    for (const c of contracts) {
      const benchmark = this.getInfrastructureBenchmark(c.contract_title);
      if (!benchmark) continue;

      const estCost = this.estimateCost(c.amount_awarded_amount, c.contract_title, benchmark);
      if (estCost && estCost.overpricingPct > 20) {
        flags.push({
          transactionId: c.id,
          ruleId: 'OVERPRICED_INFRASTRUCTURE',
          severity: estCost.overpricingPct > 50 ? 'critical' : 'high',
          title: `Infrastructure project ${estCost.overpricingPct.toFixed(0)}% above regional benchmark`,
          description: `Cost appears ${estCost.overpricingPct.toFixed(1)}% above the regional benchmark of ₱${benchmark.max.toLocaleString()} per ${benchmark.unit}.`,
          recommendation: 'Request detailed cost breakdown via FOI. Compare with similar projects in the region.',
          detectedAt: new Date().toISOString(),
          agencyName: c.agency_name,
          vendorName: c.vendor_name,
          amount: c.amount_awarded_amount,
        });
      }
    }
    return flags;
  }

  async checkMedicinePrices() {
    // Cross-reference DOH/PhilHealth drug procurement against formulary
    const contracts = await db.query(`
      SELECT *
      FROM transactions
      WHERE agency_code IN ('DOH', 'PHILHEALTH', 'PCSO')
      AND contract_category = 'Health'
      AND LOWER(contract_title) LIKE '%medicine%'
      OR LOWER(contract_title) LIKE '%drug%'
      OR LOWER(contract_title) LIKE '%tablet%'
      OR LOWER(contract_title) LIKE '%capsule%'
    `);

    // Load PhilHealth formulary prices
    const formulary = await this.loadMedicineFormulary();
    const flags = [];

    for (const c of contracts) {
      const drug = this.matchDrugName(c.contract_title, formulary);
      if (!drug) continue;

      const unitPrice = c.amount_awarded_amount / (c.amount_quantity || 1);
      const overpricingPct = ((unitPrice - drug.formularyPrice) / drug.formularyPrice * 100);

      if (overpricingPct > 15) {
        flags.push({
          transactionId: c.id,
          ruleId: 'OVERPRICED_MEDICINE',
          severity: overpricingPct > 100 ? 'critical' : 'high',
          title: `Medicine ${overpricingPct.toFixed(0)}% above PhilHealth formulary price`,
          description: `"${drug.name}" procured at ₱${unitPrice.toFixed(2)}/unit vs PhilHealth formulary price of ₱${drug.formularyPrice.toFixed(2)}/unit — ${overpricingPct.toFixed(1)}% overpriced.`,
          recommendation: 'This is a Pharmally-type anomaly. File COA complaint immediately.',
          detectedAt: new Date().toISOString(),
          agencyName: c.agency_name,
          vendorName: c.vendor_name,
          amount: c.amount_awarded_amount,
          overpricingAmount: (unitPrice - drug.formularyPrice) * (c.amount_quantity || 1),
        });
      }
    }
    return flags;
  }

  async checkSchoolBuildingCosts() {
    const contracts = await db.query(`
      SELECT *
      FROM transactions
      WHERE agency_code = 'DEPED'
      AND (
        LOWER(contract_title) LIKE '%classroom%'
        OR LOWER(contract_title) LIKE '%school building%'
      )
      AND amount_awarded_amount > 500000
    `);

    const flags = [];
    const MAX_COST_PER_CLASSROOM = 2500000; // DepEd standard

    for (const c of contracts) {
      const classroomCount = this.extractClassroomCount(c.contract_title);
      if (!classroomCount) continue;

      const costPerClassroom = c.amount_awarded_amount / classroomCount;
      const overpricingPct = ((costPerClassroom - MAX_COST_PER_CLASSROOM) / MAX_COST_PER_CLASSROOM * 100);

      if (overpricingPct > 20) {
        flags.push({
          transactionId: c.id,
          ruleId: 'OVERPRICED_SCHOOL',
          severity: overpricingPct > 50 ? 'critical' : 'high',
          title: `School construction ₱${(costPerClassroom/1000).toFixed(0)}K per classroom — ${overpricingPct.toFixed(0)}% above DepEd standard`,
          description: `Cost of ₱${costPerClassroom.toLocaleString()} per classroom vs DepEd standard of ₱${MAX_COST_PER_CLASSROOM.toLocaleString()} per classroom.`,
          recommendation: 'Request engineering cost breakdown. Check actual construction quality after completion.',
          detectedAt: new Date().toISOString(),
          agencyName: c.agency_name,
          vendorName: c.vendor_name,
          amount: c.amount_awarded_amount,
        });
      }
    }
    return flags;
  }

  getInfrastructureBenchmark(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('concrete road') || t.includes('concrete pavement')) return INFRASTRUCTURE_BENCHMARKS.road_concrete_km;
    if (t.includes('asphalt road') || t.includes('road improvement')) return INFRASTRUCTURE_BENCHMARKS.road_asphalt_km;
    if (t.includes('classroom') || t.includes('school')) return INFRASTRUCTURE_BENCHMARKS.school_building_classroom;
    if (t.includes('flood control') || t.includes('seawall') || t.includes('revetment')) return INFRASTRUCTURE_BENCHMARKS.flood_control_lm;
    return null;
  }

  estimateCost(amount, title, benchmark) {
    // Try to extract quantity from title
    const kmMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer)/i);
    const lmMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:lm|linear meter|lineal meter)/i);

    let quantity = null;
    if (kmMatch) quantity = parseFloat(kmMatch[1]);
    else if (lmMatch) quantity = parseFloat(lmMatch[1]);

    if (!quantity) return null;

    const costPerUnit = amount / quantity;
    const overpricingPct = ((costPerUnit - benchmark.max) / benchmark.max * 100);
    return { costPerUnit, overpricingPct };
  }

  extractClassroomCount(title) {
    const match = title.match(/(\d+)\s*(?:classroom|CR|room)/i);
    return match ? parseInt(match[1]) : null;
  }

  async loadMedicineFormulary() {
    // In production, this loads from PhilHealth formulary database
    // For now, returns common medicines with reference prices
    return [
      { name: 'paracetamol 500mg', keywords: ['paracetamol'], formularyPrice: 2.50 },
      { name: 'amoxicillin 500mg', keywords: ['amoxicillin'], formularyPrice: 8.00 },
      { name: 'metformin 500mg', keywords: ['metformin'], formularyPrice: 5.00 },
      { name: 'amlodipine 5mg', keywords: ['amlodipine'], formularyPrice: 6.50 },
      { name: 'losartan 50mg', keywords: ['losartan'], formularyPrice: 12.00 },
      { name: 'face mask surgical', keywords: ['surgical mask', 'face mask'], formularyPrice: 15.00 },
      { name: 'alcohol 70%', keywords: ['alcohol'], formularyPrice: 120.00 }, // per liter
    ];
  }

  matchDrugName(title, formulary) {
    const t = (title || '').toLowerCase();
    return formulary.find(d => d.keywords.some(k => t.includes(k)));
  }
}

module.exports = OvepricingFlagEngine;
