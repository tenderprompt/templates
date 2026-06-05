// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

/**
 * @type {CartTransformRunResult}
 */
const NO_CHANGES = {operations: []};
const PRODUCT_VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/";

/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const config = normalizeConfig(
    input.shop?.bundleConfig?.config?.jsonValue ??
      input.cartTransform?.bundleConfig?.jsonValue,
  );
  if (!config) return NO_CHANGES;

  const presentmentRate = Number(input.presentmentCurrencyRate || "1.0") || 1.0;
  const operations = [];

  for (const line of input.cart.lines) {
    const variant = asProductVariant(line.merchandise);
    if (!variant) continue;

    const selection = validateBundleLine({
      config,
      parentVariantId: variant.id,
      bundleId: line.bundleId?.value,
      componentsValue: line.bundleComponents?.value,
      lineQuantity: line.quantity,
    });
    if (!selection.valid) continue;

    operations.push({
      lineExpand: {
        cartLineId: line.id,
        title: selection.tier.label || config.title || "Bundle",
        expandedCartItems: buildExpandedCartItems(
          selection,
          variant.id,
          presentmentRate,
        ),
      },
    });
  }

  return operations.length ? {operations} : NO_CHANGES;
}

function normalizeConfig(config) {
  if (!config || typeof config !== "object") return null;
  const variantGroups = normalizeVariantGroups(config);
  const tiers = Array.isArray(config.tiers)
    ? config.tiers
        .map((tier) => normalizeTier(tier, variantGroups, config))
        .filter((tier) => {
          if (
            !tier.bundleId ||
            !tier.parentVariantGid ||
            tier.fixedPriceCents <= 0 ||
            tier.requiredQuantity <= 0
          ) {
            return false;
          }
          return tier.allowDuplicateComponents
            ? tier.allowedVariantIds.length > 0
            : tier.allowedVariantIds.length >= tier.requiredQuantity;
        })
    : [];

  if (!tiers.length) return null;
  return {
    title: stringValue(config.title),
    handle: stringValue(config.handle),
    variantGroups,
    tiers,
  };
}

function normalizeVariantGroups(config) {
  const groups = Array.isArray(config.variantGroups) ? config.variantGroups : [];
  return groups
    .map((group) => ({
      group: stringValue(group.group || group.key || group.handle),
      allowedVariantIds: normalizeVariantList(
        group.allowedVariantIds ||
          (Array.isArray(group.components)
            ? group.components.map((component) => component.variantId)
            : []),
      ),
      allowDuplicateComponents: booleanValue(group.allowDuplicateComponents, true),
    }))
    .filter((group) => group.group && group.allowedVariantIds.length);
}

function normalizeTier(tier, variantGroups, config) {
  const variantGroup =
    stringValue(tier.variantGroup || tier.variantGroupKey || tier.group) ||
    stringValue(config.handle) ||
    variantGroups[0]?.group ||
    "";
  const group = variantGroups.find((candidate) => candidate.group === variantGroup);
  const tierAllowedVariantIds = normalizeVariantList(tier.allowedVariantIds);

  return {
    bundleId: stringValue(tier.bundleId || tier.bundle_id || tier.id),
    label: stringValue(tier.label),
    variantGroup,
    parentVariantGid: normalizeVariantId(
      tier.parentVariantGid || tier.parentVariantId,
    ),
    fixedPriceCents: integerValue(tier.fixedPriceCents),
    requiredQuantity: integerValue(tier.requiredQuantity),
    allowedVariantIds: tierAllowedVariantIds.length
      ? tierAllowedVariantIds
      : group?.allowedVariantIds || [],
    allowDuplicateComponents: booleanValue(
      tier.allowDuplicateComponents,
      group?.allowDuplicateComponents ?? true,
    ),
  };
}

