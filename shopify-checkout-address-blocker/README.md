# Shopify Checkout Address Blocker

Tenant-neutral Shopify connector source for a merchant-owned custom app that
blocks checkout by address, email, or phone number.

## What It Includes

- Cart and Checkout Validation Function that rejects matching checkout
  addresses or contact details.
- App Home UI extension for merchants to manage blocked entries from Shopify
  Admin.
- Order import flow that stores an order reference and pre-fills address,
  email, and phone from an existing order.
- App-owned shop metafield definition for the blocked entry list.

## Template Layout

- `shopify-connector/`: Shopify custom app source that can be deployed directly
  with Shopify CLI or through a Tender Prompt Shopify connector.
- `shopify-connector/connector.example.json`: placeholder Tender connector
  metadata. Copy it to `connector.json` and fill in merchant-specific values if
  your workflow uses connector metadata.

## Required Shopify Scopes

```text
read_orders,read_validations,write_validations
```

`read_orders` is used by App Home to ingest an existing order's address, email,
and phone. `read_validations` and `write_validations` are used to create and
toggle the checkout validation.
