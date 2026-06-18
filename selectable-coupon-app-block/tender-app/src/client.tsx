type CouponSurface = "product" | "collection";

type CouponConfig = {
	couponId: string;
	discountLabel: string;
	productId: string;
	variantId: string;
	surface: CouponSurface;
	title: string;
	unappliedText: string;
	appliedText: string;
	badgeText: string;
	detailsText: string;
	trackUrl: string;
	formSelector: string;
	showSavingsEstimate: boolean;
	priceCents: number;
	discountPercentage: number;
	currencyCode: string;
	enabled: boolean;
};

type LinePropertyValue = string | number | boolean | null;
type LineProperties = Record<string, LinePropertyValue>;

type CartItem = {
	key?: string;
	id?: number | string;
	variant_id?: number | string;
	product_id?: number | string;
	quantity?: number;
	properties?: LineProperties | null;
	selling_plan_allocation?: {
		selling_plan?: {
			id?: number | string;
		} | null;
	} | null;
};

type CartResponse = {
	items?: CartItem[];
};

type CartAddLine = {
	id?: number | string;
	quantity?: number;
	properties?: LineProperties | null;
	[key: string]: unknown;
};

type CartAddPayload = CartAddLine & {
	items?: CartAddLine[];
};

type CollectionCouponProduct = {
	productId: string;
	variantId: string;
	handle: string;
	priceCents: number;
};

type CollectionCouponPayload = {
	couponId?: string;
	discountLabel?: string;
	title?: string;
	unappliedText?: string;
	appliedText?: string;
	badgeText?: string;
	detailsText?: string;
	showSavingsEstimate?: boolean;
	discountPercentage?: number | string;
	currencyCode?: string;
	trackUrl?: string;
	products?: CollectionCouponProduct[];
};

declare const Shopify:
	| {
			routes?: {
				root?: string;
			};
	  }
	| undefined;

const COUPON_PROPERTY = "_tender_coupon";
const STATE_PREFIX = "tender_coupon";
const FORM_SELECTOR =
	'form[action*="/cart/add"], form[action*="/cart/add.js"], form[data-type="add-to-cart-form"]';
const CART_ADD_PATH_PATTERN = /\/cart\/add(?:\.js)?$/;
const COLLECTION_CONFIG_SELECTOR = "script[data-tender-coupon-collection]";
const selectedCouponWidgets = new Set<TenderCouponWidget>();
let cartAddFetchPatched = false;

class TenderCouponWidget extends HTMLElement {
	private config: CouponConfig | null = null;
	private selected = false;
	private submitHandler: ((event: SubmitEvent) => void) | null = null;
	private stateHandler: ((event: Event) => void) | null = null;
	private cartSubmittedHandler: ((event: Event) => void) | null = null;
	private boundForm: HTMLFormElement | null = null;
	private cartSyncGeneration = 0;

	connectedCallback() {
		ensureCartAddFetchPatch();
		this.config = this.readConfig();
		if (!this.config.couponId || !this.config.enabled) {
			this.hidden = true;
			return;
		}

		this.selected = this.readStoredSelection();
		this.bindStateChanges();
		this.bindCartSubmitted();
		this.render();
		this.bindForm();
		this.syncFormProperty();
		this.updateSelectedRegistry();
		this.track("coupon_viewed");
	}

	disconnectedCallback() {
		if (this.boundForm && this.submitHandler) {
			this.boundForm.removeEventListener("submit", this.submitHandler, true);
		}
		if (this.stateHandler) {
			window.removeEventListener("tender-coupon-selection-changed", this.stateHandler);
			this.stateHandler = null;
		}
		if (this.cartSubmittedHandler) {
			document.removeEventListener("cart:submitted", this.cartSubmittedHandler);
			this.cartSubmittedHandler = null;
		}
		selectedCouponWidgets.delete(this);
	}

