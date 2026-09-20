## 1.4 — 2026-09-20

- Added Amazon France, Italy, Spain and Canada with locale-specific currency, availability, challenge and no-results labels.
- Added seller/storefront discovery, bounded All Offers extraction and public seller-profile enrichment.
- Added prior-dataset monitoring with typed changes and `product-check` billing.
- Added raw JSON item rows with per-row marketplace overrides.
- Added explicit Actor output links for results and `RUN_SUMMARY`.
- Fixed Linux CI glob handling and upgraded GitHub Actions runtimes.
- Kept all optional value data behind successful pay-per-event outcomes; charge-cap overflow is removed before dataset flush.

## 1.1 — 2026-09-04

- Initial P0 product, search, variant, location, accounting, billing and golden-schema implementation.
