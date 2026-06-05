# Shopify Selectable Coupon Connector Template

This directory is the connector-side companion to the Tender selectable coupon
runtime. It is designed to be copied into a real Shopify connector source
checkout and then edited with tenant-specific IDs and URLs.

## Files

- `connector.example.json`: non-secret Tender connector metadata shape.
- `shopify.app.toml`: Shopify app configuration, scopes, and app-owned custom
  data definition for checkout coupon config.
- `extensions/coupon-widget`: Theme App Extension block that hydrates coupon
  config from Liquid and loads the hosted Tender runtime.
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
4. Save the checkout config to the automatic app discount owner metafield
   `$app/tender_coupon_config`.
5. Save the storefront config to the app-installation app-data metafield
   `app.metafields.tender.coupon_storefront_config`.
6. Create or update the automatic app discount that references the
   `selectable-coupon-discount` Function.
7. Place the app block on product and collection templates.
8. Verify PDP selection, reload persistence, cart marker behavior, and checkout
   discount enforcement.

## Cart Contract

The widget adds one private line property:

- `_tender_coupon`

The Discount Function treats that value as untrusted shopper intent. Unknown
coupon IDs, ineligible products, missing config, and tampered cart properties
must produce no discount.
