/**
 * Parser fixtures. Spec v1.1 sections 12.1, 12.2 (C16).
 *
 * These are synthetic pages that reproduce the container IDs, class names and
 * embedded-JSON shapes the parsers target, across US/UK/DE and the product
 * states in the 12.1 test matrix. They make the whole parser suite runnable
 * offline with no proxy spend.
 *
 * They are NOT a substitute for sanitized captures of real pages, which C16
 * requires and which `scripts/capture-fixture.mjs` produces. Real captures drop
 * into fixtures/real/ and the same assertions run over them. The synthetic set
 * is what keeps CI honest between captures.
 *
 * Every product fixture is padded past the 8 KB floor the page classifier uses
 * to detect Amazon's template-only responses, because a real product page is
 * hundreds of kilobytes and a short one means we were served a stub.
 */

/** Realistic filler so fixtures clear the empty-template threshold. */
function pad(): string {
    const nav = `<div class="nav-fill"><ul class="nav-ul">${'<li class="nav-li"><a class="nav-a" href="/gp/browse">Departments</a></li>'.repeat(
        12,
    )}</ul></div>`;
    const footer = `<div id="navFooter"><ul>${'<li class="nav_first"><a href="/gp/help">Help</a></li>'.repeat(10)}</ul></div>`;
    const filler = `<!-- ${'layout '.repeat(1600)} -->`;
    return `${nav}${footer}${filler}`;
}

const REVIEWS_US = `
<div id="averageCustomerReviews" data-asin="B0CX23V2ZK">
  <span id="acrPopover" title="4.6 out of 5 stars">
    <span class="a-declarative"><a><i class="a-icon a-icon-star a-star-4-5"><span class="a-icon-alt">4.6 out of 5 stars</span></i></a></span>
  </span>
  <span id="acrCustomerReviewText" class="a-size-base">1,820 ratings</span>
</div>`;

const BSR_TABLE_US = `
<div id="prodDetails">
  <table id="productDetails_detailBullets_sections1" class="a-keyvalue prodDetTable">
    <tbody>
      <tr><th class="a-color-secondary a-size-base prodDetSectionEntry">ASIN</th><td class="a-size-base">B0CX23V2ZK</td></tr>
      <tr><th class="a-color-secondary a-size-base prodDetSectionEntry">Item model number</th><td class="a-size-base">EK-1700-SS</td></tr>
      <tr><th class="a-color-secondary a-size-base prodDetSectionEntry">Manufacturer</th><td class="a-size-base">Example Brand LLC</td></tr>
      <tr><th class="a-color-secondary a-size-base prodDetSectionEntry">Item Weight</th><td class="a-size-base">2.4 pounds</td></tr>
      <tr><th class="a-color-secondary a-size-base prodDetSectionEntry">Date First Available</th><td class="a-size-base">March 14, 2024</td></tr>
      <tr>
        <th class="a-color-secondary a-size-base prodDetSectionEntry">Best Sellers Rank</th>
        <td class="a-size-base">
          #14 in Kitchen &amp; Dining (<a href="/gp/bestsellers/kitchen">See Top 100 in Kitchen &amp; Dining</a>)
          #3 in Electric Kettles
        </td>
      </tr>
    </tbody>
  </table>
</div>`;

const IMAGES_JS = `
<script type="text/javascript">
  var obj = jQuery.parseJSON('{}');
  P.when('A').register("ImageBlockATF", function(A){
    var data = {
      "colorImages": { "initial": [
        { "hiRes": "https://m.media-amazon.com/images/I/71example._AC_SL1500_.jpg", "large": "https://m.media-amazon.com/images/I/71example._AC_SX679_.jpg", "thumb": "https://m.media-amazon.com/images/I/31example._AC_US40_.jpg", "variant": "MAIN" },
        { "hiRes": "https://m.media-amazon.com/images/I/72second._AC_SL1500_.jpg", "large": "https://m.media-amazon.com/images/I/72second._AC_SX679_.jpg", "thumb": "https://m.media-amazon.com/images/I/32second._AC_US40_.jpg", "variant": "PT01" }
      ]},
      "colorToAsin": {},
      "heroImage": {}
    };
    return data;
  });
</script>
<div id="imgTagWrapperId"><img id="landingImage" alt="Example Product"
  src="https://m.media-amazon.com/images/I/71example._AC_SX679_.jpg"
  data-a-dynamic-image='{"https://m.media-amazon.com/images/I/71example._AC_SX679_.jpg":[679,679],"https://m.media-amazon.com/images/I/71example._AC_SL1500_.jpg":[1500,1500]}'></div>`;

