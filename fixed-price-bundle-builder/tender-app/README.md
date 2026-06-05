# Tender Fixed-Price Bundle Runtime

This Tender app renders the storefront bundle builder custom element and
forwards sanitized analytics events to the Tender analytics binding.

## Local Development

```sh
npm install
npm run typecheck
```

When working in a real Tender app checkout, also run:

```sh
npm exec --yes @tenderprompt/cli@latest -- app doctor --dir .
```

## Runtime Inputs

The Shopify theme app block loads `client.js`, defines the
`fixed-price-bundle-builder` custom element, and passes config through a child
`<script type="application/json" data-fixed-price-bundle-config>`.

The expected config shape is:

```json
{
  "version": 1,
  "handle": "starter-fixed-price-bundles",
  "title": "Starter Fixed Price Bundles",
  "currencyCode": "USD",
  "variantGroups": [
    {
      "group": "starter-products",
      "allowDuplicateComponents": true,
      "components": [
        {
          "variantId": "11111111111111",
          "handle": "sample-product-a",
          "title": "Sample Product A",
          "imageUrl": "",
          "available": true
        }
      ]
    }
  ],
  "tiers": [
    {
      "bundleId": "starter-4-pack",
      "label": "Build a Starter 4-Pack",
      "fixedPriceCents": 4000,
      "requiredQuantity": 4,
      "parentProductHandle": "starter-bundle-4-pack",
      "parentVariantId": "99999999999999",
      "variantGroup": "starter-products"
    }
  ]
}
```

