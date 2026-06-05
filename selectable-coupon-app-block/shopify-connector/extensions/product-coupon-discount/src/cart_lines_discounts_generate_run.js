// @ts-check

const EMPTY_RESULT = { operations: [] };
const COLLECTION_GID_PREFIX = "gid://shopify/Collection/";
const PRODUCT_GID_PREFIX = "gid://shopify/Product/";
const PRODUCT_VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/";
const PRODUCT_DISCOUNT_SELECTION_STRATEGY_ALL = "ALL";

/**
 * @param {CartLinesDiscountsGenerateRunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = normalizeConfig(input.discount?.couponConfig?.jsonValue);
  if (!config) return EMPTY_RESULT;

  const coupons = new Map(config.coupons.map((coupon) => [coupon.id, coupon]));
  const candidates = [];

  for (const line of input.cart.lines) {
    const couponId = stringValue(line.tenderCoupon?.value);
    if (!couponId) continue;

    const coupon = coupons.get(couponId);
    const variant = asProductVariant(line.merchandise);
    if (!coupon || !variant || !isEligible(coupon, variant)) continue;

    candidates.push({
      message: coupon.title,
      targets: [
        {
          cartLine: {
            id: line.id,
            quantity: line.quantity
          }
        }
      ],
      value: {
        percentage: {
          value: coupon.percentage
        }
      }
    });
  }

  if (!candidates.length) return EMPTY_RESULT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: PRODUCT_DISCOUNT_SELECTION_STRATEGY_ALL
        }
      }
    ]
  };
}

function normalizeConfig(config) {
  if (!config || typeof config !== "object") return null;
  const coupons = Array.isArray(config.coupons)
    ? config.coupons.map(normalizeCoupon).filter(Boolean)
    : [];
  if (!coupons.length) return null;
  return { coupons };
}

function normalizeCoupon(coupon) {
  if (!coupon || typeof coupon !== "object") return null;

  const id = stringValue(coupon.id || coupon.handle);
  const percentage = percentageValue(coupon.percentage || coupon.value);
  if (!id || !percentage) return null;

  return {
    id,
    title: stringValue(coupon.title) || `${percentage}% off`,
    percentage,
    allProducts: coupon.allProducts === true,
    eligibleCollectionIds: normalizeGidList(
      coupon.eligibleCollectionIds,
      COLLECTION_GID_PREFIX
    ),
    eligibleProductIds: normalizeGidList(coupon.eligibleProductIds, PRODUCT_GID_PREFIX),
    eligibleVariantIds: normalizeGidList(
      coupon.eligibleVariantIds,
      PRODUCT_VARIANT_GID_PREFIX
    )
  };
}

function isEligible(coupon, variant) {
  if (coupon.allProducts) return true;
  if (coupon.eligibleVariantIds.includes(variant.id)) return true;
  if (coupon.eligibleProductIds.includes(variant.product.id)) return true;
  if (
    coupon.eligibleCollectionIds.length > 0 &&
    variant.product.inConfiguredCollections === true
  ) {
    return true;
  }
  return false;
}

function normalizeGidList(values, prefix) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const id = normalizeGid(value, prefix);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function normalizeGid(value, prefix) {
  const raw = stringValue(value);
  if (!raw) return "";
  if (raw.startsWith(prefix)) return raw;
  if (/^\d+$/.test(raw)) return `${prefix}${raw}`;
  return "";
}

function asProductVariant(merchandise) {
  return merchandise?.__typename === "ProductVariant" ? merchandise : null;
}

function percentageValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100) return "";
  return numeric.toFixed(1);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export const __test = {
  normalizeConfig,
  isEligible,
  percentageValue
};
