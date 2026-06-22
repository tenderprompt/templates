# Shopify Product Page Survey Template

This is a small starter for a product page survey app block backed by a hosted
Tender runtime. It is intentionally narrow so an agent can create, publish, and
install one verified scenario before adding more moving parts.

The template has two source surfaces:

- `tender-app/`: a Tender runtime that defines the
  `tender-product-survey` custom element.
- `shopify-connector/`: Shopify connector source with one Theme App Extension
  product page app block.

## Contract

The app block asks one product-page question and writes the shopper answer to
private cart line item properties:

- `_tender_product_survey`: selected answer.
- `_tender_product_survey_question`: question text.

The runtime writes hidden inputs for normal product forms and patches
same-origin `/cart/add` and `/cart/add.js` fetch calls for common AJAX themes.
It does not create analytics events, dashboards, app database tables, pixels, or
backend storage.

## Before Using

Replace every placeholder before deploying:

- Shopify connector ID, client ID, shop domain, and app name.
- Published Tender runtime URLs for `client.js` and `styles.css`.
- Published Tender release ID in the block version selector.
- Optional survey question and answer copy.

Do not commit secrets. Shopify client secrets and app automation tokens should
live in the connector secret store, not this source.

## Acceptance

1. Publish the Tender runtime and capture the exact release asset URLs.
2. Paste those URLs into
   `shopify-connector/extensions/product-page-survey/blocks/product_page_survey.liquid`.
3. Validate the Shopify connector source.
4. Add the app block to a product template.
5. Select a survey answer and add the product to cart.
6. Confirm the cart line has `_tender_product_survey` and
   `_tender_product_survey_question`.