	private readConfig(): CouponConfig {
		const dataset = this.dataset;
		const surface = dataset.surface === "collection" ? "collection" : "product";
		const discountLabel = textValue(dataset.discountLabel, "20% off");

		return {
			couponId: textValue(dataset.couponId, ""),
			discountLabel,
			productId: normalizeNumericId(dataset.productId),
			variantId: normalizeNumericId(dataset.variantId),
			surface,
			title: textValue(dataset.title, "Limited time offer"),
			unappliedText: textValue(
				dataset.unappliedText,
				nativeCouponLabel(discountLabel)
			),
			appliedText: textValue(dataset.appliedText, nativeCouponLabel(discountLabel)),
			badgeText: textValue(dataset.badgeText, nativeCouponLabel(discountLabel)),
			detailsText: textValue(dataset.detailsText, ""),
			trackUrl: textValue(dataset.trackUrl, ""),
			formSelector: textValue(dataset.formSelector, ""),
			showSavingsEstimate: dataset.showSavingsEstimate === "true",
			priceCents: centsValue(dataset.priceCents),
			discountPercentage:
				percentageValue(dataset.discountPercentage) ||
				percentageValue(discountLabel),
			currencyCode: textValue(dataset.currencyCode, "USD"),
			enabled: dataset.enabled !== "false"
		};
	}

	private render() {
		const config = this.config;
		if (!config) return;

		this.classList.toggle("tender-coupon-widget--selected", this.selected);
		this.classList.toggle("tender-coupon-widget--collection", config.surface === "collection");
		this.classList.toggle(
			"tender-coupon-widget--savings-enabled",
			Boolean(buildSavingsEstimate(config))
		);
		this.innerHTML =
			config.surface === "collection"
				? this.renderCollectionBadge(config)
				: this.renderProductCoupon(config);

		const button = this.querySelector<HTMLButtonElement>("[data-tender-coupon-toggle]");
		button?.addEventListener("click", () => this.toggleSelected());
	}

	private renderProductCoupon(config: CouponConfig) {
		const label = this.selected ? config.appliedText : config.unappliedText;
		return this.renderHorizonRow(config, label, "tc-horizon-row--product");
	}

	private renderCollectionBadge(config: CouponConfig) {
		const label = this.selected ? config.appliedText : config.badgeText;
		return this.renderHorizonRow(config, label, "tc-horizon-row--collection");
	}

	private renderHorizonRow(config: CouponConfig, label: string, variantClass: string) {
		const savingsEstimate = buildSavingsEstimate(config);
		const savingsHtml = savingsEstimate && savingsEstimate !== label
			? `<span class="tc-horizon-savings" aria-hidden="${this.selected ? "false" : "true"}">${escapeHtml(savingsEstimate)}</span>`
			: "";

		return `
			<button
				class="tc-horizon-row ${variantClass}"
				type="button"
				aria-label="${escapeAttr(config.title)}"
				aria-pressed="${this.selected}"
				data-tender-coupon-toggle
			>
				<span class="tc-horizon-kicker">Coupon</span>
				<span class="tc-horizon-box" aria-hidden="true"></span>
				<span class="tc-horizon-copy">
					<span class="tc-horizon-label">${escapeHtml(label)}</span>
					${savingsHtml}
				</span>
			</button>
		`;
	}

	private toggleSelected() {
		if (!this.config) return;
		this.selected = !this.selected;
		this.writeStoredSelection();
		this.announceStateChange();
		this.render();
		this.bindForm();
		this.syncFormProperty();
		this.updateSelectedRegistry();
		this.syncCartLines();
		this.track(this.selected ? "coupon_selected" : "coupon_cleared");
	}

	private bindStateChanges() {
		if (this.stateHandler) return;
		this.stateHandler = (event) => {
			const detail = (event as CustomEvent).detail as
				| { key?: string; selected?: boolean; source?: TenderCouponWidget }
				| undefined;
			if (!detail || detail.source === this || detail.key !== this.stateKey()) return;
			this.selected = detail.selected === true;
			this.render();
			this.bindForm();
			this.syncFormProperty();
			this.updateSelectedRegistry();
			this.syncCartLines();
		};
		window.addEventListener("tender-coupon-selection-changed", this.stateHandler);
	}

