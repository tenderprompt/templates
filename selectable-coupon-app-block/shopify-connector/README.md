# Shopify Selectable Coupon Connector Template

This directory is the connector-side companion to the Tender selectable coupon
runtime. It is designed to be copied into a real Shopify connector source
checkout and then edited with tenant-specific IDs and URLs.

## Files

- `connector.example.json`: non-secret Tender connector metadata shape.
- `shopify.app.toml`: Shopify app configuration and the minimum Admin API
  scopes required for product reads and discount activation.
- `extensions/coupon-widget`: Theme App Extension source with a product app
  block and a collection app embed. Both hydrate coupon config from Liquid and
  load the hosted Tender runtime from the published Tender app host.
- `extensions/product-coupon-discount`: Discount Function that validates
  `_tender_coupon` cart-line markers against trusted app-owned config.
- `extensions/admin-home`: minimal App Home starter that documents the setup
  path and where merchants should manage coupon config.

## Setup Checklist

1. Replace placeholders in `connector.example.json` and rename it to
   `connector.json` in the real connector checkout.
2. Replace `client_id`, app name, scopes, and URLs in `shopify.app.toml`.
3. Publish the Tender app and paste its `client.js`, `styles.css`, and
   `/api/track` URLs into the Liquid version map.
4. Create or update the automatic app discount that references the
   `selectable-coupon-discount` Function.
5. Save the storefront config to the app-installation app-data metafield
   `app.metafields.tender.coupon_storefront_config`.
6. Save the checkout config on the automatic app discount owner metafield
   `$app/tender_coupon_config`; the Function reads that metafield through
   `extensions/product-coupon-discount/shopify.extension.toml`.
7. Place the product app block on product templates.
8. Activate and save the Collection coupons app embed for collection templates.
9. Verify PDP selection, collection-card selection, reload persistence, cart
   marker behavior, AJAX add-to-cart behavior, and checkout discount enforcement.

## Cart Contract

The widget adds one private line property:

- `_tender_coupon`

The Discount Function treats that value as untrusted shopper intent. Unknown
coupon IDs, ineligible products, missing config, and tampered cart properties
must produce no discount.

The widget writes this marker through hidden form inputs and by patching
same-origin `/cart/add` and `/cart/add.js` fetch calls. Keep both paths in the
smoke test because many Online Store 2.0 themes bypass native form submit.
