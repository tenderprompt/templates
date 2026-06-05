import {h, render} from "preact";
import {useEffect, useMemo, useState} from "preact/hooks";
import {
  BUNDLE_ANALYTICS_ENDPOINT,
  BUNDLE_ANALYTICS_PIXEL_SOURCE,
  BUNDLE_CONFIG,
  BUNDLE_CONFIG_METAFIELD,
  FUNCTION_HANDLE,
} from "./bundleConfig.js";

const WEB_PIXEL_SETTINGS = {
  endpoint: BUNDLE_ANALYTICS_ENDPOINT,
  source: BUNDLE_ANALYTICS_PIXEL_SOURCE,
};

const LIVE_STATE_QUERY = `query BundleActivationState {
  shopifyFunctions(first: 50) {
    nodes {
      id
      title
      handle
      apiType
      apiVersion
    }
  }
  cartTransforms(first: 20) {
    nodes {
      id
      functionId
      blockOnFailure
      bundleConfig: metafield(namespace: "$app", key: "fixed_price_bundle_config") {
        id
        namespace
        key
        jsonValue
      }
    }
  }
}`;

const WEB_PIXEL_STATE_QUERY = `query BundleAnalyticsPixelState {
  webPixel {
    id
    settings
  }
}`;

const CREATE_CART_TRANSFORM_MUTATION = `mutation CreateCartTransform($functionHandle: String!, $metafields: [MetafieldInput!]) {
  cartTransformCreate(
    functionHandle: $functionHandle
    blockOnFailure: true
    metafields: $metafields
  ) {
    cartTransform {
      id
      functionId
      blockOnFailure
      bundleConfig: metafield(namespace: "$app", key: "fixed_price_bundle_config") {
        id
        namespace
        key
        jsonValue
      }
    }
    userErrors {
      code
      field
      message
    }
  }
}`;

const CREATE_WEB_PIXEL_MUTATION = `mutation CreateBundleAnalyticsPixel($webPixel: WebPixelInput!) {
  webPixelCreate(webPixel: $webPixel) {
    webPixel {
      id
      settings
    }
    userErrors {
      code
      field
      message
    }
  }
}`;

const UPDATE_WEB_PIXEL_MUTATION = `mutation UpdateBundleAnalyticsPixel($id: ID!, $webPixel: WebPixelInput!) {
  webPixelUpdate(id: $id, webPixel: $webPixel) {
    webPixel {
      id
      settings
    }
    userErrors {
      code
      field
      message
    }
  }
}`;

export default async () => {
  render(h(BundleSetupHome, {}), document.body);
};

