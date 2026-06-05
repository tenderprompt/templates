import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

type BundleBuilderProps = {
	mode: "page" | "shopify_app_block";
	config?: BundleRuntimeConfig;
	productHandle?: string;
	productId?: string;
	shopDomain?: string;
};

type BundleRuntimeConfig = {
	version: 1;
	handle: string;
	title: string;
	currencyCode: string;
	analytics?: {
		experimentId?: string;
		variant?: string;
	};
	variantGroups: VariantGroup[];
	tiers: BundleTier[];
};

type VariantGroup = {
	group: string;
	allowDuplicateComponents?: boolean;
	allowedVariantIds?: Array<string | number>;
	components: ComponentProduct[];
};

type BundleTier = {
	bundleId: string;
	label: string;
	fixedPriceCents: number;
	requiredQuantity: number;
	parentProductHandle?: string;
	parentProductId?: string | number;
	parentVariantId?: string | number;
	parentVariantGid?: string;
	variantGroup: string;
	allowedVariantIds?: Array<string | number>;
};

type ComponentProduct = {
	variantId: string | number;
	handle: string;
	title: string;
	imageUrl?: string;
	available?: boolean;
	priceCents?: number;
};

type Selection = Record<string, number>;

type BundleAnalyticsEventName =
	| "tender_bundle_viewed"
	| "tender_bundle_detail_opened"
	| "tender_bundle_quantity_changed"
	| "tender_bundle_filled"
	| "tender_bundle_cart_clicked"
	| "tender_bundle_cart_success"
	| "tender_bundle_cart_failure";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

declare global {
	interface Window {
		Shopify?: {
			analytics?: {
				publish?: (eventName: string, payload: JsonObject) => unknown;
			};
		};
	}
}

const ANALYTICS_FLOW_ID = "bundle_builder";
const ANALYTICS_UNIT_TYPE = "bundle_build";

