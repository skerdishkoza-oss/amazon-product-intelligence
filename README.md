# Amazon Product Intelligence Actor

Extract Amazon prices, variants, BSR, stock, Buy Box, sellers, discounts, ratings and product data with explicit source and status fields, so you know whether a value is truly absent or the scraper failed.

Implements the specification through **V1.5**, including selectable data profiles, pre-fetch discovery filters and hardened monitoring semantics. TypeScript, Apify SDK v3, `got-scraping` with Crawlee's session pool. Browser rendering is deliberately absent: everything is extracted from HTML and embedded JSON.

## Build state

The P0 and P1 code paths are implemented and covered by offline fixtures. Public-release validation is still pending sanitized live captures across all seven marketplaces, the specification's 100-record manual audit, and confirmation of the pay-per-event configuration in Apify Console.

| Area | State |
| --- | --- |
| ASIN, product URL, keyword, category, best-seller, raw JSON and Apify Dataset inputs | Done |
| US / UK / DE / FR / IT / ES / CA marketplaces, config-driven labels and number formats | Done |
| Price, list price, discount, coupon, deal, unit price, Subscribe & Save | Done |
| Availability and delivery, localized state mapping | Done |
| BSR with source tracking, demand signal with localized magnitudes | Done |
| Ratings, review counts, histogram | Done |
| Buy Box with seller ID and AMZ/FBA/FBM classification | Done |
| Variant discovery from the twister payload, zero extra requests | Done |
| Variant `price` mode (per-child price and stock) and `full` mode | Done |
| Product content, specifications, breadcrumb, media at full resolution | Done |
| Search/listing extraction with organic vs sponsored positions | Done |
| Composable search filters before detail fetches and product billing | Done |
| Essential, Catalog, Competitive and Custom retrieval profiles | Done |
| Seller/storefront discovery through listing surfaces | Done |
| Bounded All Offers extraction: seller, condition, item/shipping/landed price, Prime, fulfillment | Done |
| Public seller profiles: business fields, rating/feedback windows and legal identifiers when displayed | Done |
| Location-specific prior-dataset monitoring with status-safe typed changes | Done |
| HTTP fetcher: session pool, compression, retries, tier escalation budget | Done |
| Delivery-location priming, once per session, verified from the page | Done |
| Circuit breaker, dynamic concurrency, cooperative shutdown | Done |
| Accounting invariant, structured failures, `RUN_ABORTED` settlement | Done |
| Billing abstraction, SUCCESS-only charging, charge-cap wind-down | Done |
| Golden JSON-Schema gate over every emitted record | Done |
| Sales estimates | Not implemented; raw bought-in-past-month lower bounds are returned instead |

```
npm ci
npm test      # full offline suite; live-fixture test skips until captures exist
npm start     # reads storage/key_value_stores/default/INPUT.json
```

## Input examples

Full product detail with free variant discovery:

```json
{
  "marketplace": "US",
  "asins": ["B0CX23V2ZK"],
  "mode": "detail",
  "dataProfile": "catalog",
  "variantMode": "discover",
  "postalCode": "10001",
  "requireLocation": true
}
```

Filter a search before paying for detail pages, then retrieve only the Essential blocks:

```json
{
  "marketplace": "US",
  "keywords": ["electric kettle"],
  "mode": "detail",
  "dataProfile": "essential",
  "discoveryFilters": {
    "minPrice": 20,
    "maxPrice": 80,
    "minRating": 4.3,
    "minReviewCount": 100,
    "primeOnly": true,
    "sponsoredPolicy": "exclude",
    "minBoughtInPastMonth": 500,
    "minDiscountPercent": 10
  },
  "maxProducts": 100
}
```

Offer and seller intelligence is opt-in through the Competitive profile:

```json
{
  "marketplace": "DE",
  "keywords": ["wasserkocher edelstahl"],
  "mode": "intelligence",
  "dataProfile": "competitive",
  "maxOffersPerProduct": 10,
  "maxProducts": 100
}
```

Custom profiles choose exact blocks while identity, retrieval, source, location and quality metadata remain stable:

```json
{
  "marketplace": "UK",
  "asins": ["B0CX23V2ZK"],
  "dataProfile": "custom",
  "dataBlocks": ["pricing", "availability", "buyBox", "offers"],
  "maxOffersPerProduct": 5
}
```