	private bindCartSubmitted() {
		if (this.cartSubmittedHandler) return;
		this.cartSubmittedHandler = () => {
			if (this.selected) this.syncCartLines();
		};
		document.addEventListener("cart:submitted", this.cartSubmittedHandler);
	}

	private announceStateChange() {
		window.dispatchEvent(
			new CustomEvent("tender-coupon-selection-changed", {
				detail: {
					key: this.stateKey(),
					selected: this.selected,
					source: this
				}
			})
		);
	}

	private bindForm() {
		const form = this.findForm();
		if (!form || form === this.boundForm) return;
		if (this.boundForm && this.submitHandler) {
			this.boundForm.removeEventListener("submit", this.submitHandler, true);
		}

		this.boundForm = form;
		this.submitHandler = () => {
			this.syncFormProperty();
			if (this.selected) this.track("coupon_add_started");
		};
		form.addEventListener("submit", this.submitHandler, true);
	}

	getSelectedCartAddConfig() {
		if (!this.selected || !this.config) return null;
		return this.config;
	}

	syncSelectedCartLines() {
		if (this.selected) this.syncCartLines();
	}

	private updateSelectedRegistry() {
		const config = this.config;
		if (this.selected && config?.couponId && config.variantId) {
			selectedCouponWidgets.add(this);
			return;
		}
		selectedCouponWidgets.delete(this);
	}

	private syncFormProperty() {
		const config = this.config;
		const form = this.findForm();
		if (!config || !form) return;

		const existing = form.querySelector<HTMLInputElement>(
			`input[data-tender-coupon-property="${COUPON_PROPERTY}"]`
		);

		if (!this.selected) {
			if (existing?.value === config.couponId) existing.remove();
			return;
		}

		const input = existing ?? document.createElement("input");
		input.type = "hidden";
		input.name = `properties[${COUPON_PROPERTY}]`;
		input.value = config.couponId;
		input.dataset.tenderCouponProperty = COUPON_PROPERTY;
		input.dataset.tenderCouponId = config.couponId;
		if (!existing) form.appendChild(input);
	}

	private syncCartLines() {
		const config = this.config;
		if (!config) return;

		const shouldSelect = this.selected;
		const generation = ++this.cartSyncGeneration;
		void this.reconcileCartLines(config, shouldSelect, generation).catch(() => undefined);
	}

	private async reconcileCartLines(
		config: CouponConfig,
		shouldSelect: boolean,
		generation: number
	) {
		const cart = await fetchCart();
		if (generation !== this.cartSyncGeneration) return;

		const items = cart.items ?? [];
		for (const item of items) {
			if (generation !== this.cartSyncGeneration) return;
			if (!cartItemMatchesConfig(item, config)) continue;

			const properties = normalizeProperties(item.properties);
			const currentCouponId = propertyText(properties[COUPON_PROPERTY]);
			if (shouldSelect && currentCouponId === config.couponId) continue;
			if (!shouldSelect && !currentCouponId) continue;

			if (shouldSelect) {
				await updateCartLineProperties(item, {
					...properties,
					[COUPON_PROPERTY]: config.couponId
				});
				continue;
			}

			const nextProperties = { ...properties };
			delete nextProperties[COUPON_PROPERTY];

			if (Object.keys(nextProperties).length) {
				await updateCartLineProperties(item, nextProperties);
			} else {
				await replaceCartLineWithoutCoupon(item);
			}
		}
	}

