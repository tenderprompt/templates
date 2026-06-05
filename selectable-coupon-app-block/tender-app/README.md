# Tender Selectable Coupon Runtime

Tender-hosted runtime for a Shopify selectable coupon app block.

The runtime defines the `tender-coupon-widget` custom element used by the
Shopify Theme App Extension block. The widget renders a theme-native coupon
control, persists shopper selection, decorates add-to-cart forms with a small
private line property, and forwards sanitized interaction events to `/api/track`.

## Project Structure

- `app.json` defines the Tender app runtime.
- `src/` contains app source code.
- `assets/` contains browser-served files.

## Development

```bash
npm install
npm run check
```

In a real Tender app checkout, also run:

```bash
npm exec --yes @tenderprompt/cli@latest -- app doctor --dir .
```

Publish the Tender app first, then paste the published `client.js`,
`styles.css`, and `/api/track` URLs into the connector source template.