/** US standard in-stock product: Buy Box, list price, BSR, ratings, images. */
export const US_STANDARD = `<!DOCTYPE html><html lang="en-us"><head><title>Example Product : Amazon.com</title></head><body>
<div id="dp" class="en_US"><div id="ppd">
  <span id="productTitle" class="a-size-large product-title-word-break">  Example Brand Electric Kettle, 1.7L Stainless Steel  </span>
  <a id="bylineInfo" class="a-link-normal" href="/stores/ExampleBrand/page/X">Visit the Example Brand Store</a>
  <input type="hidden" id="ASIN" name="ASIN" value="B0CX23V2ZK">
  ${REVIEWS_US}
  <div id="corePriceDisplay_desktop_feature_div">
    <div class="a-section a-spacing-none aok-align-center">
      <span class="aok-offscreen"> $24.99 with 17 percent savings </span>
      <span class="a-price priceToPay" data-a-color="base"><span class="a-offscreen">$24.99</span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">24<span class="a-price-decimal">.</span></span><span class="a-price-fraction">99</span></span></span>
      <span class="a-size-large a-color-price savingsPercentage">-17%</span>
    </div>
    <div class="a-section a-spacing-small">
      <span class="a-price a-text-price basisPrice" data-a-strike="true" data-a-color="secondary"><span class="a-offscreen">$29.99</span><span aria-hidden="true">$29.99</span></span>
      <span class="a-size-small a-color-price pricePerUnit">($14.70 / liter)</span>
    </div>
  </div>
  <div id="availability" class="a-section a-spacing-none"><span class="a-size-medium a-color-success"> In Stock </span></div>
  <div id="deliveryBlockMessage"><div id="mir-layout-DELIVERY_BLOCK"><span class="a-text-bold">FREE delivery Tuesday, March 26</span><span class="a-color-secondary">$0.00 shipping</span></div></div>
  <div id="primeBadge_feature_div"><i class="a-icon a-icon-prime"></i></div>
  <div id="tabular-buybox"><div class="tabular-buybox-container">
    <div class="tabular-buybox-text" tabular-attribute-name="Ships from"><span class="a-size-small tabular-buybox-text-message">Amazon.com</span></div>
    <div class="tabular-buybox-text" tabular-attribute-name="Sold by"><span class="a-size-small tabular-buybox-text-message"><a id="sellerProfileTriggerId" href="/sp?seller=A1EXAMPLE99&amp;asin=B0CX23V2ZK">Example Brand Direct</a></span></div>
  </div></div>
  <div id="buybox"><div id="price_inside_buybox" class="a-size-medium a-color-price">$24.99</div>
    <input type="hidden" id="merchantID" name="merchantID" value="A1EXAMPLE99">
    <div id="addToCart_feature_div"><input id="add-to-cart-button" type="submit" value="Add to Cart"></div>
  </div>
  <div id="feature-bullets" class="a-section"><ul class="a-unordered-list a-vertical a-spacing-mini">
    <li><span class="a-list-item">1.7 liter capacity with rapid boil in under 5 minutes</span></li>
    <li><span class="a-list-item">Food-grade 304 stainless steel interior</span></li>
    <li><span class="a-list-item">Auto shut-off and boil-dry protection</span></li>
    <li class="aok-hidden"><span class="a-list-item">Hidden marketing copy that should not be extracted</span></li>
  </ul></div>
  <div id="productDescription"><p>A fast, durable kettle for everyday use.</p></div>
  ${BSR_TABLE_US}
  ${IMAGES_JS}
  <div id="wayfinding-breadcrumbs_feature_div"><ul><li><a class="a-link-normal" href="/kitchen">Home &amp; Kitchen</a></li><li><a class="a-link-normal" href="/kettles">Electric Kettles</a></li></ul></div>
  <div id="socialProofingAsinFaceout_feature_div"><span class="social-proofing-faceout-title-text">2K+ bought in past month</span></div>
  <div id="aplus_feature_div"><div id="aplus">Brand story</div></div>
</div></div>${pad()}</body></html>`;

