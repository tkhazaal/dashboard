// Shared product-family resolver. SamCart uses many channel-specific product
// names (orders → internal_product_name like "RSK Facebook Ads", "RM Upsell …")
// and many checkout slugs (page views → "the-repair-map-copy-fujdq",
// "cutoff-culture-the-new-rules-of-familyrepair-67"). Both collapse to one clean
// family name so orders and views join on the same product.
function cleanProduct(input) {
  const t = String(input || '').trim();
  if (!t) return 'Unknown';
  if (/cutoff.?culture|\bcc\b/i.test(t)) return 'Cutoff Culture';
  if (/reconnect.?starter|\brsk\b/i.test(t)) return 'Reconnect Starter Kit';
  if (/100.?\+?.?scripts|scripts.?(&|and|\+)?.?prompts|scripts.?bundle/i.test(t)) return '100 Scripts Bundle';
  if (/father/i.test(t)) return "Father's Day Launch";
  if (/repair.?map|\brm\b/i.test(t)) return 'Repair Map';
  // Unknown product: canonicalize so a checkout slug and its display name collapse
  // to the same string (strip editor cruft + a trailing random slug suffix), then
  // title-case. This keeps orders and views joining even for new/unmapped products.
  const canon = t.toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\b(copy|upsell|bump|order|new|final|old|test|v\d+)\b/g, ' ')
    .replace(/\s+[a-z0-9]{4,6}$/, '')          // trailing random slug suffix e.g. " fujdq"
    .replace(/\s+/g, ' ').trim();
  return (canon || t.toLowerCase()).replace(/\b\w/g, c => c.toUpperCase());
}

// Extract a product family from a page URL that points at a SamCart checkout
// (…/products/<slug>, …/product/<slug>, …/checkout/<slug>) or a GHL confirmation
// page (…/<product>-confirmation). Mirrors the breadth of isCheckoutUrl.
function productFromUrl(url) {
  const u = String(url || '');
  const m = u.match(/\/products?\/([^/?#]+)/i)
        || u.match(/\/checkout\/([^/?#]+)/i)
        || u.match(/\/([a-z0-9-]+)-confirmation/i);
  return m ? cleanProduct(m[1]) : '';
}

module.exports = { cleanProduct, productFromUrl };
