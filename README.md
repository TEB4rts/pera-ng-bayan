# 💰 Pera ng Bayan
### *The People's Money — Philippine Government Spending Intelligence System*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Free Forever](https://img.shields.io/badge/Free-Forever-brightgreen)](https://github.com/your-username/pera-ng-bayan)
[![Data: PhilGEPS](https://img.shields.io/badge/Data-PhilGEPS-blue)](https://philgeps.gov.ph)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

> **100% free, open-source, zero telemetry.** Auto-compiles all Philippine government spending data, procurement records, audit reports, and budget documents into a searchable, intelligent system that automatically flags corruption patterns.

---

## 🇵🇭 What This Does

Every year, the Philippine government spends **₱5+ trillion** of public money. The data is technically public — but scattered across dozens of incompatible portals, buried in PDFs, and impossible to search or analyze without a team of researchers.

**Pera ng Bayan** changes that by:

- 🔄 **Auto-ingesting** all public spending data nightly
- 🧠 **Automatically flagging** procurement anomalies, overpricing, ghost projects
- 🔗 **Connecting** contracts to vendors to officials to audit findings
- 📋 **Generating** searchable SBOMs of government spending
- 🗺️ **Mapping** every project geographically
- 📱 **Making it accessible** to citizens, journalists, and researchers

---

## 🚀 Quick Start

```bash
# Clone the repo
git clone https://github.com/your-username/pera-ng-bayan.git
cd pera-ng-bayan

# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Run first ingestion (pulls real PhilGEPS data)
npm run ingest:philgeps

# Start the API
npm run api

# Start the dashboard
npm run dashboard
```

---

## 📡 Data Sources

| Source | Data | Update Frequency |
|---|---|---|
| **PhilGEPS** | All procurement, contracts, awards | Every 4 hours |
| **DBM Open Data** | National budget, SARO, obligations | Daily |
| **COA Reports** | Annual audit reports, findings | Weekly |
| **FOI Philippines** | Disclosed government documents | Daily |
| **DPWH Portal** | Infrastructure project status | Daily |
| **DOH Procurement** | Medicine + equipment purchases | Daily |
| **DepEd Portal** | School building projects | Daily |
| **DSWD Portal** | Social program beneficiaries | Daily |
| **Congress.gov.ph** | GAA, PDAF, budget insertions | Weekly |
| **LGU Portals** | Local government spending | Weekly |

---

## 🚩 Automatic Flags

The system automatically detects:

### Procurement Red Flags
- Single bidder on competitive bidding
- Award within 3 days of bid opening (legally requires longer)
- Vendor registered less than 6 months before winning large contract
- Contract splitting below ₱1M threshold to avoid bidding
- Same vendor wins 3+ consecutive contracts from same agency
- Awarded amount within 0.5% of ABC (bid-rigging indicator)

### Ghost Project Detection
- Project location cross-referenced with satellite imagery
- Reported completion vs. actual physical existence
- Beneficiary count exceeds population of area
- Infrastructure in area already existing per OpenStreetMap

### Overpricing Detection
- Unit cost vs. DBM price guide (>10% = flagged)
- Infrastructure cost vs. regional benchmark (>20% = flagged)
- Medicine price vs. PhilHealth formulary
- Equipment cost vs. retail market price

### Political Connection Flags
- Vendor address matches official's residence
- Vendor registered after official took office
- Campaign donor (COMELEC data) = contract recipient
- PDAF/LGSF insertions tracked to implementation

---

## 🛠️ CLI Commands

```bash
# Ingestion
npm run ingest:all              # Run all scrapers
npm run ingest:philgeps         # PhilGEPS contracts only
npm run ingest:coa              # COA audit reports
npm run ingest:dbm              # DBM budget data

# Analysis
npm run analyze:flags           # Run all anomaly detectors
npm run analyze:overpricing     # Price comparison only
npm run analyze:ghost-projects  # Satellite verification

# Reports
npm run report:daily            # Today's anomaly digest
npm run report:agency DPWH      # Agency-specific report
npm run report:vendor "ABC Corp" # Vendor history report

# Export
npm run export:json             # Full dataset as JSON
npm run export:csv              # Spreadsheet format
npm run export:sbom             # Spending Bill of Materials
```

---

## 🔌 API

```bash
# Search contracts
GET /api/v1/contracts?agency=DPWH&year=2024&min=1000000

# Get vendor history
GET /api/v1/vendors/abc-construction/contracts

# Get live flags
GET /api/v1/flags?severity=critical&since=7d

# Natural language query
POST /api/v1/query
{ "q": "How much did DPWH spend in Mindanao in 2024?" }

# Subscribe to alerts
POST /api/v1/alerts
{ "query": "agency:DPWH AND flag:single_bidder", "webhook": "https://..." }
```

---

## 📁 Project Structure

```
pera-ng-bayan/
├── ingestion/          # Data scrapers per source
├── normalization/      # Schema + transformers
├── intelligence/       # Anomaly detection + flags
├── api/               # REST API + query engine
├── dashboard/         # React frontend
├── tests/
└── docs/
```

---

## 🤝 Contributing

All contributions welcome — especially:
- New LGU scrapers
- Additional flag rules
- Price guide data
- Translation to Filipino

See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 📄 License

**MIT** — Free forever. No paid tiers. No telemetry. Built for the Filipino people.

---

*"Ang pera ng bayan ay banal." — The people's money is sacred.*
