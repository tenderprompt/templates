import { DurableObject } from "cloudflare:workers";

import type { AppEnv } from "./env";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type AnalyticsForwardRequest = {
	event?: unknown;
	unit?: unknown;
	flow?: unknown;
	properties?: unknown;
};

const TRACK_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const ALLOWED_BUNDLE_EVENTS = new Set([
	"tender_bundle_viewed",
	"tender_bundle_detail_opened",
	"tender_bundle_pack_link_clicked",
	"tender_bundle_quantity_changed",
	"tender_bundle_filled",
	"tender_bundle_threshold_reached",
	"tender_bundle_cart_clicked",
	"tender_bundle_cart_success",
	"tender_bundle_cart_failure",
]);

const EXPECTED_FLOW_BY_EVENT: Record<
	string,
	{
		id: "bundle_builder";
		step: string;
		order: number;
		role: "start" | "milestone" | "activity" | "outcome" | "error";
	}
> = {
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
	tender_bundle_pack_link_clicked: {
		id: "bundle_builder",
		step: "pack_link_clicked",
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
	"pixel_source",
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
	"shopify_event_id",
	"shopify_event_name",
	"shopify_event_timestamp",
	"source",
	"surface",
	"time_to_cart_failure_ms",
	"time_to_cart_intent_ms",
	"time_to_cart_success_ms",
	"time_to_bundle_filled_ms",
	"time_to_view_ms",
	"total_units",
	"variant_id",
]);

export class App extends DurableObject<AppEnv> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/api/track") {
			return this.handleAnalyticsTrack(request);
		}

		return Response.json({ ok: false, reasonCode: "not_found" }, { status: 404 });
	}

	private async handleAnalyticsTrack(request: Request): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: TRACK_CORS_HEADERS,
			});
		}

		if (request.method !== "POST") {
			return Response.json(
				{ ok: false, reasonCode: "method_not_allowed" },
				{ status: 405, headers: TRACK_CORS_HEADERS }
			);
		}

		const input = (await request.json().catch(() => null)) as
			| AnalyticsForwardRequest
			| null;
		const payload = normalizeAnalyticsPayload(input);

		if (!payload) {
			return Response.json(
				{ ok: false, reasonCode: "invalid_analytics_payload" },
				{ status: 400, headers: TRACK_CORS_HEADERS }
			);
		}

		const result = await this.env.__TP_ANALYTICS.invoke({
			method: "track",
			payload,
		});

		if (!result.ok) {
			return Response.json(result, {
				status: 422,
				headers: TRACK_CORS_HEADERS,
			});
		}

		return Response.json({ ok: true }, { headers: TRACK_CORS_HEADERS });
	}
}

function normalizeAnalyticsPayload(input: AnalyticsForwardRequest | null) {
	if (!input || typeof input.event !== "string") return null;
	if (!ALLOWED_BUNDLE_EVENTS.has(input.event)) return null;

	const unit = normalizeUnit(input.unit);
	if (!unit) return null;

	const flow = normalizeFlow(input.event, input.flow);
	if (!flow) return null;

	return {
		event: input.event,
		unit,
		flow,
		properties: sanitizeProperties(input.properties),
	};
}

function normalizeUnit(input: unknown) {
	if (!isRecord(input)) return null;
	if (input.type !== "bundle_build") return null;
	if (typeof input.id !== "string") return null;

	const id = input.id.trim();
	if (!id.startsWith("bundle-") || id.length > 160) return null;

	return { type: "bundle_build", id };
}

function normalizeFlow(eventName: string, input: unknown) {
	if (!isRecord(input)) return null;
	const expected = EXPECTED_FLOW_BY_EVENT[eventName];
	if (!expected) return null;

	if (
		input.id !== expected.id ||
		input.step !== expected.step ||
		input.order !== expected.order ||
		input.role !== expected.role
	) {
		return null;
	}

	return expected;
}

function sanitizeProperties(input: unknown): JsonObject {
	if (!isRecord(input)) return {};

	const output: JsonObject = {};
	for (const [key, value] of Object.entries(input)) {
		if (!ALLOWED_PROPERTY_KEYS.has(key)) continue;

		const sanitized = sanitizeJsonValue(value, 0);
		if (sanitized !== undefined) {
			output[key] = sanitized;
		}
	}

	return output;
}

function sanitizeJsonValue(value: unknown, depth: number): JsonValue | undefined {
	if (value === null) return null;

	if (typeof value === "string") {
		return value.slice(0, 240);
	}

	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}

	if (typeof value === "boolean") {
		return value;
	}

	if (Array.isArray(value)) {
		if (depth >= 2) return undefined;
		return value
			.slice(0, 32)
			.map((item) => sanitizeJsonValue(item, depth + 1))
			.filter((item): item is JsonValue => item !== undefined);
	}

	if (isRecord(value)) {
		if (depth >= 2) return undefined;

		const output: JsonObject = {};
		for (const [key, nestedValue] of Object.entries(value).slice(0, 40)) {
			const safeKey = key.slice(0, 120);
			const safeValue = sanitizeJsonValue(nestedValue, depth + 1);
			if (safeValue !== undefined) output[safeKey] = safeValue;
		}
		return output;
	}

	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

