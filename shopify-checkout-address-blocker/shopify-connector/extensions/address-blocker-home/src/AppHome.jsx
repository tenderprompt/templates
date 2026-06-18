import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const METAFIELD_KEY = 'blocked_addresses';
const API_URL = 'shopify:admin/api/2026-04/graphql.json';
const VALIDATION_TITLE = 'Checkout address blocker';
const VALIDATION_HANDLE = 'address-blocker';
const EMPTY_ADDRESS = {
  address1: '',
  zip: '',
  city: '',
  provinceCode: '',
  countryCode: '',
  orderId: '',
  orderName: '',
  email: '',
  phone: '',
};

export default async () => {
  render(<App />, document.body);
};

function App() {
  const [shopId, setShopId] = useState('');
  const [shopAdminUrl, setShopAdminUrl] = useState('');
  const [addresses, setAddresses] = useState([]);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [orderLookup, setOrderLookup] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activationLoading, setActivationLoading] = useState(true);
  const [activationSaving, setActivationSaving] = useState(false);
  const [validationIds, setValidationIds] = useState([]);
  const [validationEnabled, setValidationEnabled] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadAppHome();
  }, []);

  async function shopifyGraphql(query, variables = {}) {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({query, variables}),
    });
    const payload = await response.json();

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((entry) => entry.message).join(', '));
    }

    return payload.data;
  }

  async function loadAppHome() {
    setLoading(true);
    setActivationLoading(true);
    setError('');

    try {
      const data = await shopifyGraphql(`
        query AddressBlockerHome {
          shop {
            id
            myshopifyDomain
            blockedAddresses: metafield(namespace: "$app", key: "${METAFIELD_KEY}") {
              value
            }
          }
          validations(first: 20) {
            nodes {
              id
              title
              enabled
              blockOnFailure
            }
          }
        }
      `);
      const loadedAddresses = parseAddressList(data.shop.blockedAddresses?.value ?? '');
      const validations = data.validations?.nodes ?? [];
      setShopId(data.shop.id);
      setShopAdminUrl(adminStoreUrl(data.shop.myshopifyDomain));
      setAddresses(loadedAddresses);
      setSavedAddresses(loadedAddresses);
      setValidationIds(validations.map((validation) => validation.id));
      setValidationEnabled(validations.some((validation) => validation.enabled));
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load the address blocker settings.'));
    } finally {
      setLoading(false);
      setActivationLoading(false);
    }
  }

  async function toggleValidation() {
    const nextEnabled = !validationEnabled;

    setActivationSaving(true);
    setError('');

    try {
      if (!validationIds.length && !nextEnabled) {
        setValidationEnabled(false);
        return;
      }

      const validations = validationIds.length
        ? await Promise.all(validationIds.map((id) => updateValidation(id, nextEnabled)))
        : [await createValidation(nextEnabled)];

      setValidationIds(validations.map((validation) => validation.id).filter(Boolean));
      setValidationEnabled(validations.some((validation) => validation.enabled ?? nextEnabled));
    } catch (err) {
      setValidationEnabled((current) => current);
      setError(getErrorMessage(err, 'Could not update the checkout blocker.'));
    } finally {
      setActivationSaving(false);
    }
  }

  async function createValidation(enabled) {
    const data = await shopifyGraphql(
      `
        mutation CreateAddressBlockerValidation($validation: ValidationCreateInput!) {
          validationCreate(validation: $validation) {
            validation {
              id
              title
              enabled
              blockOnFailure
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        validation: {
          title: VALIDATION_TITLE,
          functionHandle: VALIDATION_HANDLE,
          enable: enabled,
          blockOnFailure: true,
        },
      },
    );

    const userErrors = data.validationCreate.userErrors;
    if (userErrors.length) {
      throw new Error(userErrors.map((entry) => entry.message).join(', '));
    }

    return data.validationCreate.validation;
  }

  async function updateValidation(id, enabled) {
    const data = await shopifyGraphql(
      `
        mutation UpdateAddressBlockerValidation($id: ID!, $validation: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $validation) {
            validation {
              id
              title
              enabled
              blockOnFailure
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        id,
        validation: {
          title: VALIDATION_TITLE,
          enable: enabled,
          blockOnFailure: true,
        },
      },
    );

    const userErrors = data.validationUpdate.userErrors;
    if (userErrors.length) {
      throw new Error(userErrors.map((entry) => entry.message).join(', '));
    }

    return data.validationUpdate.validation;
  }

  async function saveBlockedAddresses() {
    if (!shopId) return;

    setSaving(true);
    setSaved(false);
    setError('');

    try {
      const cleanAddresses = normalizeAddresses(addresses);
      const value = stringifyAddressList(cleanAddresses);
      const nextValue = value ? await setAddressMetafield(value) : await deleteAddressMetafield();
      const nextAddresses = parseAddressList(nextValue);
      setAddresses(nextAddresses);
      setSavedAddresses(nextAddresses);
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save blocked addresses.'));
    } finally {
      setSaving(false);
    }
  }

  async function setAddressMetafield(value) {
    const data = await shopifyGraphql(
      `
        mutation SaveBlockedAddresses($ownerId: ID!, $value: String!) {
          metafieldsSet(metafields: [
            {
              ownerId: $ownerId
              namespace: "$app"
              key: "${METAFIELD_KEY}"
              value: $value
              type: "multi_line_text_field"
            }
          ]) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {ownerId: shopId, value},
    );

    const userErrors = data.metafieldsSet.userErrors;
    if (userErrors.length) {
      throw new Error(userErrors.map((entry) => entry.message).join(', '));
    }

    return data.metafieldsSet.metafields[0]?.value ?? value;
  }

  async function deleteAddressMetafield() {
    const data = await shopifyGraphql(
      `
        mutation DeleteBlockedAddresses($ownerId: ID!) {
          metafieldsDelete(metafields: [
            {
              ownerId: $ownerId
              namespace: "$app"
              key: "${METAFIELD_KEY}"
            }
          ]) {
            deletedMetafields {
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {ownerId: shopId},
    );

    const userErrors = data.metafieldsDelete.userErrors;
    if (userErrors.length) {
      throw new Error(userErrors.map((entry) => entry.message).join(', '));
    }

    return '';
  }

  async function importOrderAddress() {
    const lookup = orderLookup.trim();
    if (!lookup) return;

    setImporting(true);
    setSaved(false);
    setError('');

    try {
      const order = await findOrder(lookup);
      const address = order?.shippingAddress || order?.billingAddress;
      if (!address) {
        throw new Error('That order does not have a shipping or billing address.');
      }

      setAddresses((current) => [...current, addressFromOrder(order, address)]);
      setOrderLookup('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not import an address from that order.'));
    } finally {
      setImporting(false);
    }
  }

  async function findOrder(lookup) {
    if (lookup.startsWith('gid://shopify/Order/')) {
      const data = await shopifyGraphql(ORDER_BY_ID_QUERY, {id: lookup});
      return data.order;
    }

    const name = lookup.startsWith('#') ? lookup : `#${lookup}`;
    const data = await shopifyGraphql(ORDER_BY_NAME_QUERY, {query: `name:${name}`});
    const order = data.orders.nodes[0];

    if (order || !/^\d+$/.test(lookup)) {
      return order;
    }

    const fallback = await shopifyGraphql(ORDER_BY_ID_QUERY, {
      id: `gid://shopify/Order/${lookup}`,
    });
    return fallback.order;
  }

  function updateAddress(index, key, value) {
    setSaved(false);
    setAddresses((current) =>
      current.map((address, addressIndex) =>
        addressIndex === index ? {...address, [key]: value} : address,
      ),
    );
  }

  function addAddress() {
    setSaved(false);
    setAddresses((current) => [...current, {...EMPTY_ADDRESS}]);
  }

  function removeAddress(index) {
    setSaved(false);
    setAddresses((current) => current.filter((_, addressIndex) => addressIndex !== index));
  }

  function handleReset() {
    setAddresses(savedAddresses);
    setError('');
    setSaved(false);
  }

  const hasChanges = stringifyAddressList(addresses) !== stringifyAddressList(savedAddresses);
  const hasAddresses = addresses.length > 0;

  return (
    <s-page heading="Checkout address blocker">
      <s-button
        slot="primary-action"
        variant="primary"
        icon="save"
        disabled={loading || saving || activationSaving || !hasChanges}
        onClick={saveBlockedAddresses}
      >
        {saving ? 'Saving' : 'Save'}
      </s-button>

      <s-section heading="Checkout blocker">
        <s-stack gap="base">
          <s-switch
            label={validationEnabled ? 'Active' : 'Inactive'}
            details="When active, checkout rejects matching delivery or billing addresses."
            checked={validationEnabled}
            disabled={loading || activationLoading || activationSaving}
            onChange={toggleValidation}
          />
        </s-stack>
      </s-section>

      <s-section heading="Import from order">
        <s-stack gap="base">
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
            <s-text-field
              label="Order number or ID"
              name="orderLookup"
              value={orderLookup}
              placeholder="#1001"
              disabled={loading || saving || importing}
              onInput={(event) => setOrderLookup(getInputValue(event))}
            />
            <s-button
              variant="secondary"
              icon="import"
              disabled={loading || saving || importing || !orderLookup.trim()}
              onClick={importOrderAddress}
            >
              {importing ? 'Importing' : 'Import'}
            </s-button>
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Blocked addresses">
        <s-stack gap="base">
          {error && (
            <s-banner heading="Address list was not saved" tone="critical">
              {error}
            </s-banner>
          )}

          {saved && (
            <s-banner heading="Address list saved" tone="success">
              Checkout will reject matching delivery or billing addresses.
            </s-banner>
          )}

          {!loading && !hasAddresses && (
            <s-box padding="base">
              <s-paragraph>No blocked addresses yet.</s-paragraph>
            </s-box>
          )}

          {hasAddresses && (
            <s-stack gap="small">
              {addresses.map((address, index) => (
                <s-box key={index} padding="base" border="base" borderRadius="base">
                  <s-stack gap="base">
                    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                      <s-stack gap="small">
                        <s-text type="strong">Address {index + 1}</s-text>
                        {address.orderId && (
                          <s-text>Imported from {address.orderName || 'order'}</s-text>
                        )}
                      </s-stack>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        icon="delete"
                        disabled={loading || saving}
                        onClick={() => removeAddress(index)}
                      >
                        Remove
                      </s-button>
                    </s-grid>

                    <s-text-field
                      label="Address"
                      value={address.address1}
                      disabled={loading || saving}
                      onInput={(event) => updateAddress(index, 'address1', getInputValue(event))}
                    />

                    {address.orderId && (
                      <s-text-field
                        label="Order admin URL"
                        value={orderAdminPath(shopAdminUrl, address.orderId)}
                        readOnly
                      />
                    )}

                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <s-email-field
                        label="Email"
                        value={address.email}
                        disabled={loading || saving}
                        onInput={(event) => updateAddress(index, 'email', getInputValue(event))}
                      />
                      <s-text-field
                        label="Phone"
                        value={address.phone}
                        disabled={loading || saving}
                        onInput={(event) => updateAddress(index, 'phone', getInputValue(event))}
                      />
                    </s-grid>

                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <s-text-field
                        label="Postal code"
                        value={address.zip}
                        disabled={loading || saving}
                        onInput={(event) => updateAddress(index, 'zip', getInputValue(event))}
                      />
                      <s-text-field
                        label="City"
                        value={address.city}
                        disabled={loading || saving}
                        onInput={(event) => updateAddress(index, 'city', getInputValue(event))}
                      />
                    </s-grid>

                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <s-text-field
                        label="Province"
                        value={address.provinceCode}
                        disabled={loading || saving}
                        onInput={(event) => updateAddress(index, 'provinceCode', getInputValue(event))}
                      />
                      <s-text-field
                        label="Country"
                        value={address.countryCode}
                        disabled={loading || saving}
                        onInput={(event) => updateAddress(index, 'countryCode', getInputValue(event))}
                      />
                    </s-grid>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}

          <s-stack direction="inline" gap="base">
            <s-button variant="secondary" icon="plus" disabled={loading || saving} onClick={addAddress}>
              Add address
            </s-button>
            <s-button
              variant="secondary"
              disabled={loading || saving || !hasChanges}
              onClick={handleReset}
            >
              Discard
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Matching">
        <s-unordered-list>
          <s-list-item>Address and postal code are required.</s-list-item>
          <s-list-item>City, province, and country narrow the match when present.</s-list-item>
          <s-list-item>Imported orders use the shipping address first, then billing.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

const ORDER_ADDRESS_SELECTION = `
  address1
  city
  provinceCode
  countryCodeV2
  zip
  phone
`;

const ORDER_BY_NAME_QUERY = `
  query OrderByName($query: String!) {
    orders(first: 1, query: $query) {
      nodes {
        id
        name
        email
        phone
        shippingAddress { ${ORDER_ADDRESS_SELECTION} }
        billingAddress { ${ORDER_ADDRESS_SELECTION} }
      }
    }
  }
`;

const ORDER_BY_ID_QUERY = `
  query OrderById($id: ID!) {
    order(id: $id) {
      id
      name
      email
      phone
      shippingAddress { ${ORDER_ADDRESS_SELECTION} }
      billingAddress { ${ORDER_ADDRESS_SELECTION} }
    }
  }
`;

function parseAddressList(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        address1 = '',
        zip = '',
        city = '',
        provinceCode = '',
        countryCode = '',
        orderId = '',
        orderName = '',
        email = '',
        phone = '',
      ] =
        line.split('|').map((part) => part.trim());

      return {address1, zip, city, provinceCode, countryCode, orderId, orderName, email, phone};
    });
}

function stringifyAddressList(value) {
  return normalizeAddresses(value)
    .map((address) =>
      [
        address.address1,
        address.zip,
        address.city,
        address.provinceCode,
        address.countryCode,
        address.orderId,
        address.orderName,
        address.email,
        address.phone,
      ]
        .map((part) => part.trim())
        .join(' | '),
    )
    .join('\n');
}

function normalizeAddresses(value) {
  return value
    .map((address) => ({
      address1: (address.address1 || '').trim(),
      zip: (address.zip || '').trim(),
      city: (address.city || '').trim(),
      provinceCode: (address.provinceCode || '').trim(),
      countryCode: (address.countryCode || '').trim(),
      orderId: (address.orderId || '').trim(),
      orderName: (address.orderName || '').trim(),
      email: (address.email || '').trim(),
      phone: (address.phone || '').trim(),
    }))
    .filter(
      (address) =>
        address.address1 ||
        address.zip ||
        address.city ||
        address.provinceCode ||
        address.countryCode ||
        address.email ||
        address.phone,
    );
}

function addressFromOrder(order, address) {
  return {
    address1: address.address1 || '',
    zip: address.zip || '',
    city: address.city || '',
    provinceCode: address.provinceCode || '',
    countryCode: address.countryCodeV2 || '',
    orderId: order.id || '',
    orderName: order.name || '',
    email: order.email || '',
    phone: order.phone || address.phone || '',
  };
}

function adminStoreUrl(myshopifyDomain) {
  const shopHandle = (myshopifyDomain || '').split('.')[0];
  return shopHandle ? `https://admin.shopify.com/store/${shopHandle}` : 'https://admin.shopify.com';
}

function orderAdminPath(shopAdminUrl, orderId) {
  const numericId = orderId.split('/').pop();
  return numericId ? `${shopAdminUrl}/orders/${numericId}` : `${shopAdminUrl}/orders`;
}

function getErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function getInputValue(event) {
  const target = event.target;
  return target && 'value' in target ? target.value : '';
}