/** DE product: comma decimals, thousands periods, localized labels. */
export const DE_STANDARD = `<!DOCTYPE html><html lang="de-de"><head><title>Beispielprodukt : Amazon.de</title></head><body>
<div id="dp" class="de_DE"><div id="ppd">
  <span id="productTitle" class="a-size-large">Beispielmarke Wasserkocher, 1,7 L Edelstahl</span>
  <a id="bylineInfo" href="/stores/x">Marke: Beispielmarke</a>
  <input type="hidden" id="ASIN" value="B0DE12345K">
  <div id="averageCustomerReviews"><span id="acrPopover" title="4,6 von 5 Sternen"><i class="a-icon-star"><span class="a-icon-alt">4,6 von 5 Sternen</span></i></span>
    <span id="acrCustomerReviewText">1.820 Bewertungen</span></div>
  <div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price priceToPay"><span class="a-offscreen">1.234,56&nbsp;&euro;</span><span aria-hidden="true">1.234,56&nbsp;&euro;</span></span>
    <span class="a-price a-text-price basisPrice" data-a-strike="true"><span class="a-offscreen">1.499,00&nbsp;&euro;</span></span>
  </div>
  <div id="availability"><span class="a-size-medium a-color-success">Auf Lager</span></div>
  <div id="deliveryBlockMessage"><span class="a-text-bold">GRATIS Lieferung Dienstag, 26. M&auml;rz</span></div>
  <div id="tabular-buybox"><div class="tabular-buybox-text" tabular-attribute-name="Verkauft von"><span><a id="sellerProfileTriggerId" href="/sp?seller=A2GERMAN77">Beispielmarke DE</a></span></div>
    <div class="tabular-buybox-text" tabular-attribute-name="Versand durch"><span>Amazon</span></div></div>
  <div id="buybox"><div id="price_inside_buybox">1.234,56&nbsp;&euro;</div><div id="addToCart_feature_div"></div></div>
  <div id="feature-bullets"><ul><li><span class="a-list-item">1,7 Liter Fassungsverm&ouml;gen</span></li><li><span class="a-list-item">Edelstahl innen</span></li></ul></div>
  <div id="prodDetails"><table id="productDetails_detailBullets_sections1"><tbody>
    <tr><th>Hersteller</th><td>Beispielmarke GmbH</td></tr>
    <tr><th>Artikelgewicht</th><td>1,1 kg</td></tr>
    <tr><th>Amazon Bestseller-Rang</th><td>Nr. 14 in K&uuml;che, Haushalt &amp; Wohnen  Nr. 3 in Wasserkocher</td></tr>
  </tbody></table></div>
  ${IMAGES_JS}
  <div id="socialProofingAsinFaceout_feature_div"><span class="social-proofing-faceout-title-text">2Tsd.+ mal im letzten Monat gekauft</span></div>
</div></div>${pad()}</body></html>`;