function validateBundleLine({
  config,
  parentVariantId,
  bundleId,
  componentsValue,
  lineQuantity,
}) {
  const components = parseComponents(componentsValue);
  const cartLineQuantity = positiveIntegerValue(lineQuantity);
  const tier = config.tiers.find(
    (candidate) =>
      candidate.parentVariantGid === parentVariantId &&
      candidate.bundleId === bundleId,
  );

  if (!tier) return {valid: false, reason: "unknown_tier"};
  if (!cartLineQuantity) return {valid: false, reason: "invalid_quantity", tier};

  const componentQuantity = componentQuantityTotal(components);
  if (componentQuantity !== tier.requiredQuantity) {
    return {valid: false, reason: "invalid_component_count", tier, components};
  }

  const allowed = new Set(tier.allowedVariantIds);
  if (components.some((component) => !allowed.has(component.merchandiseId))) {
    return {valid: false, reason: "invalid_component", tier, components};
  }

  if (!tier.allowDuplicateComponents && hasDuplicateComponents(components)) {
    return {valid: false, reason: "duplicate_component", tier, components};
  }

  return {valid: true, tier, components, lineQuantity: cartLineQuantity};
}

function parseComponents(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const byId = new Map();

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry && typeof entry === "object") {
          addComponentQuantity(
            byId,
            entry.variantId || entry.merchandiseId || entry.id,
            entry.quantity,
          );
        } else {
          addComponentQuantity(byId, entry, 1);
        }
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [variantId, quantity] of Object.entries(parsed)) {
        addComponentQuantity(byId, variantId, quantity);
      }
    }

    return [...byId.entries()].map(([merchandiseId, quantity]) => ({
      merchandiseId,
      quantity,
    }));
  } catch {
    return [];
  }
}

function addComponentQuantity(byId, variantId, quantityValue) {
  const merchandiseId = normalizeVariantId(variantId);
  const quantity = positiveIntegerValue(quantityValue);
  if (!merchandiseId || !quantity) return;
  byId.set(merchandiseId, (byId.get(merchandiseId) || 0) + quantity);
}

function buildExpandedCartItems(selection, parentVariantId, presentmentRate) {
  const units = componentUnits(selection.components);
  const prices = allocateCents(selection.tier.fixedPriceCents, units.length);
  const items = [];
  const itemIndexes = new Map();

  units.forEach((merchandiseId, index) => {
    const amount = centsToPresentmentAmount(prices[index], presentmentRate);
    const key = `${merchandiseId}:${amount}`;
    let item = items[itemIndexes.get(key)];

    if (!item) {
      item = {
        merchandiseId,
        quantity: 0,
        price: {
          adjustment: {
            fixedPricePerUnit: {amount},
          },
        },
        attributes: [
          {key: "_bundle_id", value: selection.tier.bundleId},
          {key: "_bundle_parent", value: parentVariantId},
        ],
      };
      itemIndexes.set(key, items.length);
      items.push(item);
    }

    item.quantity += selection.lineQuantity;
  });

  return items;
}

function componentUnits(components) {
  return components.flatMap((component) =>
    Array.from({length: component.quantity}, () => component.merchandiseId),
  );
}

function componentQuantityTotal(components) {
  return components.reduce((total, component) => total + component.quantity, 0);
}

function hasDuplicateComponents(components) {
  return components.some((component) => component.quantity > 1);
}

function allocateCents(totalCents, count) {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({length: count}, (_, index) =>
    base + (index < remainder ? 1 : 0),
  );
}

function centsToPresentmentAmount(cents, rate) {
  return ((cents / 100) * rate).toFixed(2);
}

function normalizeVariantList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const variantId = normalizeVariantId(value);
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    normalized.push(variantId);
  }
  return normalized;
}

function normalizeVariantId(value) {
  const raw = idValue(value);
  if (!raw) return "";
  if (raw.startsWith(PRODUCT_VARIANT_GID_PREFIX)) return raw;
  if (/^\d+$/.test(raw)) return `${PRODUCT_VARIANT_GID_PREFIX}${raw}`;
  return raw;
}

function asProductVariant(merchandise) {
  return merchandise?.__typename === "ProductVariant" ? merchandise : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function idValue(value) {
  if (typeof value === "string") return value.trim();
  if (Number.isSafeInteger(value)) return String(value);
  return "";
}

function integerValue(value) {
  return Number.isInteger(value) ? value : Number.parseInt(String(value), 10) || 0;
}

function positiveIntegerValue(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    return Number(value.trim());
  }
  return 0;
}

export const __test = {
  allocateCents,
  buildExpandedCartItems,
  componentQuantityTotal,
  normalizeConfig,
  normalizeVariantId,
  parseComponents,
  validateBundleLine,
};

