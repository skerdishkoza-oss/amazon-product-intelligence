## 1.5 — 2026-09-22

- Added Essential, Catalog, Competitive and Custom data profiles with stable-schema block projection and per-row retrieval metadata.
- Added the lower-cost `product-essential` billing event while preserving `product-basic`, `product-detail`, `product-check` and bounded ancillary events.
- Added composable discovery filters for price, rating, review count, Prime, sponsored policy, demand and discount. Filtered cards never trigger detail-page requests or product events.
- Preserved sponsored, organic and absolute positions in `discoveredFrom`, including page-local position and parsed bought-in-past-month lower bounds.
- Made `maxProducts` a hard ceiling under concurrency and applied `requireLocation` to Fast listing results.
- Made monitoring baselines delivery-location-specific and suppressed false changes when either observation has a parser miss or another untrusted field status.
- Appended and schema-validated each success before attempting its billing event. Base commits are serialized so a discovered charge cap stops waiting workers before they emit value.
- Added explicit monitoring comparison warnings and passed the real filtered-out count into `RUN_SUMMARY`.
- Added per-reason discovery-filter diagnostics and corrected compact live review counts such as `45K` and localized `1,2 Tsd.` before threshold filtering.

## 1.4 — 2026-09-20

- Added Amazon France, Italy, Spain and Canada with locale-specific currency, availability, challenge and no-results labels.
- Added seller/storefront discovery, bounded All Offers extraction and public seller-profile enrichment.
- Added prior-dataset monitoring with typed changes and `product-check` billing.
- Added raw JSON item rows with per-row marketplace overrides.
- Added explicit Actor output links for results and `RUN_SUMMARY`.
- Fixed Linux CI glob handling and upgraded GitHub Actions runtimes.
- Added charge-cap wind-down and bounded optional-data events.

## 1.1 — 2026-09-04

- Initial P0 product, search, variant, location, accounting, billing and golden-schema implementation.