/** UK product: pound prices, "Dispatches from" phrasing. */
export const UK_STANDARD = `<!DOCTYPE html><html lang="en-gb"><head><title>Example : Amazon.co.uk</title></head><body>
<div id="dp" class="en_GB"><div id="ppd">
  <span id="productTitle">Example Brand Electric Kettle 1.7L</span>
  <input type="hidden" id="ASIN" value="B0UK1234ZZ">
  <div id="averageCustomerReviews"><span id="acrPopover" title="4.4 out of 5 stars"></span><span id="acrCustomerReviewText">3,204 ratings</span></div>
  <div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price priceToPay"><span class="a-offscreen">&pound;1,234.56</span></span>
    <span class="a-price a-text-price basisPrice" data-a-strike="true"><span class="a-offscreen">&pound;1,499.00</span></span>
  </div>
  <div id="availability"><span class="a-color-success">In stock</span></div>
  <div id="tabular-buybox"><div class="tabular-buybox-text" tabular-attribute-name="Dispatches from"><span>Amazon</span></div>
    <div class="tabular-buybox-text" tabular-attribute-name="Sold by"><span><a id="sellerProfileTriggerId" href="/sp?seller=A3BRITISH1">Example UK Ltd</a></span></div></div>
  <div id="buybox"><div id="price_inside_buybox">&pound;1,234.56</div><div id="addToCart_feature_div"></div></div>
  <div id="prodDetails"><table id="productDetails_detailBullets_sections1"><tbody>
    <tr><th>Best Sellers Rank</th><td>#87 in Home &amp; Kitchen</td></tr>
  </tbody></table></div>
</div></div>${pad()}</body></html>`;

/** Out of stock: no price at all, which must read OUT_OF_STOCK not PARSER_MISS. */
export const US_OUT_OF_STOCK = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Discontinued Kettle</span>
  <input type="hidden" id="ASIN" value="B0OOS12345">
  <div id="averageCustomerReviews"><span id="acrPopover" title="3.9 out of 5 stars"></span><span id="acrCustomerReviewText">412 ratings</span></div>
  <div id="outOfStock" class="a-box"><div class="a-box-inner"><span class="a-size-medium a-color-price">Currently unavailable.</span>
    <span class="a-size-small">We don't know when or if this item will be back in stock.</span></div></div>
  <div id="availability"><span class="a-color-price">Currently unavailable.</span></div>
  <div id="prodDetails"><table id="productDetails_detailBullets_sections1"><tbody>
    <tr><th>Best Sellers Rank</th><td>#412,882 in Home &amp; Kitchen</td></tr></tbody></table></div>
</div></div>${pad()}</body></html>`;

/** Variation parent: twister payload carries the full child matrix (C13). */
export const US_VARIATION_PARENT = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - Multiple Colors and Sizes</span>
  <input type="hidden" id="ASIN" value="B0CHILD001">
  <div id="averageCustomerReviews"><span id="acrPopover" title="4.7 out of 5 stars"></span><span id="acrCustomerReviewText">9,140 ratings</span></div>
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">$24.99</span></span></div>
  <div id="availability"><span class="a-color-success">In Stock</span></div>
  <div id="buybox"><div id="addToCart_feature_div"></div></div>
  <script type="text/javascript">
  P.when('twister').execute(function(twister){
    var dataToReturn = {
      "parentAsin": "B0PARENT01",
      "currentAsin": "B0CHILD001",
      "dimensions": ["color_name","size_name"],
      "dimensionsDisplay": ["Color","Size"],
      "dimensionValuesDisplayData": {
        "B0CHILD001": ["Black","1.0L"],
        "B0CHILD002": ["Black","1.7L"],
        "B0CHILD003": ["Brushed Steel","1.0L"],
        "B0CHILD004": ["Brushed Steel","1.7L"],
        "B0CHILD005": ["Matte White","1.7L"]
      },
      "asinVariationValues": {},
      "variationDisplayLabels": {"color_name":"Color","size_name":"Size"}
    };
    return dataToReturn;
  });
  </script>
  <div id="twister" class="a-section">
    <div id="variation_color_name" class="a-row"><label class="a-form-label">Color:</label>
      <ul><li data-defaultasin="B0CHILD001" class="swatchAvailable"><span class="a-button-text">Black</span></li>
          <li data-defaultasin="B0CHILD003" class="swatchAvailable"><span class="a-button-text">Brushed Steel</span></li></ul></div>
    <div id="variation_size_name" class="a-row"><label class="a-form-label">Size:</label>
      <ul><li data-dp-url="/dp/B0CHILD002/ref=twister" class="swatchAvailable"><span class="a-button-text">1.7L</span></li></ul></div>
  </div>
</div></div>${pad()}</body></html>`;