	private findForm(): HTMLFormElement | null {
		const config = this.config;
		if (!config) return null;

		const closestForm = this.closest<HTMLFormElement>("form");
		if (closestForm) return closestForm;

		const scope = this.findProductScope();
		if (config.formSelector) {
			const scopedExplicit =
				scope?.querySelector<HTMLFormElement>(config.formSelector);
			if (scopedExplicit) return scopedExplicit;
		}

		const scopedForm = scope?.querySelector<HTMLFormElement>(FORM_SELECTOR);
		if (scopedForm) return scopedForm;

		const forms = Array.from(document.querySelectorAll<HTMLFormElement>(FORM_SELECTOR));
		const matchingVariantForm = forms.find((form) => {
			const id = normalizeNumericId(
				form.querySelector<HTMLInputElement>('[name="id"]')?.value
			);
			return id && id === config.variantId;
		});

		if (matchingVariantForm) return matchingVariantForm;

		if (config.formSelector) {
			const explicit = document.querySelector<HTMLFormElement>(config.formSelector);
			if (explicit) return explicit;
		}

		return forms[0] ?? null;
	}

	private findProductScope(): HTMLElement | null {
		const config = this.config;
		const productId = config?.productId;
		const selectors = [
			productId ? `[data-product-id="${cssEscape(productId)}"]` : "",
			"product-card",
			".product-card",
			".product-card-wrapper",
			".card-wrapper",
			"[data-product-id]",
			".product",
			".product-form-component"
		].filter(Boolean);

		return this.closest<HTMLElement>(selectors.join(", "));
	}

	private readStoredSelection() {
		try {
			return window.localStorage.getItem(this.stateKey()) === "selected";
		} catch {
			return false;
		}
	}

	private writeStoredSelection() {
		try {
			const key = this.stateKey();
			if (this.selected) {
				window.localStorage.setItem(key, "selected");
			} else {
				window.localStorage.removeItem(key);
			}
		} catch {
			// localStorage can be unavailable in strict privacy modes.
		}
	}

	private stateKey() {
		const config = this.config;
		const productScope = config?.productId || config?.variantId || "global";
		return `${STATE_PREFIX}:${config?.couponId || "unknown"}:${productScope}`;
	}

	private track(event: string) {
		const config = this.config;
		if (!config?.trackUrl) return;

		const payload = {
			event,
			couponId: config.couponId,
			productId: config.productId,
			variantId: config.variantId,
			surface: config.surface,
			selected: this.selected
		};

		void fetch(config.trackUrl, {
			method: "POST",
			body: JSON.stringify(payload),
			headers: { "content-type": "text/plain" },
			keepalive: true
		}).catch(() => undefined);
	}
}

function ensureCartAddFetchPatch() {
	if (cartAddFetchPatched || typeof window.fetch !== "function") return;
	cartAddFetchPatched = true;

	const originalFetch = window.fetch.bind(window);
	window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const isCartAdd = isCartAddRequest(input);
		const nextInit = isCartAdd ? injectCouponIntoCartAddInit(init) : init;
		const responsePromise = originalFetch(input, nextInit);

		if (isCartAdd) {
			void responsePromise
				.then((response) => {
					if (!response.ok) return;
					window.setTimeout(syncSelectedCouponCartLines, 0);
				})
				.catch(() => undefined);
		}

		return responsePromise;
	}) as typeof window.fetch;
}

function isCartAddRequest(input: RequestInfo | URL) {
	const url = requestUrl(input);
	if (!url) return false;

	try {
		const parsed = new URL(url, window.location.href);
		return parsed.origin === window.location.origin &&
			CART_ADD_PATH_PATTERN.test(parsed.pathname);
	} catch {
		return false;
	}
}

function requestUrl(input: RequestInfo | URL) {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	if (typeof Request !== "undefined" && input instanceof Request) return input.url;
	return "";
}

function injectCouponIntoCartAddInit(init: RequestInit | undefined) {
	const body = init?.body;
	if (!body) return init;

	if (typeof FormData !== "undefined" && body instanceof FormData) {
		injectCouponIntoFormData(body);
		return init;
	}

	if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
		injectCouponIntoSearchParams(body);
		return init;
	}

	if (typeof body !== "string") return init;

	const nextBody = injectCouponIntoJsonBody(body);
	if (!nextBody) return init;

	return {
		...init,
		body: nextBody
	};
}

