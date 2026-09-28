## Amazon product data for research, monitoring, and competitive intelligence

Turn Amazon ASINs, product URLs, keywords, categories, best-seller pages, and storefronts into structured product data you can use immediately.

Amazon Product Intelligence can collect **prices, stock, ratings, reviews, Best Sellers Rank, Buy Box data, variants, product content, images, offers, seller profiles, and location-aware changes** across seven Amazon marketplaces. Choose a lightweight mode for affordable discovery or request deeper product and competitor intelligence only when you need it.

The Actor is designed for analysts, brands, agencies, sellers, developers, and automation teams that need reliable Amazon data without building and maintaining their own scraper.

## What you can do

- Track product prices, discounts, coupons, stock, and delivery information.
- Discover products from Amazon searches, categories, best-seller pages, and storefronts.
- Filter discovery results before opening product pages and spending more.
- Analyze ratings, review counts, Best Sellers Rank, demand signals, and Buy Box ownership.
- Find product variants and optionally fetch each child variant's price and availability.
- Research competing offers, fulfillment type, sellers, and public seller information.
- Compare a new run with an earlier dataset to identify meaningful product changes.
- Export results to JSON, CSV, Excel, or another Apify integration.
- Run manually, through the API, on a schedule, or as part of an automation.

## Choose the right mode

The Actor lets you match the data depth to your budget. You do not need to pay for full competitive intelligence when a listing-level result is enough.

| Mode and profile | Best for | Included data | Relative cost |
| --- | --- | --- | --- |
| **Fast** | Low-cost discovery and exact ASIN lookups | Listing price, availability signals, rating, review count, position, Prime and sponsored status | **$0.80 / 1,000 successful results** |
| **Detail + Essential** | Price and stock collection | Product-page pricing, availability, delivery, ratings and reviews | Low detail tier |
| **Detail + Catalog** | Complete product datasets | Essential data plus BSR, demand, Buy Box, variants, content, specifications and media | Standard |
| **Intelligence + Competitive** | Competitor and seller research | Catalog data plus offers and public seller profiles | Highest depth |
| **Custom** | Precise cost control | Only the blocks you select | Depends on selection |
| **Monitor** | Recurring price and product tracking | Current detail data plus comparison with an earlier dataset | Per completed check |

If you are unsure, start with **Detail + Catalog** for a complete product record. Use **Fast** for broad discovery, then run Detail or Intelligence only on the products worth deeper analysis.

## How pricing works

Amazon Product Intelligence uses pay-per-event pricing. The exact current prices are displayed in the **Pricing** section of the Actor page before you start a run.

**Fast launches at $0.0008 per successful listing result — $0.80 per 1,000.** It is the price-leading option for product discovery, large keyword lists, and lightweight ASIN checks. Blocked, missing, and invalid inputs do not generate a successful-product charge.

- Fast discovery uses the lower-priced `product-basic` event for each successful listing result.
- Essential detail results use `product-essential`.
- Catalog and other full product results use `product-detail`.
- Monitoring uses `product-check` for each completed product check.
- Deep variant requests use `variant-detail` for each successfully fetched child.
- Competitive mode can add `offer` and `seller-detail` events for the extra results it delivers.
- A failed, blocked, invalid, or not-found product is not charged as a successful product result.

You can control spending with `maxProducts`, `maxSearchPages`, `maxVariants`, and `maxOffersPerProduct`. Apify also lets you set a **maximum charge per run**, so the Actor stops adding paid work when your chosen limit is reached.

### How the modes reduce cost

Fast mode returns product discovery data directly from Amazon listing pages without opening detail pages. One keyword page can produce many billable results, which is what makes the $0.80-per-1,000 tier sustainable. It uses 512 MB by default, caps retries, and stays on the economical automatic proxy tier unless you explicitly enable `fastResidentialFallback`.

Essential retrieves only the most frequently needed detail blocks. Catalog adds complete merchandising data. Competitive makes additional requests for offers and sellers, so it should be enabled only when those insights are valuable to you. Custom mode gives you the most precise control.

For direct ASINs and product URLs, Fast mode searches Amazon for the exact ASIN and returns only the matching listing card. It still uses the `product-basic` event and never silently upgrades the request to a more expensive detail event. Choose Essential or Catalog when you need product-page fields.

## Quick start

1. Select the Amazon marketplace.
2. Add ASINs, Amazon URLs, keywords, or an existing Apify dataset.
3. Choose a mode and data profile.
4. Set `maxProducts` and any filters or optional limits.
5. Click **Start** and open the dataset when the run finishes.

### Complete product example

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

### Affordable filtered discovery

This example searches Amazon first, removes products that do not match, and fetches Essential data only for the remaining products.

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

### Competitive intelligence example

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

### Price monitoring example

Run a Catalog dataset first, then use its dataset ID as the comparison baseline.

```json
{
  "marketplace": "US",
  "asins": ["B0CX23V2ZK"],
  "mode": "monitor",
  "dataProfile": "catalog",
  "compareWithDatasetId": "PREVIOUS_DATASET_ID"
}
```

## Filter products before detail collection

Discovery filters work with keywords, category URLs, best-seller pages, and storefronts. You can combine:

- Minimum and maximum price
- Minimum rating
- Minimum review count
- Prime-only products
- Include, exclude, or keep only sponsored results
- Minimum bought-in-past-month signal
- Minimum discount percentage

When a requested signal is missing from a listing card, the product is excluded rather than guessed. The run summary reports how many products were filtered and why. Direct ASINs and direct product URLs bypass discovery filters.