const DEMO_CONFIG: BundleRuntimeConfig = {
	version: 1,
	handle: "starter-fixed-price-bundles",
	title: "Starter Fixed Price Bundles",
	currencyCode: "USD",
	analytics: {
		experimentId: "starter_bundle_builder_v1",
		variant: "default",
	},
	variantGroups: [
		{
			group: "starter-products",
			allowDuplicateComponents: true,
			components: [
				{
					variantId: "11111111111111",
					handle: "sample-product-a",
					title: "Sample Product A",
					available: true,
				},
				{
					variantId: "22222222222222",
					handle: "sample-product-b",
					title: "Sample Product B",
					available: true,
				},
				{
					variantId: "33333333333333",
					handle: "sample-product-c",
					title: "Sample Product C",
					available: true,
				},
				{
					variantId: "44444444444444",
					handle: "sample-product-d",
					title: "Sample Product D",
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
			parentVariantId: "99999999999999",
			variantGroup: "starter-products",
		},
	],
};

function BundleBuilderApp(props: BundleBuilderProps) {
	const config = props.config ?? DEMO_CONFIG;
	const tier = useMemo(
		() => getActiveTier(config, props.productHandle, props.productId),
		[config, props.productHandle, props.productId]
	);
	const variantGroup = useMemo(
		() => getVariantGroup(config, tier),
		[config, tier]
	);
	const products = useMemo(
		() => getComponentsForTier(config, tier),
		[config, tier]
	);
	const [selection, setSelection] = useState<Selection>({});
	const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">(
		"idle"
	);
	const [message, setMessage] = useState("");
	const bundleSessionIdRef = useRef(createBundleSessionId(config.handle));
	const viewedAtRef = useRef(nowMs());
	const viewedTrackedRef = useRef(false);
	const filledTrackedRef = useRef(false);
	const cartRequestStartedAtRef = useRef<number | null>(null);
	const cartAddInFlightRef = useRef(false);

	const selectedTotal = getSelectedTotal(selection);
	const selectedItems = getSelectedItems(selection, products);
	const remaining = Math.max(0, tier.requiredQuantity - selectedTotal);
	const canAddToCart = selectedTotal === tier.requiredQuantity && status !== "adding";
	const price = formatCurrency(tier.fixedPriceCents, config.currencyCode);
	const allowDuplicates = variantGroup?.allowDuplicateComponents !== false;

	useEffect(() => {
		if (viewedTrackedRef.current) return;
		viewedTrackedRef.current = true;
		trackBundleEvent("tender_bundle_viewed", {
			time_to_view_ms: 0,
		});
	}, []);

	useEffect(() => {
		if (selectedTotal !== tier.requiredQuantity || filledTrackedRef.current) return;
		filledTrackedRef.current = true;
		trackBundleEvent("tender_bundle_filled", {
			bundle_filled: true,
			time_to_bundle_filled_ms: getElapsedMs(),
		});
	}, [selectedTotal, tier.requiredQuantity]);

	function getElapsedMs() {
		return Math.max(0, Math.round(nowMs() - viewedAtRef.current));
	}

	function getCommonAnalyticsProperties(selectionForEvent: Selection): JsonObject {
		const totalUnits = getSelectedTotal(selectionForEvent);
		const items = getSelectedItems(selectionForEvent, products);
		const quantities: JsonObject = {};
		for (const item of items) {
			quantities[normalizeNumericId(item.product.variantId)] = item.quantity;
		}

		return {
			bundle_id: tier.bundleId,
			bundle_price_cents: tier.fixedPriceCents,
			currency: config.currencyCode,
			experiment_id: config.analytics?.experimentId ?? "",
			experiment_variant: config.analytics?.variant ?? "",
			pack_size: tier.requiredQuantity,
			product_handle: props.productHandle ?? tier.parentProductHandle ?? "",
			remaining_units: Math.max(0, tier.requiredQuantity - totalUnits),
			required_units: tier.requiredQuantity,
			selected_component_handles: items.map((item) => item.product.handle),
			selected_component_quantities: quantities,
			selected_product_count: items.length,
			shop_domain: props.shopDomain ?? "",
			surface: props.mode,
			total_units: totalUnits,
		};
	}

	function trackBundleEvent(
		eventName: BundleAnalyticsEventName,
		properties: JsonObject = {},
		selectionForEvent: Selection = selection
	) {
		const flow = getFlowMetadata(eventName);
		const payload: JsonObject = {
			event: eventName,
			unit: {
				type: ANALYTICS_UNIT_TYPE,
				id: bundleSessionIdRef.current,
			},
			flow: {
				id: ANALYTICS_FLOW_ID,
				...flow,
			},
			properties: {
				...getCommonAnalyticsProperties(selectionForEvent),
				...properties,
				seconds_since_view: Math.round(getElapsedMs() / 1000),
			},
		};

		publishShopifyCustomerEvent(eventName, payload);
		window.dispatchEvent(
			new CustomEvent("tender:bundle-analytics", {
				detail: payload,
			})
		);
	}

	function setQuantity(product: ComponentProduct, requestedQuantity: number) {
		if (product.available === false) return;

		const variantId = normalizeNumericId(product.variantId);
		const currentQuantity = selection[variantId] ?? 0;
		const currentTotalWithoutProduct = selectedTotal - currentQuantity;
		const maxForProduct = allowDuplicates ? tier.requiredQuantity : 1;
		const maxAllowed = Math.max(
			0,
			Math.min(maxForProduct, tier.requiredQuantity - currentTotalWithoutProduct)
		);
		const nextQuantity = Math.max(0, Math.min(requestedQuantity, maxAllowed));
		const nextSelection = { ...selection };

		if (nextQuantity === 0) {
			delete nextSelection[variantId];
		} else {
			nextSelection[variantId] = nextQuantity;
		}

		setSelection(nextSelection);
		setStatus("idle");
		setMessage("");
		trackBundleEvent(
			"tender_bundle_quantity_changed",
			{
				component_available: true,
				component_handle: product.handle,
				quantity_after: nextQuantity,
				quantity_before: currentQuantity,
				quantity_change: nextQuantity - currentQuantity,
				variant_id: variantId,
			},
			nextSelection
		);
	}

	async function addBundleToCart() {
		if (!canAddToCart || cartAddInFlightRef.current) return;

		const parentVariantId = normalizeNumericId(
			tier.parentVariantId ?? tier.parentVariantGid
		);
		if (!parentVariantId) {
			setStatus("error");
			setMessage("Bundle parent variant is not configured.");
			return;
		}

		const selectionForCart = selection;
		const bundleInstanceId = createBundleInstanceId(tier.bundleId);
		cartAddInFlightRef.current = true;
		cartRequestStartedAtRef.current = nowMs();
		setStatus("adding");
		setMessage("");
		trackBundleEvent(
			"tender_bundle_cart_clicked",
			{
				cart_handoff_mode: "ajax_cart",
				time_to_cart_intent_ms: getElapsedMs(),
			},
			selectionForCart
		);

		try {
			const response = await fetch("/cart/add.js", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					items: [
						{
							id: parentVariantId,
							quantity: 1,
							properties: {
								_bundle_id: tier.bundleId,
								_bundle_components: JSON.stringify(selectionForCart),
								_bundle_instance_id: bundleInstanceId,
							},
						},
					],
				}),
			});

			if (!response.ok) {
				const errorPayload = (await response.json().catch(() => null)) as
					| { description?: string; message?: string }
					| null;
				throw new Error(
					errorPayload?.description ??
						errorPayload?.message ??
						"Shopify cart add failed."
				);
			}

			const cartPayload = (await response.json().catch(() => null)) as
				| { items?: unknown[] }
				| null;
			const cartResponseMs = cartRequestStartedAtRef.current
				? Math.max(0, Math.round(nowMs() - cartRequestStartedAtRef.current))
				: 0;

			setSelection({});
			setStatus("added");
			setMessage("Bundle added to cart.");
			filledTrackedRef.current = false;
			trackBundleEvent(
				"tender_bundle_cart_success",
				{
					cart_line_count: Array.isArray(cartPayload?.items)
						? cartPayload.items.length
						: 0,
					cart_response_ms: cartResponseMs,
					time_to_cart_success_ms: getElapsedMs(),
				},
				selectionForCart
			);
		} catch (error) {
			const cartResponseMs = cartRequestStartedAtRef.current
				? Math.max(0, Math.round(nowMs() - cartRequestStartedAtRef.current))
				: 0;
			const errorMessage =
				error instanceof Error && error.message
					? error.message
					: "Bundle could not be added to cart.";

			setStatus("error");
			setMessage(errorMessage);
			trackBundleEvent(
				"tender_bundle_cart_failure",
				{
					cart_error_code: getSafeCartErrorCode(errorMessage),
					cart_response_ms: cartResponseMs,
					time_to_cart_failure_ms: getElapsedMs(),
				},
				selectionForCart
			);
		} finally {
			cartAddInFlightRef.current = false;
			cartRequestStartedAtRef.current = null;
		}
	}

	return (
		<section class="fp-bundle" data-bundle-handle={config.handle}>
			<header class="fp-bundle__header">
				<p class="fp-bundle__eyebrow">Build your bundle</p>
				<h2>{tier.label}</h2>
				<p class="fp-bundle__price">{price}</p>
				<p class="fp-bundle__progress">
					{selectedTotal} of {tier.requiredQuantity} selected
				</p>
			</header>

			<div class="fp-bundle__layout">
				<div class="fp-bundle__grid">
					{products.map((product) => {
						const variantId = normalizeNumericId(product.variantId);
						const quantity = selection[variantId] ?? 0;
						const soldOut = product.available === false;
						const atLimit = remaining === 0 && quantity === 0;

						return (
							<article class="fp-bundle__card" key={variantId}>
								<div class="fp-bundle__media">
									{product.imageUrl ? (
										<img src={product.imageUrl} alt="" loading="lazy" />
									) : (
										<span class="fp-bundle__placeholder" aria-hidden="true">
											{product.title.trim().charAt(0).toUpperCase() || "B"}
										</span>
									)}
								</div>
								<h3 class="fp-bundle__card-title">{product.title}</h3>
								{soldOut ? (
									<p class="fp-bundle__sold-out">Sold out</p>
								) : (
									<div class="fp-bundle__quantity-row">
										<button
											class="fp-bundle__icon-button"
											type="button"
											aria-label={`Remove ${product.title}`}
											disabled={quantity === 0}
											onClick={() => setQuantity(product, quantity - 1)}
										>
											-
										</button>
										<span class="fp-bundle__quantity">{quantity}</span>
										<button
											class="fp-bundle__icon-button"
											type="button"
											aria-label={`Add ${product.title}`}
											disabled={atLimit || (!allowDuplicates && quantity >= 1)}
											onClick={() => setQuantity(product, quantity + 1)}
										>
											+
										</button>
									</div>
								)}
							</article>
						);
					})}
				</div>

				<aside class="fp-bundle__summary" aria-label="Bundle summary">
					<h3>Your bundle</h3>
					<ul class="fp-bundle__summary-list">
						{selectedItems.length ? (
							selectedItems.map((item) => (
								<li
									class="fp-bundle__summary-item"
									key={normalizeNumericId(item.product.variantId)}
								>
									<span>{item.product.title}</span>
									<strong>{item.quantity}</strong>
								</li>
							))
						) : (
							<li class="fp-bundle__summary-item">
								<span>Choose {tier.requiredQuantity} items</span>
								<strong>0</strong>
							</li>
						)}
					</ul>
					<button
						class="fp-bundle__primary-button"
						type="button"
						disabled={!canAddToCart}
						onClick={addBundleToCart}
					>
						{status === "adding"
							? "Adding..."
							: `Add bundle (${selectedTotal} / ${tier.requiredQuantity})`}
					</button>
					<p
						class={`fp-bundle__status${status === "error" ? " is-error" : ""}`}
						aria-live="polite"
					>
						{message ||
							(remaining > 0
								? `${remaining} more item${remaining === 1 ? "" : "s"} needed.`
								: "Ready to add.")}
					</p>
				</aside>
			</div>
		</section>
	);
}