function injectCouponIntoJsonBody(body: string) {
	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		return "";
	}

	if (!isCartAddPayload(payload)) return "";
	return injectCouponIntoCartAddPayload(payload) ? JSON.stringify(payload) : "";
}

function isCartAddPayload(value: unknown): value is CartAddPayload {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function injectCouponIntoCartAddPayload(payload: CartAddPayload) {
	if (Array.isArray(payload.items)) {
		let changed = false;
		for (const line of payload.items) {
			changed = injectCouponIntoCartAddLine(line) || changed;
		}
		return changed;
	}

	return injectCouponIntoCartAddLine(payload);
}

function injectCouponIntoCartAddLine(line: CartAddLine) {
	const variantId = normalizeNumericId(String(line.id ?? ""));
	const config = selectedCouponConfigForVariant(variantId);
	if (!config) return false;

	line.properties = {
		...normalizeProperties(line.properties),
		[COUPON_PROPERTY]: config.couponId
	};
	return true;
}

function injectCouponIntoFormData(body: FormData) {
	const config = selectedCouponConfigForVariant(
		normalizeNumericId(String(body.get("id") ?? ""))
	);
	if (!config) return;
	body.set(`properties[${COUPON_PROPERTY}]`, config.couponId);
}

function injectCouponIntoSearchParams(body: URLSearchParams) {
	const config = selectedCouponConfigForVariant(normalizeNumericId(body.get("id") ?? ""));
	if (!config) return;
	body.set(`properties[${COUPON_PROPERTY}]`, config.couponId);
}

function selectedCouponConfigForVariant(variantId: string) {
	if (!variantId) return null;

	for (const widget of selectedCouponWidgets) {
		const config = widget.getSelectedCartAddConfig();
		if (config?.variantId === variantId) return config;
	}

	return null;
}

function syncSelectedCouponCartLines() {
	for (const widget of selectedCouponWidgets) {
		widget.syncSelectedCartLines();
	}
}

function textValue(value: string | undefined, fallback: string) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : fallback;
}

function nativeCouponLabel(discountLabel: string) {
	const compactLabel = discountLabel.replace(/\s+off$/i, "");
	return `Apply ${compactLabel} coupon`;
}

function nativeRedeemedLabel(percentage: number) {
	const label = percentage > 0 ? formatPercentage(percentage) : "20%";
	return `Redeemed. Save ${label} applied at checkout`;
}

function normalizeNumericId(value: string | undefined) {
	const raw = value?.trim() || "";
	const match = raw.match(/(\d+)$/);
	return match?.[1] || raw;
}

function centsValue(value: string | undefined) {
	const cents = Number.parseInt(value || "", 10);
	return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

function percentageValue(value: string | undefined) {
	const match = String(value || "").match(/(\d+(?:\.\d+)?)/);
	if (!match) return 0;
	const percentage = Number.parseFloat(match[1] || "");
	if (!Number.isFinite(percentage) || percentage <= 0) return 0;
	return Math.min(percentage, 100);
}

function buildSavingsEstimate(config: CouponConfig) {
	if (
		config.surface !== "product" ||
		!config.showSavingsEstimate ||
		config.priceCents <= 0 ||
		config.discountPercentage <= 0
	) {
		return "";
	}

	return `Redeemed. Save ${formatPercentage(config.discountPercentage)} applied at checkout`;
}

function formatPercentage(percentage: number) {
	if (Number.isInteger(percentage)) return `${percentage}%`;
	return `${percentage.toFixed(1).replace(/\.0$/, "")}%`;
}

function cssEscape(value: string) {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}
	return value.replace(/["\\]/g, "\\$&");
}

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#039;";
		}
	});
}

