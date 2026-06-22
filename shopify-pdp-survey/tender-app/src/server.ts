import { DurableObject } from "cloudflare:workers";

import type { AppEnv } from "./env";

export class App extends DurableObject<AppEnv> {
	async fetch(): Promise<Response> {
		return Response.json({ ok: false, reasonCode: "not_found" }, { status: 404 });
	}
}