function getActiveTier(
	config: BundleRuntimeConfig,
	productHandle?: string,
	productId?: string
) {
	const normalizedProductId = normalizeNumericId(productId);
	const matchingTier = config.tiers.find((tier) => {
		if (productHandle && tier.parentProductHandle === productHandle) return true;
		if (
			normalizedProductId &&
			normalizeNumericId(tier.parentProductId) === normalizedProductId
		) {
			return true;
		}
		return false;
	});

	return matchingTier ?? config.tiers[0] ?? DEMO_CONFIG.tiers[0];
}

function getVariantGroup(config: BundleRuntimeConfig, tier: BundleTier) {
	return config.variantGroups.find((group) => group.group === tier.variantGroup);
}

function getComponentsForTier(config: BundleRuntimeConfig, tier: BundleTier) {
	const group = getVariantGroup(config, tier);
	if (!group) return [];

	const allowedIds = new Set(
		(tier.allowedVariantIds ?? group.allowedVariantIds ?? group.components.map(
			(product) => product.variantId
		)).map(normalizeNumericId)
	);

	return group.components.filter((product) =>
		allowedIds.has(normalizeNumericId(product.variantId))
	);
}

function getSelectedTotal(selection: Selection) {
	return Object.values(selection).reduce((total, quantity) => total + quantity, 0);
}