function BundleSetupHome() {
  const [status, setStatus] = useState("loading");
  const [state, setState] = useState(null);
  const [message, setMessage] = useState("");

  const bundleFunction = useMemo(
    () =>
      state?.shopifyFunctions?.nodes?.find(
        (node) => node.handle === FUNCTION_HANDLE,
      ) ?? null,
    [state],
  );
  const activeTransform = useMemo(
    () =>
      state?.cartTransforms?.nodes?.find(
        (node) => node.bundleConfig?.jsonValue?.handle === BUNDLE_CONFIG.handle,
      ) ?? null,
    [state],
  );
  const activeBundlePixel = useMemo(
    () => (hasActiveBundlePixel(state?.webPixel) ? state.webPixel : null),
    [state],
  );

  useEffect(() => {
    refreshState();
  }, []);

  async function runAdminQuery(query, variables = {}) {
    const response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      body: JSON.stringify({query, variables}),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error("Admin API request failed.");
    }
    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message).join("; "));
    }
    return result.data;
  }

  async function refreshState() {
    setStatus("loading");
    setMessage("");
    setShopifyLoading(true);
    try {
      const [bundleState, webPixel] = await Promise.all([
        runAdminQuery(LIVE_STATE_QUERY),
        fetchWebPixelState(),
      ]);
      setState({...bundleState, webPixel});
      setStatus("idle");
    } catch (error) {
      setStatus("failed");
      setMessage(formatError(error, "Failed to load bundle activation state."));
    } finally {
      setShopifyLoading(false);
    }
  }

  async function activateBundleTransform() {
    setStatus("activating_transform");
    setMessage("");
    setShopifyLoading(true);

    try {
      const latestState = await runAdminQuery(LIVE_STATE_QUERY);
      const existingTransform = latestState.cartTransforms.nodes.find(
        (node) => node.bundleConfig?.jsonValue?.handle === BUNDLE_CONFIG.handle,
      );

      if (!existingTransform) {
        await createCartTransform();
      }

      const [bundleState, webPixel] = await Promise.all([
        runAdminQuery(LIVE_STATE_QUERY),
        fetchWebPixelState(),
      ]);
      setState({...bundleState, webPixel});
      setStatus("idle");
      setMessage(
        existingTransform
          ? "The Cart Transform is already active."
          : "Bundle config saved on the Cart Transform.",
      );
      showToast("Bundle transform is ready");
    } catch (error) {
      setStatus("failed");
      setMessage(formatError(error, "Failed to activate bundle transform."));
      showToast("Bundle transform activation failed", true);
    } finally {
      setShopifyLoading(false);
    }
  }

  async function createCartTransform() {
    const data = await runAdminQuery(CREATE_CART_TRANSFORM_MUTATION, {
      functionHandle: FUNCTION_HANDLE,
      metafields: [BUNDLE_CONFIG_METAFIELD],
    });
    const errors = data.cartTransformCreate.userErrors;
    if (errors.length) throw new Error(formatUserErrors(errors));
  }

  async function activateAnalyticsPixel() {
    if (!isHttpsUrl(BUNDLE_ANALYTICS_ENDPOINT)) {
      setStatus("failed");
      setMessage("Configure BUNDLE_ANALYTICS_ENDPOINT before activating the pixel.");
      return;
    }

    setStatus("activating_pixel");
    setMessage("");
    setShopifyLoading(true);

    try {
      const existingPixel = await fetchWebPixelState();
      if (existingPixel?.id) {
        await updateWebPixel(existingPixel.id);
      } else {
        await createWebPixel();
      }

      const [bundleState, webPixel] = await Promise.all([
        runAdminQuery(LIVE_STATE_QUERY),
        fetchWebPixelState(),
      ]);
      setState({...bundleState, webPixel});
      setStatus("idle");
      setMessage(
        existingPixel?.id
          ? "Bundle analytics pixel settings updated."
          : "Bundle analytics pixel activated.",
      );
      showToast("Bundle analytics pixel is ready");
    } catch (error) {
      setStatus("failed");
      setMessage(formatError(error, "Failed to activate bundle analytics pixel."));
      showToast("Bundle analytics pixel activation failed", true);
    } finally {
      setShopifyLoading(false);
    }
  }

  async function fetchWebPixelState() {
    try {
      const data = await runAdminQuery(WEB_PIXEL_STATE_QUERY);
      return data.webPixel ?? null;
    } catch (error) {
      if (isMissingWebPixelError(error)) return null;
      throw error;
    }
  }

  async function createWebPixel() {
    const data = await runAdminQuery(CREATE_WEB_PIXEL_MUTATION, {
      webPixel: {settings: WEB_PIXEL_SETTINGS},
    });
    const errors = data.webPixelCreate.userErrors;
    if (errors.length) throw new Error(formatUserErrors(errors));
  }

  async function updateWebPixel(id) {
    const data = await runAdminQuery(UPDATE_WEB_PIXEL_MUTATION, {
      id,
      webPixel: {settings: WEB_PIXEL_SETTINGS},
    });
    const errors = data.webPixelUpdate.userErrors;
    if (errors.length) throw new Error(formatUserErrors(errors));
  }

  const isLoading = status === "loading";
  const isActivatingTransform = status === "activating_transform";
  const isActivatingPixel = status === "activating_pixel";
  const functionStatus = bundleFunction ? "Deployed" : "Missing";
  const transformStatus = activeTransform ? "Active" : "Not active";
  const pixelStatus = activeBundlePixel
    ? "Active"
    : state?.webPixel
      ? "Needs update"
      : "Not active";
  const hasPixelEndpoint = isHttpsUrl(BUNDLE_ANALYTICS_ENDPOINT);

  return (
    <s-page heading="Bundle setup">
      <s-button
        slot="primary-action"
        variant="primary"
        loading={isActivatingTransform}
        disabled={isLoading || isActivatingTransform || !bundleFunction}
        onClick={activateBundleTransform}
      >
        Activate bundle transform
      </s-button>

      {message && (
        <s-section>
          <s-banner tone={status === "failed" ? "critical" : "success"}>
            {message}
          </s-banner>
        </s-section>
      )}

      <s-section heading="Bundle transform">
        <s-stack direction="block" gap="base">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Item</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              <s-table-row>
                <s-table-cell>Cart Transform function</s-table-cell>
                <s-table-cell>
                  <s-badge tone={bundleFunction ? "success" : "critical"}>
                    {isLoading ? "Checking" : functionStatus}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
              <s-table-row>
                <s-table-cell>Shop registration</s-table-cell>
                <s-table-cell>
                  <s-badge tone={activeTransform ? "success" : "neutral"}>
                    {isLoading ? "Checking" : transformStatus}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Bundle analytics pixel">
        <s-stack direction="block" gap="base">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Item</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              <s-table-row>
                <s-table-cell>Web pixel registration</s-table-cell>
                <s-table-cell>
                  <s-badge tone={activeBundlePixel ? "success" : "neutral"}>
                    {isLoading ? "Checking" : pixelStatus}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
              <s-table-row>
                <s-table-cell>Forwarding endpoint</s-table-cell>
                <s-table-cell>
                  {hasPixelEndpoint ? BUNDLE_ANALYTICS_ENDPOINT : "Not configured"}
                </s-table-cell>
              </s-table-row>
            </s-table-body>
          </s-table>
          <s-button
            variant="primary"
            loading={isActivatingPixel}
            disabled={isLoading || isActivatingPixel || !hasPixelEndpoint}
            onClick={activateAnalyticsPixel}
          >
            {activeBundlePixel ? "Update analytics pixel" : "Activate analytics pixel"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Included bundles">
        <s-unordered-list>
          {BUNDLE_CONFIG.tiers.map((tier) => (
            <s-list-item key={tier.bundleId}>
              {tier.label}: {formatCurrency(tier.fixedPriceCents)}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function hasActiveBundlePixel(webPixel) {
  const settings = parseWebPixelSettings(webPixel?.settings);
  return (
    settings?.endpoint === BUNDLE_ANALYTICS_ENDPOINT &&
    settings?.source === BUNDLE_ANALYTICS_PIXEL_SOURCE
  );
}

function parseWebPixelSettings(settings) {
  if (!settings) return null;
  if (typeof settings === "object") return settings;
  if (typeof settings !== "string") return null;

  try {
    return JSON.parse(settings);
  } catch {
    return null;
  }
}

function isMissingWebPixelError(error) {
  return (
    error instanceof Error &&
    /no web pixel was found for this app/i.test(error.message)
  );
}

function formatUserErrors(errors) {
  return errors
    .map((error) => {
      const field = Array.isArray(error.field) ? `${error.field.join(".")}: ` : "";
      return `${field}${error.message}`;
    })
    .join("; ");
}

function formatError(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function formatCurrency(cents) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: BUNDLE_CONFIG.currencyCode,
  });
}

function setShopifyLoading(value) {
  if (typeof globalThis.shopify?.loading === "function") {
    globalThis.shopify.loading(value);
  }
}

function showToast(message, isError = false) {
  if (typeof globalThis.shopify?.toast?.show === "function") {
    globalThis.shopify.toast.show(message, isError ? {isError: true} : undefined);
  }
}

