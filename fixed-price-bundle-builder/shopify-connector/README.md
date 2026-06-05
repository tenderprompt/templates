# Shopify Connector Source Template

This directory is the connector-side companion to the Tender bundle runtime.
It is designed to be copied into a real Shopify connector source checkout and
then edited with tenant-specific IDs and URLs.

## Files

- `connector.example.json`: non-secret Tender connector metadata shape.
- `shopify.app.toml`: Shopify app configuration and scopes.
- `extensions/bundle-builder`: Theme App Extension block that loads the Tender
  runtime and passes bundle config into the custom element.
- `extensions/bundle-transform`: Cart Transform function that validates bundle
  cart lines and expands them into component variants at the fixed bundle price.
- `extensions/bundle-analytics-pixel`: Web Pixel that forwards Shopify Customer
  Events emitted by the runtime to the Tender app `/api/track` endpoint.
- `extensions/admin-home`: optional Admin Home panel that registers the Cart
  Transform and Web Pixel using app-owned Admin API calls.

## Setup Checklist

1. Replace placeholders in `connector.example.json` and rename it to
   `connector.json` in the real connector checkout.
2. Replace `client_id`, app name, and scopes in `shopify.app.toml`.
3. Publish the Tender app and paste its URLs into the theme app block settings
   or connector metadata.
4. Replace the sample config in `extensions/admin-home/src/bundleConfig.js`.
5. Keep the config handle in `bundleConfig.js` and
   `extensions/bundle-transform/src/cart_transform_run.graphql` in sync.
6. Build and validate locally before committing and pushing connector source.

## Cart Contract

The theme runtime adds one parent variant with:

- `_bundle_id`
- `_bundle_components`
- `_bundle_instance_id`

The Cart Transform treats those as untrusted inputs and validates them against
the app-owned config before emitting `lineExpand` operations.

