// ingestion/sources/coa/scraper.js
// Commission on Audit (COA) Annual Report scraper
// COA publishes all audit reports at: https://www.coa.gov.ph/index.php/reports

'use strict';

const axios = require('axios');
const pdfParse = require('pdf-parse');
const db = require('../../../db');
const logger = require('../../../utils/logger');

const COA_BASE_URL = 'https://www.coa.gov.ph';
const COA_REPORTS_URL = 'https://www.coa.gov.ph/index.php/reports';

// Common COA finding patterns — these appear in audit reports
const FINDING_PATTERNS = [
  {
    type: 'OVERPRICED',
    patterns: [/overpric/i, /excessive cost/i, /overvalued/i, /unreasonable price/i],
    severity: 'high',
  },
  {
    type: 'GHOST_DELIVERY',
    patterns: [/ghost delivery/i, /undelivered/i, /not delivered/i, /fictitious/i],
    severity: 'critical',
  },
  {
    type: 'UNLIQUIDATED',
    patterns: [/unliquidated/i, /not liquidated/i, /unsupported cash advance/i],
    severity: 'high',
  },
  {
    type: 'UNAUTHORIZED_PAYMENT',
    patterns: [/unauthorized payment/i, /irregular disbursement/i, /without legal basis/i],
    severity: 'critical',
  },
  {
    type: 'OVERESTIMATED_COST',
    patterns: [/overestimated/i, /padded/i, /inflated cost/i],
    severity: 'high',
  },
  {
    type: 'DEFICIENT_PROCUREMENT',
    patterns: [/deficient procurement/i, /non-compliance.*RA 9184/i, /violation.*procurement/i],
    severity: 'high',
  },
  {
    type: 'GHOST_EMPLOYEE',
    patterns: [/ghost employee/i, /non-existent employee/i, /fictitious payroll/i],
    severity: 'critical',
  },
  {
    type: 'UNACCOUNTED_FUNDS',
    patterns: [/unaccounted/i, /missing funds/i, /shortage/i, /cash shortage/i],
    severity: 'critical',
  },
  {
    type: 'DISALLOWANCE',
    patterns: [/notice of disallowance/i, /ND No\./i, /disallowed/i],
    severity: 'high',
  },
];

class COAScraper {
  constructor(options = {}) {
    this.year = options.year || new Date().getFullYear() - 1; // Last year's reports
    this.agencies = options.agencies || null; // null = all agencies
  }

