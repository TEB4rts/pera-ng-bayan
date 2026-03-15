// api/proxy.js
// Pera ng Bayan — CORS Proxy
// Deploy this repo to Vercel (free) at vercel.com
// Then call: https://your-app.vercel.app/api/proxy?source=datagov_search

const axios = require('axios');

export default async function handler(req, res) {
  // ── CORS headers — allow everything ───────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    source,
    q = 'procurement',
    resource_id,
    page = 1,
    limit = 100,
    offset = 0,
    year = new Date().getFullYear() - 1,
  } = req.query;

  // ── URL map ────────────────────────────────────────────
  const URLS = {
    // data.gov.ph — search datasets by keyword
    datagov_search:
      `https://data.gov.ph/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=20`,

    // data.gov.ph — fetch actual records from a dataset
    datagov_store:
      `https://data.gov.ph/api/3/action/datastore_search?resource_id=${resource_id}&limit=${limit}&offset=${offset}`,

    // data.gov.ph — list all dataset IDs
    datagov_list:
      `https://data.gov.ph/api/3/action/package_list`,

    // data.gov.ph — get full details of one dataset
    datagov_show:
      `https://data.gov.ph/api/3/action/package_show?id=${q}`,

    // PhilGEPS — award notices list page
    philgeps_awards:
      `https://philgeps.gov.ph/GEPSNONPILOT/Tender/AwardNoticeList.aspx?PageIndex=${page}`,

    // PhilGEPS — open opportunities
    philgeps_opps:
      `https://philgeps.gov.ph/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx?PageIndex=${page}`,

    // DBM — budget data
    dbm:
      `https://dbm.gov.ph/index.php/budget-data/${year}`,

    // COA — audit reports listing
    coa:
      `https://www.coa.gov.ph/index.php/reports?year=${year}`,

    // OpenSpending — Philippines spending data
    openspending:
      `https://openspending.org/api/3/cubes/?package=philippines`,
  };

  // ── Special: ping all sources and return status ────────
  if (source === 'status') {
    const checks = [
      {
        name: 'data.gov.ph',
        url: 'https://data.gov.ph/api/3/action/package_list',
      },
      {
        name: 'philgeps.gov.ph',
        url: 'https://philgeps.gov.ph',
      },
      {
        name: 'dbm.gov.ph',
        url: 'https://dbm.gov.ph',
      },
      {
        name: 'coa.gov.ph',
        url: 'https://www.coa.gov.ph',
      },
      {
        name: 'openspending.org',
        url: 'https://openspending.org/api/3/cubes/',
      },
    ];

    const results = await Promise.allSettled(
      checks.map(async (c) => {
        const start = Date.now();
        try {
          await axios.get(c.url, {
            timeout: 8000,
            headers: { 'User-Agent': 'Pera-ng-Bayan/1.0' },
          });
          return { name: c.name, status: 'ok', ms: Date.now() - start };
        } catch (e) {
          return {
            name: c.name,
            status: 'error',
            error: e.message,
            ms: Date.now() - start,
          };
        }
      })
    );

    return res.json({
      results: results.map((r) => r.value || r.reason),
      checkedAt: new Date().toISOString(),
      proxy: 'pera-ng-bayan vercel proxy',
      github: 'https://github.com/TEB4rts/pera-ng-bayan',
    });
  }

  // ── Health check ───────────────────────────────────────
  if (source === 'health' || !source) {
    return res.json({
      status: 'ok',
      service: 'Pera ng Bayan CORS Proxy',
      github: 'https://github.com/TEB4rts/pera-ng-bayan',
      timestamp: new Date().toISOString(),
      usage: {
        datagov_search: '/api/proxy?source=datagov_search&q=procurement',
        datagov_store: '/api/proxy?source=datagov_store&resource_id=XXXX&limit=100',
        datagov_list: '/api/proxy?source=datagov_list',
        philgeps_awards: '/api/proxy?source=philgeps_awards&page=1',
        philgeps_opps: '/api/proxy?source=philgeps_opps&page=1',
        dbm: '/api/proxy?source=dbm&year=2024',
        coa: '/api/proxy?source=coa&year=2023',
        status: '/api/proxy?source=status',
      },
    });
  }

  // ── Validate source ────────────────────────────────────
  const url = URLS[source];
  if (!url) {
    return res.status(400).json({
      error: `Unknown source: "${source}"`,
      validSources: Object.keys(URLS),
    });
  }

  // ── Fetch from the real API ────────────────────────────
  try {
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent':
          'Pera-ng-Bayan/1.0 (https://github.com/TEB4rts/pera-ng-bayan; Philippine govt transparency tool)',
        Accept: 'application/json, text/html, */*',
      },
    });

    // Return JSON or raw text depending on content type
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('json')) {
      return res.json({
        ...response.data,
        _proxy: {
          source,
          url,
          fetchedAt: new Date().toISOString(),
          status: response.status,
        },
      });
    } else {
      // HTML response (e.g. PhilGEPS) — return as text
      return res.send(response.data);
    }
  } catch (err) {
    const status = err.response?.status || 500;
    return res.status(status).json({
      error: err.message,
      source,
      url,
      tip:
        status === 404
          ? 'Resource not found. Try a different resource_id.'
          : status === 403
          ? 'Access denied by source server.'
          : 'Source server may be down. Try again later.',
      fetchedAt: new Date().toISOString(),
    });
  }
}
