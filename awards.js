// ingestion/sources/philgeps/awards.js
// Ingests contract awards from PhilGEPS (Philippine Government Electronic Procurement System)
// PhilGEPS API is free and publicly accessible: https://philgeps.gov.ph

'use strict';

const axios = require('axios');
const db = require('../../../db');
const logger = require('../../../utils/logger');
const { normalizeTransaction } = require('../../../normalization/transformers/philgeps.transform');

const PHILGEPS_API_BASE = 'https://philgeps.gov.ph/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx';
const PHILGEPS_AWARDS_API = 'https://philgeps.gov.ph/api/awards'; // public API endpoint

// PhilGEPS also provides CSV/Excel downloads at:
// https://philgeps.gov.ph/GEPSNONPILOT/Tender/AwardNoticeList.aspx

const PROCUREMENT_MODES = {
  'PB': 'Public Bidding',
  'SS': 'Sole Source',
  'NB': 'Negotiated Bidding',
  'DC': 'Direct Contracting',
  'SB': 'Small Value Procurement',
  'LP': 'Limited Source Bidding',
  'EB': 'Emergency Cases',
  'RP': 'Repeat Order',
};

class PhilGEPSAwardsScraper {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 100;
    this.delayMs = options.delayMs || 1000; // Be respectful to the server
    this.maxPages = options.maxPages || Infinity;
    this.fromDate = options.fromDate || this._getDefaultFromDate();
  }

  _getDefaultFromDate() {
    const d = new Date();
    d.setDate(d.getDate() - 7); // Last 7 days by default
    return d.toISOString().split('T')[0];
  }

  async run() {
    logger.info('🚀 Starting PhilGEPS awards ingestion...');
    const startTime = Date.now();
    let totalIngested = 0;
    let page = 1;

    try {
      while (page <= this.maxPages) {
        logger.info(`  📥 Fetching page ${page}...`);

        const awards = await this.fetchPage(page);
        if (!awards || awards.length === 0) {
          logger.info(`  ✅ No more data at page ${page}. Done.`);
          break;
        }

        const normalized = awards.map(normalizeTransaction).filter(Boolean);
        await db.upsertTransactions(normalized);
        totalIngested += normalized.length;

        logger.info(`  ✅ Page ${page}: ${normalized.length} awards ingested`);
        page++;

        // Respectful delay between requests
        await this._delay(this.delayMs);
      }
    } catch (err) {
      logger.error(`PhilGEPS ingestion failed at page ${page}: ${err.message}`);
      throw err;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.success(`✅ PhilGEPS ingestion complete: ${totalIngested} awards in ${duration}s`);
    return { totalIngested, duration };
  }

  async fetchPage(page) {
    // PhilGEPS Award Notices are downloadable as structured data
    // Primary method: Parse the awards list page
    try {
      const response = await axios.get(PHILGEPS_AWARDS_API, {
        params: {
          page,
          pageSize: this.batchSize,
          dateFrom: this.fromDate,
          format: 'json',
        },
        headers: {
          'User-Agent': 'Pera-ng-Bayan/1.0 (Philippine government transparency tool; https://github.com/your-username/pera-ng-bayan)',
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      return response.data?.items || response.data || [];
    } catch (err) {
      if (err.response?.status === 404 && page > 1) {
        return []; // End of pagination
      }
      // Fallback to scraping if API fails
      logger.warn(`API call failed, falling back to scraper: ${err.message}`);
      return this.scrapePage(page);
    }
  }

  async scrapePage(page) {
    // Fallback HTML scraper for when the API is unavailable
    const cheerio = require('cheerio');
    try {
      const response = await axios.get(
        'https://philgeps.gov.ph/GEPSNONPILOT/Tender/AwardNoticeList.aspx',
        {
          params: { PageIndex: page },
          headers: {
            'User-Agent': 'Pera-ng-Bayan/1.0 (public transparency research)',
          },
          timeout: 30000,
        }
      );

      const $ = cheerio.load(response.data);
      const awards = [];

      // Parse the awards table
      $('table.GridViewStyle tr:not(:first-child)').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length < 6) return;

        awards.push({
          referenceNumber: $(cells[0]).text().trim(),
          title: $(cells[1]).text().trim(),
          awardedVendor: $(cells[2]).text().trim(),
          awardedAmount: this._parseAmount($(cells[3]).text().trim()),
          awardDate: $(cells[4]).text().trim(),
          agency: $(cells[5]).text().trim(),
          procurementMode: $(cells[6])?.text()?.trim() || 'Unknown',
          sourceUrl: `https://philgeps.gov.ph/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx?DetailsId=${$(cells[0]).find('a').attr('href')?.match(/\d+/)?.[0]}`,
        });
      });

      return awards;
    } catch (err) {
      logger.error(`Scraper failed: ${err.message}`);
      return [];
    }
  }

  _parseAmount(str) {
    if (!str) return 0;
    return parseFloat(str.replace(/[₱,\s]/g, '')) || 0;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CSV Download method — PhilGEPS provides bulk CSV downloads
async function downloadAwardsCSV(year, month) {
  const url = `https://philgeps.gov.ph/GEPSNONPILOT/Tender/AwardNoticeListCSV.aspx?Year=${year}&Month=${month}`;
  logger.info(`📥 Downloading PhilGEPS CSV for ${year}-${month}...`);

  try {
    const response = await axios.get(url, {
      responseType: 'text',
      headers: { 'User-Agent': 'Pera-ng-Bayan/1.0' },
      timeout: 60000,
    });

    return parseCSV(response.data);
  } catch (err) {
    logger.error(`CSV download failed: ${err.message}`);
    return [];
  }
}

function parseCSV(csvText) {
  const fastcsv = require('fast-csv');
  return new Promise((resolve) => {
    const rows = [];
    fastcsv.parseString(csvText, { headers: true, trim: true })
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', () => resolve([]));
  });
}

// Run directly
if (require.main === module) {
  const scraper = new PhilGEPSAwardsScraper({
    batchSize: 100,
    delayMs: 1500,
  });
  scraper.run()
    .then(result => {
      console.log(`\n✅ Done: ${result.totalIngested} awards ingested`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { PhilGEPSAwardsScraper, downloadAwardsCSV };