## Retrieval profiles and billing events

If `dataProfile` is omitted, Fast mode uses Essential and other modes use Catalog. Blocks that were not purchased remain present in the stable output schema with `status: "NOT_APPLICABLE"`. Every success row includes `retrieval.profile`, `retrieval.requestedBlocks` and `retrieval.billingEvent`, so a buyer can reconcile output depth with usage.

| Selection | Included base data | Base event |
| --- | --- | --- |
| Fast mode | Listing price, availability signals and ratings | `product-basic` |
| Essential | Pricing, availability and ratings from the detail page | `product-essential` |
| Catalog | Essential plus BSR/demand, Buy Box, variants, product content and media | `product-detail` |
| Competitive | Catalog plus bounded offers and public seller profiles | `product-detail`, plus `offer` and `seller-detail` for ancillary results |
| Custom | Exactly the selected blocks | `product-essential` when its base blocks are an Essential subset; otherwise `product-detail` |
| Monitor mode | Selected detail blocks plus a prior-dataset comparison | `product-check` |

`variantMode: price` adds `variant-detail` events for successfully extracted child values. The legacy `includeOffers` and `includeSellerDetails` inputs remain supported and add those blocks to the selected profile.

Fast mode avoids product pages only for discovery inputs that already have listing cards. A direct ASIN or product URL has no listing card to reuse, so it performs an Essential detail fetch and uses `product-essential` rather than `product-basic`.

Discovery filters apply only to keyword, category, best-seller and storefront cards. Direct ASINs and product URLs bypass them. Thresholds are inclusive. If a requested signal is missing on a listing card, that card is excluded rather than guessed. `RUN_SUMMARY.filteredOut` reports how many cards were excluded.

Compare current state with a previous Actor dataset:

```json
{
  "marketplace": "FR",
  "asins": ["B0CX23V2ZK"],
  "mode": "monitor",
  "compareWithDatasetId": "PREVIOUS_DATASET_ID"
}
```

## Proxies

On Apify, leave `proxyConfiguration.useApifyProxy` enabled and the platform supplies the proxy connection; do not commit proxy credentials. The Actor begins with the configured primary tier and can move to a separate residential configuration after a verified block. Users may instead provide `proxyConfiguration.proxyUrls` to use their own proxy provider.

## What makes the output different

Two statuses, not one nullable field. `NOT_PRESENT` means the page loaded and Amazon did not show this. `PARSER_MISS` means it is probably there and we could not read it. Every block carries its own status, so a record with no BSR tells you which of those it was. The golden schema rejects a null with no status.

Every record carries `scrapedAt` and a `location` block. A US price from a session with no delivery location applied is not a reliable buyer price, so `location.applied` is reported per record and `requireLocation: true` turns an unlocated page into `REQUIRES_LOCATION` instead of a success.

Monitoring keys include marketplace, ASIN and resolved postal code. A New York observation therefore cannot become the baseline for a Los Angeles check. A comparison is suppressed, with a machine-readable warning, when either side has `PARSER_MISS`, `REQUIRES_LOCATION` or another untrusted block status.

Search provenance preserves absolute position, page position, organic position, sponsored position and the sponsored flag. This supports SEO and ad analysis without inferring one ranking from another.

Every input is accounted for. `uniqueInputs === success + every failure category`, asserted in code before the run summary is written. It holds when the product ceiling is hit, when the user's charge cap is reached, when the block-rate breaker trips, and when a worker throws.

Nothing is charged for a failure. Billability derives from the record's own status inside `billing/events.ts`, so no caller can charge for a `BLOCKED` row, and adding a new failure status cannot accidentally make it billable.

Successful rows are schema-validated and acknowledged by the dataset before their billing event is attempted. Base commits are serialized, so once a charge cap is observed, waiting workers become explicit `RUN_ABORTED` rows instead of emitting additional value. An acknowledged result is never removed if the billing backend subsequently fails.

## Cost controls that are load-bearing

