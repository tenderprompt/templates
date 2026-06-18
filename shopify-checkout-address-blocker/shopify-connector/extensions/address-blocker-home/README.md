# address-blocker-home

App Home UI extension for the Shopify Checkout Address Blocker template.

This extension gives merchants a Shopify Admin surface to manage the checkout
block list used by the `address-blocker` Cart and Checkout Validation Function.

## What It Does

- Shows whether the checkout blocker validation is active.
- Creates or updates the Shopify validation when the merchant toggles the
  blocker.
- Lets merchants add, edit, remove, and save blocked entries.
- Imports a blocked entry from an existing order by order number or Shopify
  order ID.
- Stores order references, address fields, email, and phone in the app-owned
  shop metafield read by the checkout Function.

## Blocked Entry Format

Entries are persisted in the `blocked_addresses` app-owned shop metafield as one
pipe-delimited line per entry:

```text
address line 1 | postal code | city | province code | country code | order id | order name | email | phone
```

Address line 1 and postal code are required for address matching. Email and
phone are optional and can block checkout on their own.

## Admin API Access

The extension uses App Home direct Admin GraphQL access. The Shopify app needs:

```text
read_orders,read_validations,write_validations
```

- `read_orders`: import address, email, and phone from an order.
- `read_validations`: read the current checkout validation state.
- `write_validations`: create or toggle the checkout validation.

The app configuration must also enable embedded direct API access:

```toml
[access.admin]
embedded_app_direct_api_access = true
direct_api_mode = "online"
```

## Development

This extension is deployed as part of the Shopify app source in
`shopify-connector`.

```sh
npx --yes @shopify/cli@latest app config validate --path . --json
npx --yes @shopify/cli@latest app deploy --path . --allow-updates
```

## Related Files

- `src/AppHome.jsx`: App Home UI and Admin GraphQL calls.
- `../address-blocker`: Cart and Checkout Validation Function that enforces the
  saved block list.
