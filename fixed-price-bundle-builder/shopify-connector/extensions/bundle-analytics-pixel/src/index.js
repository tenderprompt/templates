import {register} from "@shopify/web-pixels-extension";

const DEFAULT_SOURCE = "fixed_price_bundle_analytics_pixel";
const ALLOWED_EVENTS = new Set([
  "tender_bundle_viewed",
  "tender_bundle_detail_opened",
  "tender_bundle_quantity_changed",
  "tender_bundle_filled",
  "tender_bundle_threshold_reached",
  "tender_bundle_cart_clicked",
  "tender_bundle_cart_success",
  "tender_bundle_cart_failure",
]);
const EXPECTED_FLOW_BY_EVENT = {
  tender_bundle_viewed: {
    id: "bundle_builder",
    step: "viewed",
    order: 1,
    role: "start",
  },
  tender_bundle_detail_opened: {
    id: "bundle_builder",
    step: "detail_opened",
    order: 2,
    role: "activity",
  },
  tender_bundle_quantity_changed: {
    id: "bundle_builder",
    step: "quantity_changed",
    order: 2,
    role: "activity",
  },
  tender_bundle_filled: {
    id: "bundle_builder",
    step: "bundle_filled",
    order: 3,
    role: "milestone",
  },
  tender_bundle_threshold_reached: {
    id: "bundle_builder",
    step: "threshold_reached",
    order: 3,
    role: "milestone",
  },
  tender_bundle_cart_clicked: {
    id: "bundle_builder",
    step: "cart_clicked",
    order: 4,
    role: "milestone",
  },
  tender_bundle_cart_success: {
    id: "bundle_builder",
    step: "cart_success",
    order: 5,
    role: "outcome",
  },
  tender_bundle_cart_failure: {
    id: "bundle_builder",
    step: "cart_failure",
    order: 5,
    role: "error",
  },
};
const ALLOWED_PROPERTY_KEYS = new Set([
  "available_component_count",
  "bundle_filled",
  "bundle_group",
  "bundle_id",
  "bundle_price_cents",
  "cart_error_code",
  "cart_handoff_mode",
  "cart_line_count",
  "cart_response_ms",
  "component_available",
  "component_handle",
  "currency",
  "discount_percent",
  "discounted_bundle_value_cents",
  "expected_component_value_cents",
  "experiment_id",
  "experiment_variant",
  "implied_savings_cents",
  "interaction_source",
  "pack_size",
  "parent_availability",
  "prefill_state",
  "prefilled_units",
  "product_handle",
  "quantity_after",
  "quantity_before",
  "quantity_change",
  "remaining_units",
  "required_units",
  "seconds_since_view",
  "selected_component_handles",
  "selected_component_quantities",
  "selected_product_count",
  "shop_domain",
  "surface",
  "time_to_cart_failure_ms",
  "time_to_cart_intent_ms",
  "time_to_cart_success_ms",
  "time_to_bundle_filled_ms",
  "time_to_view_ms",
  "total_units",
  "variant_id",
]);

register(({analytics, settings}) => {
  const endpoint = isHttpsUrl(settings?.endpoint) ? settings.endpoint : "";
  const pixelSource = isSafeLabel(settings?.source)
    ? settings.source
    : DEFAULT_SOURCE;

  if (!endpoint) return;

  const forwardTenderEvent = (event) => {
    const payload = normalizePayload(event);
    if (!payload) return;

    fetch(endpoint, {
      method: "POST",
      keepalive: true,
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        ...payload,
        properties: {
          ...payload.properties,
          pixel_source: pixelSource,
          shopify_event_id: event.id || "",
          shopify_event_name: event.name || "",
          shopify_event_timestamp: event.timestamp || "",
          source: "shopify_web_pixel",
        },
      }),
    }).catch(() => undefined);
  };

  analytics.subscribe("tender_bundle_viewed", forwardTenderEvent);
  analytics.subscribe("tender_bundle_detail_opened", forwardTenderEvent);
  analytics.subscribe("tender_bundle_quantity_changed", forwardTenderEvent);
  analytics.subscribe("tender_bundle_filled", forwardTenderEvent);
  analytics.subscribe("tender_bundle_threshold_reached", forwardTenderEvent);
  analytics.subscribe("tender_bundle_cart_clicked", forwardTenderEvent);
  analytics.subscribe("tender_bundle_cart_success", forwardTenderEvent);
  analytics.subscribe("tender_bundle_cart_failure", forwardTenderEvent);
});

function normalizePayload(event) {
  const payload = getCustomData(event);
  if (!isTenderBundlePayload(payload)) return null;

  return {
    event: payload.event,
    unit: {
      type: "bundle_build",
      id: payload.unit.id,
    },
    flow: EXPECTED_FLOW_BY_EVENT[payload.event],
    properties: sanitizeProperties(payload.properties),
  };
}

function getCustomData(event) {
  if (isRecord(event?.customData)) return event.customData;
  if (isRecord(event?.data?.customData)) return event.data.customData;
  if (isRecord(event?.data)) return event.data;
  return {};
}

function isTenderBundlePayload(payload) {
  if (!isRecord(payload) || !ALLOWED_EVENTS.has(payload.event)) return false;
  if (!isRecord(payload.unit) || payload.unit.type !== "bundle_build") return false;
  if (typeof payload.unit.id !== "string") return false;
  if (!payload.unit.id.startsWith("bundle-") || payload.unit.id.length > 160) {
    return false;
  }

  const expectedFlow = EXPECTED_FLOW_BY_EVENT[payload.event];
  return (
    isRecord(payload.flow) &&
    payload.flow.id === expectedFlow.id &&
    payload.flow.step === expectedFlow.step &&
    payload.flow.order === expectedFlow.order &&
    payload.flow.role === expectedFlow.role
  );
}

function sanitizeProperties(input) {
  if (!isRecord(input)) return {};

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue;

    const sanitized = sanitizeJsonValue(value, 0);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function sanitizeJsonValue(value, depth) {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 240);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    if (depth >= 2) return undefined;
    return value
      .slice(0, 32)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    if (depth >= 2) return undefined;

    const output = {};
    for (const [key, nestedValue] of Object.entries(value).slice(0, 40)) {
      const safeValue = sanitizeJsonValue(nestedValue, depth + 1);
      if (safeValue !== undefined) output[key.slice(0, 120)] = safeValue;
    }
    return output;
  }

  return undefined;
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeLabel(value) {
  return typeof value === "string" && /^[a-z0-9_:-]{1,80}$/.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