function getSelectedItems(selection: Selection, products: ComponentProduct[]) {
	return products
		.map((product) => ({
			product,
			quantity: selection[normalizeNumericId(product.variantId)] ?? 0,
		}))
		.filter((item) => item.quantity > 0);
}

function normalizeNumericId(value: unknown) {
	if (typeof value === "number" && Number.isSafeInteger(value)) {
		return String(value);
	}
	if (typeof value !== "string") return "";

	const trimmed = value.trim();
	const match = trimmed.match(/(\d+)$/);
	return match ? match[1] : trimmed;
}

function createBundleSessionId(handle: string) {
	return `bundle-${safeIdPart(handle)}-${randomIdPart()}`;
}

function createBundleInstanceId(bundleId: string) {
	return `bundle-${safeIdPart(bundleId)}-${Date.now().toString(36)}-${randomIdPart()}`;
}

function safeIdPart(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function randomIdPart() {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID().slice(0, 8);
	}
	const bytes = new Uint32Array(1);
	globalThis.crypto?.getRandomValues?.(bytes);
	return (bytes[0] || Math.floor(Math.random() * 0xffffffff)).toString(36);
}

function nowMs() {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function formatCurrency(cents: number, currencyCode: string) {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: currencyCode || "USD",
		}).format(cents / 100);
	} catch {
		return `$${(cents / 100).toFixed(2)}`;
	}
}