## Product variants

Choose the variant depth that matches your use case:

- `none`: Skip variants.
- `discover`: Return child ASINs and option combinations from the parent page without extra child requests.
- `price`: Fetch current price and availability for each selected child.
- `full`: Produce full product records for selected child variants.

Use `maxVariants` to place a hard limit on deep child requests. Variant discovery is the best starting point because it does not need separate child-page requests.

## Supported Amazon marketplaces

| Marketplace | Domain | Currency |
| --- | --- | --- |
| United States | amazon.com | USD |
| United Kingdom | amazon.co.uk | GBP |
| Germany | amazon.de | EUR |
| France | amazon.fr | EUR |
| Italy | amazon.it | EUR |
| Spain | amazon.es | EUR |
| Canada | amazon.ca | CAD |

Reliable modes use marketplace-matched proxy locations so Amazon can return the appropriate catalog and currency. Product URLs from another supported marketplace are detected and reported correctly.

## What the output contains

Every successful product record includes identity, source, retrieval, location, and quality information. Depending on the selected profile, it can also contain:

- Current, list, unit, deal, coupon, and Subscribe & Save pricing
- Stock state, delivery message, shipping information, and seller
- Rating, review count, and rating histogram
- Best Sellers Rank and bought-in-past-month lower bound
- Buy Box seller, seller ID, and AMZ/FBA/FBM classification
- Variant dimensions, child ASINs, prices, and availability
- Bullets, specifications, breadcrumb, and product description
- Full-resolution product images and video references
- Offer condition, item price, shipping, landed price, Prime, and fulfillment
- Public seller rating, feedback windows, business fields, and source URL
- Monitoring changes such as price, discount, stock, rating, review count, Buy Box, and seller count

The output schema stays stable across profiles. Blocks you did not request use `NOT_APPLICABLE`, which means they were intentionally skipped to match your selected data depth. It does not mean the Actor failed.

## Data quality you can understand

Missing values are not all the same. Each data block reports a clear status:

- `EXTRACTED`: The value was successfully collected.
- `NOT_PRESENT`: The Amazon page loaded, but Amazon did not display the value.
- `PARSER_MISS`: The page loaded, but the value could not be read reliably.
- `NOT_APPLICABLE`: The block was not included in your selected profile.
- `REQUIRES_LOCATION`: A required delivery location could not be verified.

This distinction prevents a missing Amazon value from being confused with a scraping problem. Each row also contains quality warnings and a completeness score.

## Location-aware prices and monitoring

Amazon prices, availability, and delivery promises can change by destination. Add `postalCode` and `deliveryCountry` to request a location, and enable `requireLocation` when an unverified location should not count as a successful price observation.

Monitoring baselines are separated by marketplace, ASIN, and resolved postal code. This prevents observations from different locations from being compared as if they represented the same buyer experience.

## Reliability and large runs

The Actor uses compressed requests, reusable sessions, bounded retries, proxy rotation, marketplace-specific residential routing for full product modes, and a circuit breaker that reduces work during a block storm. Fast mode has a separate cost-protected network path; enable its optional residential fallback only when the cheaper path is being blocked. Every input is accounted for as either a successful product or a structured failure row, so inputs do not silently disappear.

The pipeline is tested with 1,000-product batches and supports larger bounded input lists. For large ASIN lists, you can paste raw JSON items or select an existing Apify dataset. The Actor uses controlled concurrency, selects 512 MB for Fast runs and 1 GB for full product runs by default, and applies your product and spending limits before scheduling more work.

Amazon can still change pages, remove products, display CAPTCHAs, or temporarily restrict access. When that happens, the Actor reports the reason instead of returning an apparently successful row full of empty values.

## Common use cases

- Amazon price and availability monitoring
- Competitor catalog and assortment research
- Buy Box and fulfillment analysis
- Product, brand, and seller research
- SEO rank and sponsored-position tracking
- Discount and deal discovery
- Variant and assortment mapping
- Product content audits
- Review and demand-signal analysis
- Scheduled datasets for dashboards, alerts, and internal tools

## FAQ

### Can I use ASINs and URLs together?

Yes. You can mix ASINs, product URLs, discovery URLs, keywords, and raw JSON items. Duplicate marketplace-ASIN-location combinations are merged by default.

### Can I scrape more than 1,000 products?

Yes. `maxProducts` defaults to 1,000 and can be increased. Large jobs take longer, so use reasonable page and variant limits and choose Fast or Essential when full Catalog data is unnecessary.

### Why are some fields marked NOT_APPLICABLE?

The field was intentionally excluded by your selected data profile. Choose Catalog, Competitive, or a Custom profile containing that block if you need it.

### Does the Actor calculate estimated sales?

The Actor returns Amazon's displayed bought-in-past-month signal as a lower bound when available. It does not invent sales estimates from unsupported assumptions.

### Can I use my own proxies?

Yes. Advanced users can provide external proxy URLs through `proxyConfiguration`. Otherwise, leave Apify Proxy enabled and the Actor manages the reliable defaults.

### Can I automate recurring checks?

Yes. Use Apify schedules, the API, webhooks, Make, Zapier, or another integration. Monitor mode can compare the current run with a previous dataset.

## Support

This Actor is actively maintained. If a result does not look right, open an issue from the Actor page and include the run ID, marketplace, and affected ASIN when possible. The developer will review it quickly and help you resolve the problem.

Feature requests and custom Amazon data workflows are also welcome.
