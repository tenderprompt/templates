export const FUNCTION_HANDLE = "bundle-transform";
export const BUNDLE_ANALYTICS_ENDPOINT = "";
export const BUNDLE_ANALYTICS_PIXEL_SOURCE = "fixed_price_bundle_analytics_pixel";

// Replace every sample ID and product handle before deploying this template.
export const BUNDLE_CONFIG = {
  version: 1,
  handle: "starter-fixed-price-bundles",
  title: "Starter Fixed Price Bundles",
  currencyCode: "USD",
  variantGroups: [
    {
      group: "starter-products",
      allowedVariantIds: [
        "11111111111111",
        "22222222222222",
        "33333333333333",
        "44444444444444",
      ],
      allowDuplicateComponents: true,
      components: [
        {
          variantId: "11111111111111",
          handle: "sample-product-a",
          title: "Sample Product A",
          imageUrl: "",
          available: true,
        },
        {
          variantId: "22222222222222",
          handle: "sample-product-b",
          title: "Sample Product B",
          imageUrl: "",
          available: true,
        },
        {
          variantId: "33333333333333",
          handle: "sample-product-c",
          title: "Sample Product C",
          imageUrl: "",
          available: true,
        },
        {
          variantId: "44444444444444",
          handle: "sample-product-d",
          title: "Sample Product D",
          imageUrl: "",
          available: true,
        },
      ],
    },
  ],
  tiers: [
    {
      bundleId: "starter-4-pack",
      label: "Build a Starter 4-Pack",
      fixedPriceCents: 4000,
      requiredQuantity: 4,
      parentProductHandle: "starter-bundle-4-pack",
      parentVariantGid: "gid://shopify/ProductVariant/99999999999999",
      variantGroup: "starter-products",
    },
  ],
};

export const BUNDLE_CONFIG_JSON = JSON.stringify(BUNDLE_CONFIG);
export const BUNDLE_CONFIG_METAFIELD = {
  key: "fixed_price_bundle_config",
  type: "json",
  value: BUNDLE_CONFIG_JSON,
};