function escapeAttr(value: string) {
	return escapeHtml(value);
}

function cartItemMatchesConfig(item: CartItem, config: CouponConfig) {
	const variantId = normalizeNumericId(String(item.variant_id ?? item.id ?? ""));
	const productId = normalizeNumericId(String(item.product_id ?? ""));
	if (config.variantId && variantId === config.variantId) return true;
	return Boolean(config.productId && productId === config.productId);
}

function normalizeProperties(properties: CartItem["properties"]): LineProperties {
	if (!properties || typeof properties !== "object") return {};
	return { ...properties };
}

function propertyText(value: LinePropertyValue | undefined) {
	return typeof value === "string" ? value.trim() : "";
}

async function fetchCart(): Promise<CartResponse> {
	const response = await fetch(cartEndpoint("cart.js"), {
		headers: { accept: "application/json" }
	});
	if (!response.ok) throw new Error("Unable to read cart");
	return (await response.json()) as CartResponse;
}

async function updateCartLineProperties(item: CartItem, properties: LineProperties) {
	const lineId = lineItemIdentifier(item);
	if (!lineId) return;

	await postCart("cart/change.js", {
		id: lineId,
		quantity: positiveQuantity(item.quantity),
		properties
	});
}

async function replaceCartLineWithoutCoupon(item: CartItem) {
	const lineId = lineItemIdentifier(item);
	const variantId = item.variant_id ?? item.id;
	if (!lineId || !variantId) return;

	await postCart("cart/change.js", {
		id: lineId,
		quantity: 0
	});

	const addItem: {
		id: number | string;
		quantity: number;
		selling_plan?: number | string;
	} = {
		id: variantId,
		quantity: positiveQuantity(item.quantity)
	};

	const sellingPlanId = item.selling_plan_allocation?.selling_plan?.id;
	if (sellingPlanId) addItem.selling_plan = sellingPlanId;

	await postCart("cart/add.js", {
		items: [addItem]
	});
}

function lineItemIdentifier(item: CartItem) {
	return item.key || item.id || item.variant_id || "";
}

function positiveQuantity(quantity: number | undefined) {
	return typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0
		? quantity
		: 1;
}

async function postCart(path: string, body: unknown) {
	const response = await fetch(cartEndpoint(path), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify(body)
	});
	if (!response.ok) throw new Error(`Unable to update cart: ${path}`);
	return response.json() as Promise<unknown>;
}

