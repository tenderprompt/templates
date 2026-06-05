# Fixed-Price Bundle Builder Template

This is a standalone starter for a Tender-hosted bundle builder and the Shopify
connector source needed to install it. It is intentionally tenant-neutral: all
product IDs, variant IDs, connector IDs, app IDs, shop domains, and runtime URLs
are placeholders.

The template has two source surfaces:

- `tender-app/`: a server-backed Tender app that renders the storefront bundle
  picker and exposes `/api/track` for sanitized bundle analytics forwarding.
- `shopify-connector/`: Shopify connector source with a theme app block loader,
  Cart Transform function, web pixel, and optional Admin Home activation panel.

## Contract

The storefront runtime adds one parent bundle variant to Ajax Cart with private
line properties:

- `_bundle_id`: stable tier ID from the bundle config.
- `_bundle_components`: JSON object of component variant IDs to quantities.
- `_bundle_instance_id`: unique cart-add attempt ID for duplicate protection and
  support diagnostics.

The Cart Transform reads trusted app-owned config and expands the parent line
into real component variants at the fixed bundle price. The browser UI is never
trusted for price, allowed components, parent variants, or required quantity.

## Before Using

Replace every placeholder before deploying:

- Shopify connector ID, client ID, shop domain, extension handles if needed.
- Published Tender runtime URLs for `client.js`, `styles.css`, and `/api/track`.
- Parent bundle product handles, parent variant IDs, component variant IDs, and
  component display data.
- The fixed config handle in `bundleConfig.js` and
  `cart_transform_run.graphql` if you do not use `starter-fixed-price-bundles`.

Do not commit secrets. Shopify client secrets, Admin API tokens, and app
automation tokens should live in the connector secret store, not this source.

For connector deploys, commit and push connector source to Tender Artifact Git
before running the deploy command so the deployed app version can be traced back
to durable source.

