# Shopify Product Page Survey Connector Template

This directory is the connector-side companion to the Tender product page survey
runtime. It is designed to be copied into a real Shopify connector source
checkout and then edited with tenant-specific IDs and pinned runtime URLs.

## Files

- `connector.example.json`: non-secret Tender connector metadata shape.
- `shopify.app.toml`: Shopify app configuration.
- `extensions/product-page-survey`: Theme App Extension source with one product
  page app block.

## Setup Checklist

1. Replace placeholders in `connector.example.json` and rename it to
   `connector.json` in the real connector checkout.
2. Replace `client_id`, app name, and URLs in `shopify.app.toml`.
3. Publish the Tender runtime.
4. Paste the exact published release URLs for `client.js` and `styles.css` into
   the Liquid version map. Do not use floating latest URLs.
5. Add the pinned release ID as an explicit `runtime_version` option.
6. Place the product page survey app block on a product template.
7. Select a survey answer and add the product to cart.
8. Confirm the cart line has `_tender_product_survey` and
   `_tender_product_survey_question`.

## Cart Contract

The widget adds private line item properties:

- `_tender_product_survey`
- `_tender_product_survey_question`

The template does not create analytics dashboards, app database tables, pixels,
or external tracking endpoints.
