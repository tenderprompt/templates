# Shopify Checkout Contact Blocker

This is a merchant-owned Shopify custom app that blocks checkout when a buyer
uses an address, email address, or phone number on a merchant-managed block
list.

It uses:

- A Shopify Cart and Checkout Validation Function to reject matching checkout
  addresses or contact details before payment.
- Shopify's new App Home UI extensions to manage the blocked list from Shopify
  Admin.
- An app-owned shop metafield to store blocked addresses, order references,
  emails, and phone numbers.

No app backend is required. The App Home extension reads and writes Shopify
Admin GraphQL directly through Shopify's embedded App Home APIs, and the
Function reads the saved app-owned metafield during checkout.

## What the Validator Does

The validation Function runs during cart and checkout validation. It checks the
cart's delivery and billing addresses, buyer email, buyer phone, and
delivery/billing address phone against the merchant's blocked list.

Each blocked entry is stored as:

```text
address line 1 | postal code | city | province code | country code | order id | order name | email | phone
```

Address line 1 and postal code are required for an address match. City,
province, and country are optional but narrow the address match when present.
Email and phone are optional, and either one can block checkout on its own.
Phone numbers are normalized to digits before matching, so formatting
differences such as spaces, dashes, or parentheses do not bypass the block.

When an entry is imported from an order, the App Home stores the order ID and
order name as a reference, then pre-fills the address, email, and phone from
that order. The App Home also shows the Shopify Admin order URL so the merchant
can open the referenced order.

When a buyer enters a matching address, email, or phone, checkout receives this
validation error:

```text
We cannot accept orders with this contact or address.
```

## What Lives Here

- `shopify.app.toml`: Shopify app configuration, Admin API scopes, and the
  app-owned shop metafield definition.
- `extensions/address-blocker`: Cart and Checkout Validation Function source.
- `extensions/address-blocker-home`: App Home UI extension for managing blocked
  addresses.
- `connector.example.json`: Non-secret Tender Prompt metadata template for
  connector source workflows. It is not required for direct Shopify CLI deploys.

## Secrets

Do not commit Shopify client secrets, Admin API tokens, or app automation
tokens. The Shopify Client ID is not secret and belongs in `shopify.app.toml`.

## Deploy Without Tender Prompt

Use this path if you are deploying the app yourself with Shopify CLI.

### 1. Create a Merchant-Owned Shopify Custom App

Open Shopify Admin for your store:

```text
https://admin.shopify.com/store/<shop-handle>/settings/apps/development
```

Click **Build apps in Dev Dashboard**, create a custom app, and copy the Client
ID.

Generate an app automation token for deploys if your Shopify setup uses
automation-token deployments. Treat the app automation token as a secret.

### 2. Configure the Client ID

Set the custom app Client ID in `shopify.app.toml`:

```toml
client_id = "<shopify-client-id>"
```

Keep the required scopes:

```toml
[access_scopes]
scopes = "read_orders,read_validations,write_validations"
```

`read_orders` lets the App Home import blocked address, email, and phone details
from an order.
`read_validations` and `write_validations` are used for checkout validation
management.

### 3. Install Dependencies

```sh
npm install
cd extensions/address-blocker
npm install
cd ../..
```

### 4. Validate Configuration

```sh
npx --yes @shopify/cli@latest app config validate --path . --json
```

### 5. Test the Function

```sh
cd extensions/address-blocker
npm test
cd ../..
```

### 6. Deploy

Authenticate Shopify CLI for your app deployment method, then deploy:

```sh
npx --yes @shopify/cli@latest app deploy --path . --allow-updates
```

After deploy, open the app in Shopify Admin. If Shopify asks to approve updated
scopes, approve them before using the order import feature.

## Deploy With Tender Prompt

You can use [Tender Prompt](https://tenderprompt.com/) to create and deploy
merchant-owned Shopify custom apps like this one. Tender Prompt helps agents
bootstrap the Shopify app source, manage the connector workflow, and deploy
through the merchant's custom app while keeping the Client secret and app
automation token outside this source tree.

If you have access to Tender Prompt, give this prompt to your agent:

```text
Using tender prompt to build and deploy this custom app: https://github.com/tenderprompt/templates/shopify-checkout-address-blocker
```

## Built with Tender Prompt

This Shopify app source was built with [Tender Prompt](https://tenderprompt.com/).
