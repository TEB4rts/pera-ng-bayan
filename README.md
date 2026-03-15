 💰 Pera ng Bayan
### *Ang pera ng bayan ay para sa bayan.*
#### The People's Money — Philippine Government Spending Intelligence System

[![Live Demo](https://img.shields.io/badge/Live-Demo-green)](https://pera-ng-bayan.vercel.app)
[![Proxy](https://img.shields.io/badge/CORS-Proxy-blue)](https://pnb-proxy.vercel.app/api/proxy?source=health)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Free Forever](https://img.shields.io/badge/Free-Forever-brightgreen)](https://github.com/TEB4rts/pera-ng-bayan)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![Data: data.gov.ph](https://img.shields.io/badge/Data-data.gov.ph-orange)](https://data.gov.ph)
[![Data: PhilGEPS](https://img.shields.io/badge/Data-PhilGEPS-red)](https://philgeps.gov.ph)

---

## 🇵🇭 What Is This?

Every year the Philippine government spends **₱5+ trillion** 
of public money. The data is technically public — but scattered 
across dozens of incompatible portals, buried in PDFs, and 
impossible to search or analyze without a team of researchers.

**Pera ng Bayan** changes that.

It automatically pulls all available government spending data 
from data.gov.ph, PhilGEPS, DBM, and COA — then runs 
intelligent anomaly detection to surface suspicious contracts, 
overpriced procurement, and corruption patterns in real time.

Free. Open source. Built for the Filipino people.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📡 **Live Data** | Pulls real data from data.gov.ph and PhilGEPS |
| 🚩 **Auto Flags** | Automatically detects procurement anomalies |
| 🔍 **Search** | Search all contracts by agency, vendor, amount |
| 🗺️ **By Region** | Filter by NCR, Visayas, Mindanao, Luzon |
| 🏛️ **By Agency** | Deep dive per agency — DPWH, DOH, DepEd, etc. |
| 📋 **Raw Data** | See every raw field from the source API |
| 📊 **Charts** | Spending breakdown by agency and mode |
| 📱 **Mobile** | Works on phone and desktop |
| 🚫 **Zero Telemetry** | No tracking, no ads, no accounts |
| 🆓 **Free Forever** | MIT licensed, always free |

---

## 🚩 Anomaly Detection

The system automatically flags these patterns on every contract:

| Flag | Severity | What It Means |
|------|----------|---------------|
| `SINGLE_BIDDER` | 🔴 Critical | Only 1 bidder on competitive procurement — classic bid-fixing indicator |
| `ABC_PROXIMITY` | 🔴 Critical | Award within 0.5% of budget ceiling — suggests inside knowledge |
| `HIGH_VALUE_NO_COMPETITION` | 🔴 Critical | Contract over ₱50M awarded without public bidding |
| `SOLE_SOURCE_LARGE` | 🟠 High | Contract over ₱5M without competitive bidding |
| `YEAR_END_RUSH` | 🟠 High | Large non-competitive contract in Nov/Dec — less scrutiny |
| `RAPID_AWARD` | 🟡 Medium | Award less than 7 days after bid opening — violates RA 9184 |

---

## 📡 Data Sources

| Source | What It Contains | Status |
|--------|-----------------|--------|
| **data.gov.ph** | Procurement datasets, budget data, contracts | ✅ Live |
| **PhilGEPS** | All government contract awards | ✅ Live |
| **DBM** | National budget, allotments, obligations | ⚡ Via proxy |
| **COA** | Annual audit reports, findings | ⚡ Via proxy |
| **FOI Philippines** | Disclosed government documents | ⚡ Via proxy |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│         Pera ng Bayan               │
│         (Base44 Frontend)           │
│    pera-ng-bayan.vercel.app         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│         pnb-proxy                   │
│      (Vercel Serverless)            │
│    pnb-proxy.vercel.app             │
└──────┬──────┬──────┬────────────────┘
       │      │      │
       ▼      ▼      ▼
  data.gov  PhilGEPS  DBM
     .ph    .gov.ph  .gov.ph
```

---

## 🚀 Quick Start

### Use the live app
👉 [pera-ng-bayan.vercel.app](https://pera-ng-bayan.vercel.app)

### Run locally
```bash
# Clone the repo
git clone https://github.com/TEB4rts/pera-ng-bayan.git
cd pera-ng-bayan

# Install dependencies
npm install

# Run the API
node api/server.js

# API runs at http://localhost:3000
```

### Deploy your own
```bash
# Fork the repo on GitHub
# Go to vercel.com → New Project → Import fork
# Click Deploy
# Done — your own instance is live
```

---

## 📁 Project Structure

```
pera-ng-bayan/
│
├── api/
│   ├── proxy.js              ← CORS proxy (Vercel serverless)
│   └── server.js             ← Local Express API server
│
├── ingestion/
│   └── sources/
│       ├── philgeps/         ← PhilGEPS scrapers
│       ├── coa/              ← COA audit report scraper
│       ├── dbm/              ← DBM budget data
│       └── foi/              ← FOI disclosures
│
├── intelligence/
│   └── flags/
│       ├── procurement-flags.js  ← Bid fixing detection
│       └── overpricing-flags.js  ← Price guide comparison
│
├── normalization/            ← Data transformers
├── db/                       ← SQLite database layer
├── docs/                     ← Documentation
├── examples/                 ← Example policy files
├── tests/                    ← Unit + integration tests
├── vercel.json               ← Vercel config
└── README.md
```

---

## 🤝 How to Contribute

All contributions welcome — especially:

- 🌍 **New data sources** — Add more government portals
- 🚩 **New flag rules** — Help detect more corruption patterns
- 🗺️ **LGU scrapers** — Local government unit data
- 🌐 **Filipino translation** — Make it accessible to more Filipinos
- 🐛 **Bug reports** — Open a GitHub Issue
- 📖 **Documentation** — Improve guides and examples

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

## 🏆 Who Uses This

| User | How |
|------|-----|
| **Investigative journalists** | Instant leads on suspicious contracts |
| **COA auditors** | Pre-audit intelligence |
| **Watchdog NGOs** | Systematic corruption detection |
| **Citizens** | Look up projects in their area |
| **Researchers** | Public finance data analysis |
| **Opposition politicians** | Accountability documentation |

---

## 📜 Legal

This tool uses only **publicly available data** from official 
Philippine government portals. All data belongs to the 
Philippine government and its citizens.

This tool does not store personal data. No accounts required. 
No tracking. No ads. No telemetry of any kind.

---

## 📄 License

**MIT** — Free forever.

No paid tiers. No usage limits. No upsell. 
Built for the Filipino people, by the community.

---

## 🔗 Related

- **CORS Proxy** → [github.com/TEB4rts/pnb-proxy](https://github.com/TEB4rts/pnb-proxy)
- **data.gov.ph** → [data.gov.ph](https://data.gov.ph)
- **PhilGEPS** → [philgeps.gov.ph](https://philgeps.gov.ph)
- **COA** → [coa.gov.ph](https://coa.gov.ph)
- **DBM** → [dbm.gov.ph](https://dbm.gov.ph)
- **FOI** → [foi.gov.ph](https://foi.gov.ph)

---

*"Ang pera ng bayan ay banal."*
*The people's money is sacred.*

---

<p align="center">
  Built with ❤️ for the Filipino people<br>
  Free forever · Open source · Zero telemetry
</p>
```

---

Go to:
```
https://github.com/TEB4rts/pera-ng-bayan/edit/main/README.md
