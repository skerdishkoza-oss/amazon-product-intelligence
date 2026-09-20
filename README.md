# Amazon Product Intelligence Actor

Extract Amazon prices, variants, BSR, stock, Buy Box, sellers, discounts, ratings and product data with explicit source and status fields, so you know whether a value is truly absent or the scraper failed.

Implements the specification's **V1 P0 launch scope**. TypeScript, Apify SDK v3, `got-scraping` with Crawlee's session pool. Browser rendering is deliberately absent: everything is extracted from HTML and embedded JSON.

## Build state

The P0 code paths are implemented, plus variant price enrichment brought forward from P1. Public-release validation is still pending live US/UK/DE smoke fixtures and the specification's 100-record manual audit.

| Area | State |
| --- | --- |
| ASIN, product URL, keyword, category, best-seller and Apify Dataset inputs | Done |
| US / UK / DE marketplaces, config-driven labels and number formats | Done |
| Price, list price, discount, coupon, deal, unit price, Subscribe & Save | Done |
| Availability and delivery, localized state mapping | Done |
| BSR with source tracking, demand signal with localized magnitudes | Done |
| Ratings, review counts, histogram | Done |
| Buy Box with seller ID and AMZ/FBA/FBM classification | Done |
| Variant discovery from the twister payload, zero extra requests | Done |
| Variant `price` mode (per-child price and stock) and `full` mode | Done |
| Product content, specifications, breadcrumb, media at full resolution | Done |
| Search/listing extraction with organic vs sponsored positions | Done |
| HTTP fetcher: session pool, compression, retries, tier escalation budget | Done |
| Delivery-location priming, once per session, verified from the page | Done |
| Circuit breaker, dynamic concurrency, cooperative shutdown | Done |
| Accounting invariant, structured failures, `RUN_ABORTED` flush | Done |
| Billing abstraction, SUCCESS-only charging, charge-cap wind-down | Done |
| Golden JSON-Schema gate over every emitted record | Done |
| Storefront discovery, offers, seller intelligence, monitoring/diff, FR/IT/ES/CA | P1; not exposed as working features |
| Discovery filters, sales estimates | P2 per roadmap §13 |

```
npm ci
npm test      # 133 tests: 132 pass, 1 live-fixture test skips until captures exist
npm start     # reads storage/key_value_stores/default/INPUT.json
```

## What makes the output different

Two statuses, not one nullable field. `NOT_PRESENT` means the page loaded and Amazon did not show this. `PARSER_MISS` means it is probably there and we could not read it. Every block carries its own status, so a record with no BSR tells you which of those it was. The golden schema rejects a null with no status.

Every record carries `scrapedAt` and a `location` block. A US price from a session with no delivery location applied is not a reliable buyer price, so `location.applied` is reported per record and `requireLocation: true` turns an unlocated page into `REQUIRES_LOCATION` instead of a success.

Every input is accounted for. `uniqueInputs === success + every failure category`, asserted in code before the run summary is written. It holds when the product ceiling is hit, when the user's charge cap is reached, when the block-rate breaker trips, and when a worker throws.

Nothing is charged for a failure. Billability derives from the record's own status inside `billing/events.ts`, so no caller can charge for a `BLOCKED` row, and adding a new failure status cannot accidentally make it billable.

## Cost controls that are load-bearing

- **Compression is mandatory.** Residential proxy is billed on wire bytes and Amazon HTML compresses about 4:1.
- **Residential escalation is capped** per run as a share of requests. When the budget is spent, blocked inputs return `BLOCKED` rather than quietly spending more. `allowResidentialFallback: false` disables the tier entirely.
- **The proxy tiers are separate configurations.** A blocked datacenter request can actually move to Apify's `RESIDENTIAL` group; the tier label is not just metadata.
- **User-supplied proxies** in `proxyConfiguration.proxyUrls` keep that traffic on the customer's own provider account and off the platform bill.
- **Not-found pages are never retried or escalated.** A dog page is an answer about the product, not a transport failure.
- **`variantMode: discover` costs zero extra requests**, because the parent page's twister payload already contains the full child-ASIN-to-option matrix.

## Layout

```
.actor/                 Store manifest, input UI schema, dataset schema/views
scripts/
  capture-fixture.mjs   Capture a sanitized real page into fixtures/real/
src/
  main.ts               Input, wiring, summary. No scraping logic.
  pipeline/
    run.ts              Run loop: driver, discovery, accounting contract
    queue.ts            Work items; register-and-enqueue is one operation
  types/                status.ts (two enums), money.ts (minor units), output.ts
  input/                validation, normalization and bounded Dataset ingestion
  amazon/
    marketplace-config/ us/uk/de: hosts, number formats, label dictionaries
    number-parse.ts     locale-aware money, counts, ratings, demand
    parsers/            price, availability, bsr, ratings, buybox, identity,
                        content, media, variants, search, page-type, product
  fetch/
    http-fetcher.ts     sessions, tiers, budget, breaker, retries
    location-primer.ts  postal-code priming and verification
  quality/              completeness.ts, validation.ts (golden schema)
  billing/              events.ts (guards), apify-backend.ts (platform adapter)
  output/               accounting.ts, record-builder.ts, dataset-writer.ts, summary.ts
  tests/
    fixtures/pages.ts   Offline fixtures across the §12.1 matrix
    unit/               133 tests
```

## Fixtures

`src/tests/fixtures/pages.ts` reproduces the container IDs, class names and embedded-JSON shapes the parsers target, across US/UK/DE and the product states in §12.1: in stock, out of stock, no Buy Box, coupon/deal, limited stock, variation parent (JSON and DOM-only), legacy layout, JSON-LD-only pricing, no BSR, unrecognized availability wording, challenge page, dog page, stub page, and search pages.

These make CI runnable with no proxy spend, but they are not a substitute for real pages. Run `node scripts/capture-fixture.mjs B0CX23V2ZK US --proxy <url>` to capture a live page with session tokens, CSRF tokens and delivery addresses stripped. Captures land in `fixtures/real/` and `real-fixtures.test.ts` runs the full parser suite over each one, asserting no strategy throws and nothing session-bearing survived sanitization. That test skips cleanly when there are no captures.

Planned P1 inputs are deliberately not shown in the public Input UI. API callers that set `includeOffers`, `includeSellerDetails`, `compareWithDatasetId`, `mode: intelligence`, or `mode: monitor` receive a clear input error instead of a successful-looking no-op run.

## Before publishing

Spec §8.4 is a hard gate. Most importantly: the synthetic `apify-default-dataset-item` billing event must be removed or zero-priced in the Actor's monetization settings. This Actor writes failure rows to the default dataset by design, and that event would bill customers for them. No code can prevent it; it is a console setting.

Base pricing is open decision D1 in the spec. All charging is behind `billing/events.ts` with prices read from config, so the number can be set at publication without touching a parser.

Before Store publication, capture and commit sanitized live fixtures for US, UK and DE, run the fixed benchmark set, complete the 100-record manual audit, and confirm the pay-per-event names and prices in Apify Console.
