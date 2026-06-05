import { DurableObject } from "cloudflare:workers";

import type { AppEnv } from "./env";

type TrackRequest = {
	event?: string;
	couponId?: string;
	productId?: string;
	variantId?: string;
	surface?: string;
	selected?: boolean;
};

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type"
};

const EVENT_NAMES = new Set([
	"coupon_viewed",
	"coupon_selected",
	"coupon_cleared",
	"coupon_add_started"
]);

export class App extends DurableObject<AppEnv> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		if (url.pathname.endsWith("/api/track") && request.method === "POST") {
			return this.handleTrack(request);
		}

		return json({ ok: false, reasonCode: "not_found" }, 404);
	}

	private async handleTrack(request: Request): Promise<Response> {
		const input = await readTrackRequest(request);
		if (!input || !EVENT_NAMES.has(input.event || "")) {
			return json({ ok: false, reasonCode: "invalid_event" }, 400);
		}

		const event = input.event || "";
		const couponId = boundedText(input.couponId, 80);
		const productId = boundedText(input.productId, 80);
		const variantId = boundedText(input.variantId, 80);
		const surface = input.surface === "collection" ? "collection" : "product";

		return json({
			ok: true,
			event,
			couponId,
			productId,
			variantId,
			surface
		}, 200);
	}
}

async function readTrackRequest(request: Request) {
	const raw = await request.text();
	if (raw.length > 4096) return null;

	try {
		return JSON.parse(raw) as TrackRequest;
	} catch {
		return null;
	}
}

function boundedText(value: string | undefined, maxLength: number) {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, maxLength);
}

function json(body: unknown, status: number) {
	return Response.json(body, {
		status,
		headers: CORS_HEADERS
	});
}