/** Twister rendered only as DOM buttons: exercises the fallback path. */
export const US_VARIATION_DOM_ONLY = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - DOM Twister</span>
  <input type="hidden" id="ASIN" value="B0PARENT02">
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">$19.99</span></span></div>
  <div id="availability"><span class="a-color-success">In Stock</span></div>
  <div id="twister-plus-inline-twister">
    <div id="variation_color_name" class="a-row"><label class="a-form-label">Colour:</label>
      <ul><li data-defaultasin="B0DOMKID01" class="swatchSelect"><span class="a-button-text" title="Click to select Red">Red</span></li>
          <li data-dp-url="/Example/dp/B0DOMKID02/ref=x" class="swatchAvailable"><span class="a-button-text">Blue</span></li></ul></div>
  </div>
</div></div>${pad()}</body></html>`;

/** Coupon plus deal badge, and a price only present as a deal price. */
export const US_COUPON_DEAL = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - Limited Deal</span>
  <input type="hidden" id="ASIN" value="B0DEAL0001">
  <div id="dealBadge"><span class="a-badge-text">Limited time deal</span></div>
  <div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price priceToPay"><span class="a-offscreen">$17.49</span></span>
    <span class="a-price a-text-price basisPrice" data-a-strike="true"><span class="a-offscreen">$29.99</span></span>
  </div>
  <div id="promoPriceBlockMessage"><label id="couponText_feature" class="couponLabelText">Save 10% with coupon</label></div>
  <div id="availability"><span class="a-size-medium a-color-price">Only 3 left in stock - order soon.</span></div>
  <div id="buybox"><div id="addToCart_feature_div"></div></div>
  <div id="sns-base-price">$15.74</div>
</div></div>${pad()}</body></html>`;

/** Legacy layout: priceblock IDs, detail-bullet BSR, no core price container. */
export const US_LEGACY_LAYOUT = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - Legacy Layout</span>
  <input type="hidden" id="ASIN" value="B0LEGACY01">
  <div id="buybox"><span id="priceblock_ourprice" class="a-size-medium a-color-price">$21.95</span>
    <div id="addToCart_feature_div"></div></div>
  <div id="availability"><span class="a-color-success">In Stock</span></div>
  <div id="detailBulletsWrapper_feature_div"><div id="detailBullets_feature_div"><ul>
    <li><span class="a-list-item"><span class="a-text-bold">ASIN :</span> <span>B0LEGACY01</span></span></li>
    <li><span class="a-list-item"><span class="a-text-bold">Best Sellers Rank:</span> <span>#1,204 in Kitchen &amp; Dining</span></span></li>
    <li><span class="a-list-item"><span class="a-text-bold">Manufacturer :</span> <span>Legacy Co</span></span></li>
  </ul></div></div>
</div></div>${pad()}</body></html>`;

/** No BSR and no reviews: both must be NOT_PRESENT, never PARSER_MISS. */
export const US_NO_BSR_NO_REVIEWS = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Brand-New Kettle</span>
  <input type="hidden" id="ASIN" value="B0NEW00001">
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">$32.00</span></span></div>
  <div id="availability"><span class="a-color-success">In Stock</span></div>
  <div id="buybox"><div id="addToCart_feature_div"></div></div>
  <div id="prodDetails"><table id="productDetails_detailBullets_sections1"><tbody>
    <tr><th>Manufacturer</th><td>Example Brand LLC</td></tr></tbody></table></div>
</div></div>${pad()}</body></html>`;

/** JSON-LD is the only price source: exercises the last-resort strategy. */
export const US_JSON_LD_ONLY = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - JSON-LD Only</span>
  <input type="hidden" id="ASIN" value="B0JSONLD01">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"Example Brand Kettle",
   "offers":{"@type":"Offer","price":27.5,"priceCurrency":"USD","availability":"https://schema.org/InStock"}}
  </script>
  <div id="availability"><span class="a-color-success">In Stock</span></div>
  <div id="buybox"><div id="addToCart_feature_div"></div></div>