- **Compression is mandatory.** Residential proxy is billed on wire bytes and Amazon HTML compresses about 4:1.
- **Residential escalation is capped** per run as a share of requests. When the budget is spent, blocked inputs return `BLOCKED` rather than quietly spending more. `allowResidentialFallback: false` disables the tier entirely.
- **The proxy tiers are separate configurations.** A blocked datacenter request can actually move to Apify's `RESIDENTIAL` group; the tier label is not just metadata.
- **User-supplied proxies** in `proxyConfiguration.proxyUrls` keep that traffic on the customer's own provider account and off the platform bill.
- **Not-found pages are never retried or escalated.** A dog page is an answer about the product, not a transport failure.
- **`variantMode: discover` costs zero extra requests**, because the parent page's twister payload already contains the full child-ASIN-to-option matrix.
- **Discovery filters run before product fetches**, so excluded listing cards consume neither detail-page proxy traffic nor product events.
- **Zero-result filtered runs are explainable.** `RUN_SUMMARY.filteredOut` counts rejected cards and `RUN_SUMMARY.filterRejections` aggregates failed predicates such as `NOT_PRIME` or `REVIEW_COUNT_MISSING`. A card can fail multiple predicates, so reason counts can exceed the rejected-card count.
- **`maxProducts` is reserved before concurrent work starts**, making the ceiling exact even when concurrency is higher than the limit.

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
  history/compare.ts    Prior-dataset indexing and typed field changes
  types/                status.ts (two enums), money.ts (minor units), output.ts
  input/                validation, normalization and bounded Dataset ingestion
  amazon/
    marketplace-config/ seven locales: hosts, number formats, label dictionaries
    number-parse.ts     locale-aware money, counts, ratings, demand
    parsers/            price, availability, bsr, ratings, buybox, identity,
                        content, media, variants, offers, seller, search, product
  fetch/
    http-fetcher.ts     sessions, tiers, budget, breaker, retries
    location-primer.ts  postal-code priming and verification
  quality/              completeness.ts, validation.ts (golden schema)
  billing/              events.ts (guards), apify-backend.ts (platform adapter)
  output/               accounting.ts, record-builder.ts, dataset-writer.ts, summary.ts
  tests/
    fixtures/pages.ts   Offline fixtures across the §12.1 matrix
    unit/               parser, schema, billing, accounting and pipeline tests
```

## Fixtures

`src/tests/fixtures/pages.ts` reproduces the container IDs, class names and embedded-JSON shapes the parsers target, including localized price/availability vectors for all seven marketplaces and the product states in §12.1: in stock, out of stock, no Buy Box, coupon/deal, limited stock, variation parent (JSON and DOM-only), legacy layout, JSON-LD-only pricing, no BSR, unrecognized availability wording, offers, seller profiles, challenge page, dog page, stub page, and search pages.

These make CI runnable with no proxy spend, but they are not a substitute for real pages. Run `node scripts/capture-fixture.mjs B0CX23V2ZK US --proxy <url>` to capture a live page with session tokens, CSRF tokens and delivery addresses stripped. Captures land in `fixtures/real/` and `real-fixtures.test.ts` runs the full parser suite over each one, asserting no strategy throws and nothing session-bearing survived sanitization. That test skips cleanly when there are no captures.

Competitive blocks are opt-in because they add requests and billing events. `mode: monitor` requires `compareWithDatasetId`; each successful check is billed even when no field changed, because Amazon acquisition work still occurred. Every optional block reports whether it was requested, extracted, absent, missed, or omitted by profile.

## Before publishing

Spec §8.4 is a hard gate. Most importantly: the synthetic `apify-default-dataset-item` billing event must be removed or zero-priced in the Actor's monetization settings. This Actor writes failure rows to the default dataset by design, and that event would bill customers for them. No code can prevent it; it is a console setting.

Configure `product-basic`, `product-essential`, `product-detail`, `product-check`, `variant-detail`, `offer` and `seller-detail` in Apify Console before launch. Prices remain a publication decision; the code selects events from delivered data depth, so prices can change without touching a parser.

Before Store publication, capture and commit sanitized live fixtures for US, UK, DE, FR, IT, ES and CA, run the fixed benchmark set, complete the 100-record manual audit, and confirm the pay-per-event names and prices in Apify Console. Do not market this build as fully validated until that gate passes.

For GitHub deployment, connect the repository as the Actor source in Apify Console and point it at `main`. Apify reads `.actor/actor.json`, builds the root `Dockerfile`, and exposes the declared input, output and dataset schemas. The same project can be deployed from a terminal with the official CLI after `apify auth login`, `apify validate-schema`, and `apify push`.