  async run() {
    logger.info(`📋 Starting COA audit report ingestion for ${this.year}...`);
    let totalReports = 0;
    let totalFindings = 0;

    try {
      const reportLinks = await this.fetchReportLinks();
      logger.info(`  Found ${reportLinks.length} audit reports`);

      for (const link of reportLinks) {
        try {
          const findings = await this.processReport(link);
          if (findings.length > 0) {
            await db.upsertCoaFindings(findings);
            totalFindings += findings.length;
            totalReports++;
            logger.info(`  ✅ ${link.agency}: ${findings.length} findings extracted`);
          }
          await this._delay(2000); // Respectful delay
        } catch (err) {
          logger.warn(`  ⚠️  Failed to process ${link.agency}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`COA scraping failed: ${err.message}`);
      throw err;
    }

    logger.success(`✅ COA ingestion complete: ${totalReports} reports, ${totalFindings} findings`);
    return { totalReports, totalFindings };
  }

  async fetchReportLinks() {
    const cheerio = require('cheerio');
    try {
      const response = await axios.get(COA_REPORTS_URL, {
        params: { year: this.year },
        headers: { 'User-Agent': 'Pera-ng-Bayan/1.0 (transparency research)' },
        timeout: 30000,
      });

      const $ = cheerio.load(response.data);
      const links = [];

      // Parse COA report listing
      $('a[href*=".pdf"]').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (!href || !text) return;

        const fullUrl = href.startsWith('http') ? href : `${COA_BASE_URL}${href}`;
        links.push({
          url: fullUrl,
          agency: this.extractAgencyFromText(text),
          year: this.year,
          reportType: this.inferReportType(text),
        });
      });

      return links;
    } catch (err) {
      logger.warn(`Could not fetch COA report listing: ${err.message}`);
      // Return known COA report URL patterns
      return this.getKnownReportUrls();
    }
  }

  async processReport(reportLink) {
    const findings = [];

    try {
      // Download PDF
      const response = await axios.get(reportLink.url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: { 'User-Agent': 'Pera-ng-Bayan/1.0' },
      });

      // Parse PDF text
      const data = await pdfParse(Buffer.from(response.data));
      const text = data.text;

      // Extract findings using pattern matching
      const pages = text.split(/\f|\n{3,}/); // Split by page breaks
      for (const page of pages) {
        const pageFinding = this.extractFindingFromText(page, reportLink);
        if (pageFinding) findings.push(pageFinding);
      }

      // Also extract the summary table if present
      const summaryFindings = this.extractSummaryTable(text, reportLink);
      findings.push(...summaryFindings);

    } catch (err) {
      logger.warn(`Could not process PDF ${reportLink.url}: ${err.message}`);
    }

    return findings;
  }

  extractFindingFromText(text, reportLink) {
    if (!text || text.length < 100) return null;

    for (const pattern of FINDING_PATTERNS) {
      const matched = pattern.patterns.some(p => p.test(text));
      if (!matched) continue;

      // Extract amount if present
      const amountMatch = text.match(/[₱P]\s*([\d,]+(?:\.\d+)?)\s*(?:million|billion|M|B)?/i);
      const amount = amountMatch ? this.parseAmountFromMatch(amountMatch) : null;

      // Extract the first sentence that contains the finding
      const sentences = text.split(/[.!?]/).filter(s => s.length > 20);
      const findingSentence = sentences.find(s => pattern.patterns.some(p => p.test(s)));

      if (!findingSentence) continue;

      return {
        id: `COA-${reportLink.agency}-${reportLink.year}-${pattern.type}-${Math.random().toString(36).substr(2, 6)}`.toUpperCase().replace(/\s/g, '-'),
        source: 'coa.gov.ph',
        agencyName: reportLink.agency,
        reportYear: reportLink.year,
        reportUrl: reportLink.url,
        findingType: pattern.type,
        severity: pattern.severity,
        description: findingSentence.trim(),
        amount: amount,
        status: 'OPEN', // Updated when COA issues clearance
        extractedAt: new Date().toISOString(),
      };
    }

    return null;
  }

  extractSummaryTable(fullText, reportLink) {
    // Many COA reports have a "Summary of Audit Observations and Recommendations"
    // table near the beginning
    const findings = [];
    const tableSection = fullText.match(/Summary of Audit Observations([\s\S]{0,5000})/i);
    if (!tableSection) return findings;

    const lines = tableSection[1].split('\n').filter(l => l.trim().length > 20);
    for (const line of lines) {
      for (const pattern of FINDING_PATTERNS) {
        if (pattern.patterns.some(p => p.test(line))) {
          const amountMatch = line.match(/([\d,]+(?:\.\d+)?)/);
          findings.push({
            id: `COA-SUMMARY-${reportLink.agency}-${Math.random().toString(36).substr(2, 6)}`.toUpperCase().replace(/\s/g, '-'),
            source: 'coa.gov.ph',
            agencyName: reportLink.agency,
            reportYear: reportLink.year,
            reportUrl: reportLink.url,
            findingType: pattern.type,
            severity: pattern.severity,
            description: line.trim(),
            amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null,
            status: 'OPEN',
            extractedAt: new Date().toISOString(),
          });
          break;
        }
      }
    }
    return findings;
  }

  extractAgencyFromText(text) {
    const knownAgencies = ['DPWH', 'DOH', 'DepEd', 'DSWD', 'DILG', 'DBM', 'DA', 'DND', 'DOF', 'PCSO', 'PhilHealth', 'PAGCOR'];
    for (const agency of knownAgencies) {
      if (text.toLowerCase().includes(agency.toLowerCase())) return agency;
    }
    // Extract agency from parentheses or common patterns
    const match = text.match(/\(([A-Z]{2,10})\)/) || text.match(/^([A-Z][A-Za-z\s]+)\s*\d{4}/);
    return match ? match[1].trim() : text.substring(0, 50).trim();
  }

  inferReportType(text) {
    const t = text.toLowerCase();
    if (t.includes('annual audit')) return 'ANNUAL_AUDIT';
    if (t.includes('special audit')) return 'SPECIAL_AUDIT';
    if (t.includes('compliance')) return 'COMPLIANCE';
    if (t.includes('performance')) return 'PERFORMANCE';
    return 'ANNUAL_AUDIT';
  }

  parseAmountFromMatch(match) {
    const numStr = match[1].replace(/,/g, '');
    const num = parseFloat(numStr);
    const suffix = match[0].toLowerCase();
    if (suffix.includes('billion') || suffix.includes('b')) return num * 1000000000;
    if (suffix.includes('million') || suffix.includes('m')) return num * 1000000;
    return num;
  }

  getKnownReportUrls() {
    // Fallback: known COA report URL patterns for major agencies
    const agencies = ['DPWH', 'DOH', 'DEPED', 'DSWD', 'DILG', 'DA', 'PCSO', 'PHILHEALTH'];
    return agencies.map(agency => ({
      url: `https://www.coa.gov.ph/reports/${this.year}/${agency.toLowerCase()}-${this.year}-annual-audit-report.pdf`,
      agency,
      year: this.year,
      reportType: 'ANNUAL_AUDIT',
    }));
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (require.main === module) {
  const scraper = new COAScraper({ year: 2023 });
  scraper.run().then(() => process.exit(0)).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = COAScraper;