</div></div>${pad()}</body></html>`;

/** Unrecognized localized availability phrasing: must be a reported miss. */
export const DE_UNKNOWN_AVAILABILITY = `<!DOCTYPE html><html lang="de-de"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Beispielprodukt mit unbekanntem Lagerstatus</span>
  <input type="hidden" id="ASIN" value="B0DEUNK001">
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">24,99&nbsp;&euro;</span></span></div>
  <div id="availability"><span class="a-color-state">Wird demn&auml;chst wieder eingelagert</span></div>
  <div id="buybox"><div id="addToCart_feature_div"></div></div>
</div></div>${pad()}</body></html>`;

/** Third-party FBA seller: fulfillment must classify as FBA, not AMZ. */
export const US_THIRD_PARTY_FBA = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - Third Party</span>
  <input type="hidden" id="ASIN" value="B03P000001">
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">$26.49</span></span></div>
  <div id="availability"><span class="a-color-success">In Stock</span></div>
  <div id="tabular-buybox">
    <div class="tabular-buybox-text" tabular-attribute-name="Ships from"><span>Amazon.com</span></div>
    <div class="tabular-buybox-text" tabular-attribute-name="Sold by"><span><a id="sellerProfileTriggerId" href="/sp?seller=A9THIRD001">Kitchen Deals Co</a></span></div>
  </div>
  <div id="buybox"><div id="price_inside_buybox">$26.49</div><div id="addToCart_feature_div"></div></div>
</div></div>${pad()}</body></html>`;

/** No Buy Box at all: present:false, NOT_PRESENT, and no parser miss. */
export const US_NO_BUYBOX = `<!DOCTYPE html><html lang="en-us"><body>
<div id="dp"><div id="ppd">
  <span id="productTitle">Example Brand Kettle - No Buy Box</span>
  <input type="hidden" id="ASIN" value="B0NOBOX001">
  <div id="averageCustomerReviews"><span id="acrPopover" title="4.1 out of 5 stars"></span><span id="acrCustomerReviewText">55 ratings</span></div>
  <div id="outOfStock"><span class="a-color-price">Currently unavailable.</span></div>
  <div id="availability"><span class="a-color-price">Currently unavailable.</span></div>
</div></div>${pad()}</body></html>`;

/** Bot challenge. Returns HTTP 200 in the wild, which is the trap. */
export const CHALLENGE_PAGE = `<!DOCTYPE html><html><head><title>Amazon.com</title></head><body>
<form method="get" action="/errors/validateCaptcha" name="">
  <div class="a-box a-alert a-alert-info a-spacing-base"><h4>Enter the characters you see below</h4>
  <p class="a-last">Sorry, we just need to make sure you're not a robot. For best results, please make sure your browser is accepting cookies.</p></div>
  <div class="a-row a-spacing-large"><img src="https://images-na.ssl-images-amazon.com/captcha/x/Captcha_abc.jpg">
  <input id="captchacharacters" name="field-keywords" class="a-span12" autocomplete="off" spellcheck="false" type="text"></div>
  <p>To discuss automated access to Amazon data please contact api-services-support@amazon.com.</p>
</form></body></html>`;

/** Amazon's not-found "dog" page: a real answer, never a block. */
export const DOG_PAGE = `<!DOCTYPE html><html><head><title>Amazon.com Page Not Found</title></head><body>
<div id="g"><a href="/"><img alt="Dogs of Amazon" src="https://images-na.ssl-images-amazon.com/images/G/01/error/1._TTD_.jpg"></a></div>
<h4>We're sorry. The Web address you entered is not a functioning page on our site.</h4>
<a href="/gp/help">Go to Amazon.com's Home Page</a></body></html>`;

/** Template-only stub Amazon serves under load. Short by design. */
export const EMPTY_TEMPLATE = `<!DOCTYPE html><html><head><title>Amazon.com</title></head><body>
<div id="nav-belt"></div><div id="navFooter"></div></body></html>`;

