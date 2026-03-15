// api/proxy.js
// Pera ng Bayan — CORS Proxy
// Uses Node.js built-in fetch — zero dependencies needed

export default async function handler(req, res) {
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

  const HEADERS = {
    'User-Agent': 'Pera-ng-Bayan/1.0 (https://github.com/TEB4rts/pera-ng-bayan)',
    'Accept': 'application/json, text/html, */*',
  };

  const URLS = {
    health: null,
    status: null,
    datagov_search:
      `https://data.gov.ph/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=20`,
    datagov_store:
      `https://data.gov.ph/api/3/action/datastore_search?resource_id=${resource_id}&limit=${limit}&offset=${offset}`,
    datagov_list:
      `https://data.gov.ph/api/3/action/package_list`,
    datagov_show:
      `https://data.gov.ph/api/3/action/package_show?id=${q}`,
    philgeps_awards:
      `https://philgeps.gov.ph/GEPSNONPILOT/Tender/AwardNoticeList.aspx?PageIndex=${page}`,
    philgeps_opps:
      `https://philgeps.gov.ph/GEPSNONPILOT/Tender/SplashOpportunitiesSearchUI.aspx?PageIndex=${page}`,
    dbm:
      `https://dbm.gov.ph/index.php/budget-data/${year}`,
    coa:
      `https://www.coa.gov.ph/index.php/reports?year=${year}`,
  };

  // ── Health check ───────────────────────────────────────
  if (!source || source === 'health') {
    return res.json({
      status: 'ok',
      service: 'Pera ng Bayan CORS Proxy',
      github: 'https://github.com/TEB4rts/pera-ng-bayan',
      timestamp: new Date().toISOString(),
      availableSources: Object.keys(URLS).filter(k => k !== 'health' && k !== 'status'),
      usage: {
        datagov_search: '?source=datagov_search&q=procurement',
        datagov_store: '?source=datagov_store&resource_id=XXXX&limit=100',
        datagov_list: '?source=datagov_list',
        philgeps_awards: '?source=philgeps_awards&page=1',
        status: '?source=status',
      },
    });
  }

  // ── Status: ping all sources ───────────────────────────
  if (source === 'status') {
    const checks = [
      { name: 'data.gov.ph', url: 'https://data.gov.ph/api/3/action/package_list' },
      { name: 'philgeps.gov.ph', url: 'https://philgeps.gov.ph' },
      { name: 'dbm.gov.ph', url: 'https://dbm.gov.ph' },
      { name: 'coa.gov.ph', url: 'https://www.coa.gov.ph' },
    ];

    const results = await Promise.all(
      checks.map(async (c) => {
        const start = Date.now();
        try {
          const r = await fetch(c.url, {
            headers: HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          return {
            name: c.name,
            status: r.ok ? 'ok' : 'error',
            httpStatus: r.status,
            ms: Date.now() - start,
          };
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
      results,
      checkedAt: new Date().toISOString(),
    });
  }

  // ── Validate source ────────────────────────────────────
  const url = URLS[source];
  if (!url) {
    return res.status(400).json({
      error: `Unknown source: "${source}"`,
      validSources: Object.keys(URLS).filter(k => URLS[k] !== null),
    });
  }

  // ── Fetch from real API ────────────────────────────────
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('json')) {
      const data = await response.json();
      return res.json({
        ...data,
        _proxy: {
          source,
          url,
          fetchedAt: new Date().toISOString(),
          httpStatus: response.status,
        },
      });
    } else {
      const text = await response.text();
      return res.send(text);
    }
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      source,
      url,
      fetchedAt: new Date().toISOString(),
      tip: err.name === 'TimeoutError'
        ? 'Source server timed out. Try again.'
        : 'Source server may be down or blocking requests.',
    });
  }
}
