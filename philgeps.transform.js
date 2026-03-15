// normalization/transformers/philgeps.transform.js
'use strict';

const AGENCY_CODES = require('../schema/agency-codes.json');
const REGION_MAP = require('../schema/regions.json');

/**
 * Transforms raw PhilGEPS award data into the unified Pera ng Bayan schema
 */
function normalizeTransaction(raw) {
  if (!raw || (!raw.referenceNumber && !raw['Reference Number'])) return null;

  // Handle both API format and CSV format
  const refNum = raw.referenceNumber || raw['Reference Number'] || raw.ref_no;
  const title = raw.title || raw['Title'] || raw.procurement_title || '';
  const vendor = raw.awardedVendor || raw['Awarded Vendor'] || raw.vendor_name || '';
  const amount = parseAmount(raw.awardedAmount || raw['Awarded Amount'] || raw.amount || '0');
  const awardDate = parseDate(raw.awardDate || raw['Award Date'] || raw.date_of_award);
  const agency = raw.agency || raw['Procuring Entity'] || raw.procuring_entity || '';
  const procMode = raw.procurementMode || raw['Procurement Mode'] || raw.proc_mode || 'Unknown';
  const region = raw.region || inferRegion(agency);
  const abc = parseAmount(raw.approvedBudget || raw['Approved Budget for Contract'] || '0');

  return {
    id: `PH-PHILGEPS-${refNum}`,
    source: 'philgeps.gov.ph',
    sourceReferenceNumber: refNum,
    jurisdiction: 'PH-National',
    sourceUrl: raw.sourceUrl || `https://philgeps.gov.ph/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx?DetailsId=${refNum}`,

    agency: {
      name: cleanAgencyName(agency),
      code: lookupAgencyCode(agency),
      region: region,
      rawName: agency,
    },

    vendor: {
      name: cleanVendorName(vendor),
      rawName: vendor,
      tin: raw.tin || raw.TIN || null,
      philgepsRegistration: raw.philgepsId || raw['PhilGEPS Reg No'] || null,
      address: raw.vendorAddress || raw['Vendor Address'] || null,
    },

    amount: {
      approvedBudget: abc,
      awardedAmount: amount,
      variance: abc > 0 ? ((abc - amount) / abc * 100).toFixed(2) : null,
      variancePercent: abc > 0 ? parseFloat(((abc - amount) / abc * 100).toFixed(2)) : null,
      currency: 'PHP',
      fiscalYear: awardDate ? new Date(awardDate).getFullYear() : null,
    },

    contract: {
      title: title,
      procurementMode: normalizeProcMode(procMode),
      procurementModeRaw: procMode,
      category: raw.category || raw['Category'] || inferCategory(title),
      awardDate: awardDate,
      publishDate: parseDate(raw.publishDate || raw['Publish Date']),
      openingDate: parseDate(raw.openingDate || raw['Bid Opening Date']),
      location: {
        region: region,
        province: raw.province || null,
        municipality: raw.municipality || null,
        barangay: raw.barangay || null,
      },
    },

    flags: {
      singleBidder: raw.biddersCount === 1 || raw['No. of Bidders'] === '1',
      rapidAward: isRapidAward(raw.openingDate || raw['Bid Opening Date'], awardDate),
      newVendor: null, // Computed later when we have vendor history
      abovePriceGuide: null, // Computed by overpricing-flags.js
      coaFindingExists: false, // Cross-referenced by coa-flags.js
      contractSplitting: false, // Computed by procurement-flags.js
      solSource: isSoleSource(procMode),
    },

    meta: {
      ingestedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      rawData: process.env.STORE_RAW === 'true' ? raw : undefined,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────

function parseAmount(str) {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/[₱,\s]/g, '')) || 0;
}

function parseDate(str) {
  if (!str) return null;
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

function cleanAgencyName(name) {
  return (name || '')
    .replace(/\s+/g, ' ')
    .replace(/\bDEPT\b/gi, 'Department')
    .replace(/\bDEPED\b/gi, 'DepEd')
    .replace(/\bDPWH\b/gi, 'DPWH')
    .trim();
}

function cleanVendorName(name) {
  return (name || '')
    .replace(/\s+/g, ' ')
    .replace(/\bCORP\b/gi, 'Corporation')
    .replace(/\bINC\b\.?/gi, 'Inc.')
    .trim();
}

function lookupAgencyCode(agencyName) {
  const name = (agencyName || '').toLowerCase();
  if (name.includes('public works') || name.includes('dpwh')) return 'DPWH';
  if (name.includes('health') || name.includes('doh')) return 'DOH';
  if (name.includes('education') || name.includes('deped')) return 'DEPED';
  if (name.includes('social welfare') || name.includes('dswd')) return 'DSWD';
  if (name.includes('interior') || name.includes('dilg')) return 'DILG';
  if (name.includes('agriculture') || name.includes(' da ')) return 'DA';
  if (name.includes('defense') || name.includes('dnd')) return 'DND';
  if (name.includes('finance') || name.includes('dof')) return 'DOF';
  if (name.includes('justice') || name.includes('doj')) return 'DOJ';
  if (name.includes('transportation') || name.includes('dot')) return 'DOTr';
  if (name.includes('energy') || name.includes('doe')) return 'DOE';
  if (name.includes('environment') || name.includes('denr')) return 'DENR';
  if (name.includes('trade') || name.includes('dti')) return 'DTI';
  if (name.includes('budget') || name.includes('dbm')) return 'DBM';
  if (name.includes('philhealth')) return 'PHILHEALTH';
  if (name.includes('pagcor')) return 'PAGCOR';
  if (name.includes('pcso')) return 'PCSO';
  return 'OTHER';
}

function normalizeProcMode(mode) {
  const m = (mode || '').toLowerCase();
  if (m.includes('public bidding') || m.includes('pb')) return 'PUBLIC_BIDDING';
  if (m.includes('sole source') || m.includes('ss')) return 'SOLE_SOURCE';
  if (m.includes('negotiated') || m.includes('nb')) return 'NEGOTIATED';
  if (m.includes('direct contracting') || m.includes('dc')) return 'DIRECT_CONTRACTING';
  if (m.includes('small value') || m.includes('sv')) return 'SMALL_VALUE';
  if (m.includes('emergency')) return 'EMERGENCY';
  if (m.includes('repeat order') || m.includes('ro')) return 'REPEAT_ORDER';
  return 'OTHER';
}

function isSoleSource(mode) {
  const m = (mode || '').toLowerCase();
  return m.includes('sole') || m.includes('direct') || m.includes('negotiated') || m.includes('emergency');
}

function isRapidAward(openingDate, awardDate) {
  if (!openingDate || !awardDate) return false;
  const opening = new Date(openingDate);
  const award = new Date(awardDate);
  const diffDays = (award - opening) / (1000 * 60 * 60 * 24);
  return diffDays < 7; // Less than 7 days from bid opening to award is suspicious
}

function inferRegion(agencyName) {
  const name = (agencyName || '').toLowerCase();
  if (name.includes('ncr') || name.includes('metro manila') || name.includes('national capital')) return 'NCR';
  if (name.includes('region i') || name.includes('ilocos')) return 'Region I';
  if (name.includes('region ii') || name.includes('cagayan')) return 'Region II';
  if (name.includes('region iii') || name.includes('central luzon')) return 'Region III';
  if (name.includes('region iv') || name.includes('calabarzon')) return 'Region IV-A';
  if (name.includes('region v') || name.includes('bicol')) return 'Region V';
  if (name.includes('region vi') || name.includes('western visayas')) return 'Region VI';
  if (name.includes('region vii') || name.includes('central visayas')) return 'Region VII';
  if (name.includes('region viii') || name.includes('eastern visayas')) return 'Region VIII';
  if (name.includes('region ix') || name.includes('zamboanga')) return 'Region IX';
  if (name.includes('region x') || name.includes('northern mindanao')) return 'Region X';
  if (name.includes('region xi') || name.includes('davao')) return 'Region XI';
  if (name.includes('region xii') || name.includes('soccsksargen')) return 'Region XII';
  if (name.includes('caraga')) return 'Region XIII';
  if (name.includes('barmm') || name.includes('bangsamoro')) return 'BARMM';
  if (name.includes('car') || name.includes('cordillera')) return 'CAR';
  return 'National';
}

function inferCategory(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('road') || t.includes('highway') || t.includes('bridge') || t.includes('flood')) return 'Infrastructure';
  if (t.includes('medicine') || t.includes('drug') || t.includes('medical') || t.includes('hospital')) return 'Health';
  if (t.includes('school') || t.includes('classroom') || t.includes('education')) return 'Education';
  if (t.includes('computer') || t.includes('it ') || t.includes('software') || t.includes('system')) return 'IT';
  if (t.includes('vehicle') || t.includes('truck') || t.includes('ambulance')) return 'Vehicles';
  if (t.includes('food') || t.includes('meal') || t.includes('rice')) return 'Food';
  if (t.includes('consulting') || t.includes('services')) return 'Services';
  if (t.includes('equipment') || t.includes('machinery')) return 'Equipment';
  if (t.includes('building') || t.includes('construction') || t.includes('renovation')) return 'Construction';
  return 'Other';
}

module.exports = { normalizeTransaction };