/** Search page: two organic cards, one sponsored, pagination available. */
export const US_SEARCH_PAGE = `<!DOCTYPE html><html lang="en-us"><body>
<div class="s-desktop-content"><span data-component-type="s-result-info-bar"><h1 class="a-size-base">1-16 of 2,043 results for "electric kettle"</h1></span>
<div class="s-main-slot s-result-list">

  <div data-asin="B0SPONSOR1" data-component-type="s-search-result" class="s-result-item">
    <span class="a-color-secondary s-sponsored-label-text">Sponsored</span>
    <img class="s-image" src="https://m.media-amazon.com/images/I/61sponsor._AC_UL320_.jpg">
    <h2 class="a-size-base-plus"><a class="a-link-normal s-no-outline" href="/sponsored/dp/B0SPONSOR1/ref=sr_1_1?keywords=kettle"><span>Sponsored Brand Kettle 1.5L</span></a></h2>
    <div class="a-row"><span class="a-price"><span class="a-offscreen">$19.99</span></span></div>
    <div class="a-row"><i class="a-icon-star-small"><span class="a-icon-alt">4.2 out of 5 stars</span></i><span class="a-size-base s-underline-text">842</span></div>
    <div class="a-row"><i class="a-icon a-icon-prime"></i></div>
  </div>

  <div data-asin="B0CX23V2ZK" data-component-type="s-search-result" class="s-result-item">
    <img class="s-image" src="https://m.media-amazon.com/images/I/71example._AC_UL320_.jpg">
    <h2 class="a-size-base-plus"><a class="a-link-normal s-no-outline" href="/Example-Brand-Kettle/dp/B0CX23V2ZK/ref=sr_1_2?keywords=kettle"><span>Example Brand Electric Kettle, 1.7L Stainless Steel</span></a></h2>
    <div class="a-row"><span class="a-price"><span class="a-offscreen">$24.99</span></span>
      <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$29.99</span></span></div>
    <div class="a-row"><i class="a-icon-star-small"><span class="a-icon-alt">4.6 out of 5 stars</span></i><span class="a-size-base s-underline-text">1,820</span></div>
    <div class="a-row a-size-base a-color-secondary">2K+ bought in past month</div>
    <div class="a-row"><span class="a-badge-text">Best Seller</span></div>
    <div class="a-row" data-cy="delivery-recipe"><span>FREE delivery Tue, Mar 26</span></div>
    <div class="a-row"><i class="a-icon a-icon-prime"></i></div>
  </div>

  <div data-asin="B0SECOND01" data-component-type="s-search-result" class="s-result-item">
    <img class="s-image" src="https://m.media-amazon.com/images/I/72second._AC_UL320_.jpg">
    <h2><a class="a-link-normal s-no-outline" href="/Second/dp/B0SECOND01/ref=sr_1_3"><span>Another Brand Kettle 1.0L</span></a></h2>
    <div class="a-row"><span class="a-price"><span class="a-offscreen">$15.49</span></span></div>
    <div class="a-row"><i class="a-icon-star-small"><span class="a-icon-alt">3.8 out of 5 stars</span></i><span class="a-size-base s-underline-text">203</span></div>
  </div>

  <div data-asin="" class="s-result-item s-flex-full-width"><span>Related searches</span></div>
</div>
<span class="s-pagination-strip"><a class="s-pagination-item s-pagination-next" href="/s?k=kettle&amp;page=2">Next</a></span>
</div>${pad()}</body></html>`;

/** DE search page: comma prices, localized demand signal. */
export const DE_SEARCH_PAGE = `<!DOCTYPE html><html lang="de-de"><body>
<div class="s-main-slot s-result-list">
  <div data-asin="B0DE12345K" data-component-type="s-search-result" class="s-result-item">
    <img class="s-image" src="https://m.media-amazon.com/images/I/71de._AC_UL320_.jpg">
    <h2><a class="a-link-normal s-no-outline" href="/dp/B0DE12345K"><span>Beispielmarke Wasserkocher 1,7 L</span></a></h2>
    <div class="a-row"><span class="a-price"><span class="a-offscreen">1.234,56&nbsp;&euro;</span></span></div>
    <div class="a-row"><i class="a-icon-star-small"><span class="a-icon-alt">4,6 von 5 Sternen</span></i><span class="a-size-base s-underline-text">1.820</span></div>
    <div class="a-row a-size-base a-color-secondary">2Tsd.+ mal im letzten Monat gekauft</div>
  </div>
</div>
<span class="s-pagination-strip"><span class="s-pagination-item s-pagination-next s-pagination-disabled">Weiter</span></span>
${pad()}</body></html>`;

