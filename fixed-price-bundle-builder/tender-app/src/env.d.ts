type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type AnalyticsTrackResult =
	| { ok: true }
	| { ok: false; reasonCode: string; message?: string };

type AnalyticsBinding = {
	invoke(input: {
		method: "track";
		payload: {
			event: string;
			unit?: { type: string; id: string };
			flow?: {
				id: string;
				step: string;
				order: number;
				role: "start" | "milestone" | "activity" | "outcome" | "error";
			};
			properties?: JsonObject;
		};
	}): Promise<AnalyticsTrackResult>;
};

export type AppEnv = {
	__TP_ANALYTICS: AnalyticsBinding;
};

