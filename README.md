# Pera ng Bayan — CORS Proxy

CORS proxy for [Pera ng Bayan](https://github.com/TEB4rts/pera-ng-bayan).
Fetches Philippine government spending data from data.gov.ph, PhilGEPS, and other sources.

## Deploy to Vercel (free)

1. Push this repo to GitHub
2. Go to vercel.com → New Project → Import repo
3. Click Deploy — done

## Endpoints

| Source | URL |
|--------|-----|
| Health check | `?source=health` |
| All sources status | `?source=status` |
| Search datasets | `?source=datagov_search&q=procurement` |
| Fetch dataset records | `?source=datagov_store&resource_id=XXXX` |
| List all datasets | `?source=datagov_list` |
| PhilGEPS awards | `?source=philgeps_awards&page=1` |
| PhilGEPS opportunities | `?source=philgeps_opps&page=1` |

## Part of

[github.com/TEB4rts/pera-ng-bayan](https://github.com/TEB4rts/pera-ng-bayan)

*Ang pera ng bayan ay para sa bayan.*
