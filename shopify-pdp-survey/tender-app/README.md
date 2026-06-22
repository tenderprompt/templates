# Product Page Survey Runtime

This Tender runtime provides the storefront assets for the Shopify product page
survey template. It defines a single custom element:

```html
<tender-product-survey></tender-product-survey>
```

The runtime is deliberately client-only. It stores no responses in Tender and
does not send analytics. The Shopify app block passes the question, answers,
line property keys, and form selector through `data-*` attributes.

## Check

```bash
npm install
npm run check
```

## Publish

Publish the app, then pin the exact release URLs for `client.js` and
`styles.css` in the Shopify app block. Do not use a floating latest URL.