function cartEndpoint(path: string) {
	const root = typeof Shopify === "undefined" ? "/" : Shopify.routes?.root || "/";
	return `${root.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;
}

function hydrateCollectionCoupons() {
	const payloadScripts = Array.from(
		document.querySelectorAll<HTMLScriptElement>(COLLECTION_CONFIG_SELECTOR)
	);

	for (const script of payloadScripts) {
		const payloadId = script.dataset.tenderCouponCollection || "default";
		const payload = parseCollectionCouponPayload(script.textContent || "");
		if (!payload?.couponId || !Array.isArray(payload.products)) continue;

		for (const product of payload.products) {
			injectCollectionCoupon(payloadId, payload, product);
		}
	}
}

function parseCollectionCouponPayload(text: string) {
	try {
		const payload = JSON.parse(text) as unknown;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
		return payload as CollectionCouponPayload;
	} catch {
		return null;
	}
}

function injectCollectionCoupon(
	payloadId: string,
	payload: CollectionCouponPayload,
	product: CollectionCouponProduct
) {
	const card = findCollectionCard(product.handle);
	if (!card) return;

	const couponId = textValue(payload.couponId, "");
	const variantId = normalizeNumericId(product.variantId);
	if (!couponId || !variantId) return;

	const existing = card.querySelector(
		`tender-coupon-widget[data-coupon-id="${cssEscape(couponId)}"][data-variant-id="${cssEscape(variantId)}"]`
	);
	if (existing) return;

	const target = findCollectionWidgetTarget(card);
	const widget = document.createElement("tender-coupon-widget");
	widget.dataset.tenderCollectionInjected = payloadId;
	widget.dataset.surface = "collection";
	widget.dataset.enabled = "true";
	widget.dataset.couponId = couponId;
	widget.dataset.discountLabel = textValue(payload.discountLabel, "20% off");
	widget.dataset.title = textValue(payload.title, widget.dataset.discountLabel);
	widget.dataset.unappliedText = textValue(
		payload.unappliedText,
		nativeCouponLabel(widget.dataset.discountLabel)
	);
	widget.dataset.appliedText = textValue(
		payload.appliedText,
		nativeRedeemedLabel(percentageValue(String(payload.discountPercentage || "")))
	);
	widget.dataset.badgeText = textValue(payload.badgeText, widget.dataset.unappliedText);
	widget.dataset.detailsText = textValue(payload.detailsText, "");
	widget.dataset.productId = normalizeNumericId(product.productId);
	widget.dataset.variantId = variantId;
	widget.dataset.showSavingsEstimate = "false";
	widget.dataset.priceCents = String(product.priceCents || 0);
	widget.dataset.discountPercentage = String(payload.discountPercentage || "");
	widget.dataset.currencyCode = textValue(payload.currencyCode, "USD");
	widget.dataset.trackUrl = textValue(payload.trackUrl, "");

	target.appendChild(widget);
}

function findCollectionWidgetTarget(card: HTMLElement) {
	return card.querySelector<HTMLElement>(
		[
			"[data-product-card-details]",
			".product-card__info",
			".product-card__content",
			".card-information",
			".card__content",
			".flex.flex-col.items-start.w-full.gap-2"
		].join(", ")
	) || card;
}

function findCollectionCard(handle: string) {
	const normalizedHandle = handle.trim();
	if (!normalizedHandle) return null;

	const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
	for (const link of links) {
		const href = link.getAttribute("href") || "";
		if (!href.includes(`/products/${normalizedHandle}`)) continue;
		const card = link.closest<HTMLElement>(
			[
				".product-card-wrapper",
				"product-card",
				".product-card",
				".card-wrapper",
				"[data-product-card]",
				"article",
				"li"
			].join(", ")
		);
		if (card) return card;
	}

	return null;
}

if (!customElements.get("tender-coupon-widget")) {
	customElements.define("tender-coupon-widget", TenderCouponWidget);
}

hydrateCollectionCoupons();
document.addEventListener("DOMContentLoaded", hydrateCollectionCoupons, { once: true });
document.addEventListener("htmx:afterSwap", hydrateCollectionCoupons);
document.addEventListener("shopify:section:load", hydrateCollectionCoupons);

const appRoot = document.querySelector<HTMLElement>("#app");
if (appRoot && !document.querySelector("tender-coupon-widget")) {
	appRoot.innerHTML = `
		<main class="demo-shell">
			<tender-coupon-widget
				data-coupon-id="demo-20-off"
				data-discount-label="20% off"
				data-product-id="11111111111111"
				data-variant-id="22222222222222"
				data-title="Summer sale"
				data-unapplied-text="Apply 20% coupon"
				data-applied-text="Redeemed. Save 20% applied at checkout"
				data-badge-text="Apply 20% coupon"
				data-details-text="Demo product coupon."
				data-surface="product"
				data-show-savings-estimate="true"
				data-price-cents="1899"
				data-discount-percentage="20"
				data-currency-code="USD"
				data-track-url="./api/track"
			></tender-coupon-widget>
			<tender-coupon-widget
				data-coupon-id="demo-20-off"
				data-discount-label="20% off"
				data-product-id="11111111111111"
				data-variant-id="22222222222222"
				data-badge-text="Apply 20% coupon"
				data-surface="collection"
				data-track-url="./api/track"
			></tender-coupon-widget>
		</main>
	`;
}