function getFlowMetadata(eventName: BundleAnalyticsEventName) {
	switch (eventName) {
		case "tender_bundle_viewed":
			return { step: "viewed", order: 1, role: "start" as const };
		case "tender_bundle_detail_opened":
			return { step: "detail_opened", order: 2, role: "activity" as const };
		case "tender_bundle_quantity_changed":
			return { step: "quantity_changed", order: 2, role: "activity" as const };
		case "tender_bundle_filled":
			return { step: "bundle_filled", order: 3, role: "milestone" as const };
		case "tender_bundle_cart_clicked":
			return { step: "cart_clicked", order: 4, role: "milestone" as const };
		case "tender_bundle_cart_success":
			return { step: "cart_success", order: 5, role: "outcome" as const };
		case "tender_bundle_cart_failure":
			return { step: "cart_failure", order: 5, role: "error" as const };
	}
}

function publishShopifyCustomerEvent(eventName: string, payload: JsonObject) {
	try {
		const analytics = window.Shopify?.analytics;
		const publish = analytics?.publish;
		if (typeof publish !== "function") return false;
		publish.call(analytics, eventName, payload);
		return true;
	} catch (error) {
		console.warn("Bundle analytics publish failed", error);
		return false;
	}
}

function getSafeCartErrorCode(message: string) {
	return message
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 80);
}

function parseConfigFromElement(element: HTMLElement) {
	const script = element.querySelector<HTMLScriptElement>(
		"script[data-fixed-price-bundle-config]"
	);
	const jsonText = script?.textContent?.trim();
	if (!jsonText || jsonText === "null") return null;

	try {
		const parsed = JSON.parse(jsonText) as unknown;
		return isBundleRuntimeConfig(parsed) ? parsed : null;
	} catch (error) {
		console.warn("Bundle config failed to parse", error);
		return null;
	}
}

function isBundleRuntimeConfig(value: unknown): value is BundleRuntimeConfig {
	if (!isRecord(value)) return false;
	if (value.version !== 1) return false;
	if (typeof value.handle !== "string" || typeof value.title !== "string") {
		return false;
	}
	if (!Array.isArray(value.variantGroups) || !Array.isArray(value.tiers)) {
		return false;
	}
	return value.variantGroups.length > 0 && value.tiers.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

class FixedPriceBundleBuilderElement extends HTMLElement {
	private mounted = false;

	connectedCallback() {
		if (this.mounted) return;
		this.mounted = true;

		const shadow = this.attachShadow({ mode: "open" });
		const stylesheetUrl = this.dataset.stylesheetUrl;
		if (stylesheetUrl) {
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = stylesheetUrl;
			shadow.appendChild(link);
		}

		const root = document.createElement("div");
		shadow.appendChild(root);
		render(
			<BundleBuilderApp
				mode={
					this.dataset.mode === "shopify_app_block"
						? "shopify_app_block"
						: "page"
				}
				config={parseConfigFromElement(this) ?? DEMO_CONFIG}
				productHandle={this.dataset.productHandle}
				productId={this.dataset.productId}
				shopDomain={this.dataset.shopDomain}
			/>,
			root
		);
	}
}

if (!customElements.get("fixed-price-bundle-builder")) {
	customElements.define(
		"fixed-price-bundle-builder",
		FixedPriceBundleBuilderElement
	);
}

const root = document.querySelector("#app");
if (root) {
	render(<BundleBuilderApp mode="page" config={DEMO_CONFIG} />, root);
}