/** Search page with no results: notFound, not blocked. */
export const US_SEARCH_NO_RESULTS = `<!DOCTYPE html><html lang="en-us"><body>
<div class="s-desktop-content"><div class="s-no-outline"><h1 class="a-size-medium">No results for asdkjhaskjdh.</h1>
<p>Try checking your spelling or use more general terms</p></div></div>${pad()}</body></html>`;

/** Location modal, for the CSRF-token extraction test. */
export const LOCATION_MODAL = `<div id="glow-modal"><script>var CSRF_TOKEN : "gKp9Example+Token/AbC=";</script>
<input type="hidden" name="anti-csrftoken-a2z" value="gKp9Example+Token/AbC="></div>`;

export const NAV_LOCATION_APPLIED = `<html><body><div id="nav-global-location-slot">
<span id="glow-ingress-line1">Deliver to</span><span id="glow-ingress-line2">New York 10001</span></div></body></html>`;

export const NAV_LOCATION_UNSET = `<html><body><div id="nav-global-location-slot">
<span id="glow-ingress-line1">Hello</span><span id="glow-ingress-line2">Select your address</span></div></body></html>`;

/** All Offers Display AJAX fragment with two seller offers. */
export const US_OFFERS = `<div id="aod-container">
<div id="aod-filter-offer-count-string">2 offers</div>
<div id="aod-offer">
  <div id="aod-offer-heading">New</div>
  <div id="aod-offer-price"><span class="a-price"><span class="a-offscreen">$22.99</span></span></div>
  <div id="aod-offer-shipping-price">FREE Shipping</div>
  <div id="aod-offer-soldBy"><a href="/sp?seller=A1EXAMPLE01">Seller One</a></div>
  <div id="aod-offer-shipsFrom"><span class="a-size-small">Amazon.com</span></div>
  <div id="aod-offer-seller-rating">98% positive (1,234)</div>
  <div class="aod-delivery-promise">FREE delivery Tuesday</div><i class="a-icon-prime"></i>
</div>
<div id="aod-offer">
  <div id="aod-offer-heading">Used - Like New</div>
  <div id="aod-offer-price"><span class="a-price"><span class="a-offscreen">$18.50</span></span></div>
  <div class="aod-offer-shipping-price"><span class="a-offscreen">$4.49</span></div>
  <div id="aod-offer-soldBy"><a href="/sp?seller=A2EXAMPLE02">Seller Two</a></div>
  <div id="aod-offer-shipsFrom"><span class="a-size-small">Seller Two</span></div>
  <div id="aod-offer-seller-rating">95% positive (987)</div>
  <div class="aod-delivery-promise">Delivery Wednesday</div>
</div></div>`;

/** Public seller profile. Legal fields are limited to page-visible values. */
export const US_SELLER_PROFILE = `<html><body><div id="seller-profile-container">
<h1 id="sellerName">Seller One</h1>
<div id="seller-feedback-summary">98% positive (1,234)</div>
<div id="feedback-30-days">99% positive, 1% neutral, 0% negative (120)</div>
<div id="feedback-90-days">98% positive, 1% neutral, 1% negative (350)</div>
<div id="feedback-365-days">98% positive, 1% neutral, 1% negative (1,234)</div>
<div id="page-section-detail-seller-info"><table>
  <tr><th>Business Name</th><td>Example Commerce LLC</td></tr>
  <tr><th>Business Address</th><td>123 Market Street, Seattle, WA</td></tr>
  <tr><th>VAT ID</th><td>US-EXAMPLE-123</td></tr>
</table></div></div></body></html>`;
