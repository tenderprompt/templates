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

class TenderCouponWidget extends HTMLElement {
	private config: CouponConfig | null = null;
	private selected = false;
	private submitHandler: ((event: SubmitEvent) => void) | null = null;
	private stateHandler: ((event: Event) => void) | null = null;
	private boundForm: HTMLFormElement | null = null;
	private cartSyncGeneration = 0;

	connectedCallback() {
		this.config = this.readConfig();
		if (!this.config.couponId || !this.config.enabled) {
			this.hidden = true;
			return;
		}

		this.selected = this.readStoredSelection();
		this.bindStateChanges();
		this.render();
		this.bindForm();
		this.syncFormProperty();
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
			this.syncCartLines();
		};
		window.addEventListener("tender-coupon-selection-changed", this.stateHandler);
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

function textValue(value: string | undefined, fallback: string) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : fallback;
}

function nativeCouponLabel(discountLabel: string) {
	const compactLabel = discountLabel.replace(/\s+off$/i, "");
	return `Apply ${compactLabel} coupon`;
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

if (!customElements.get("tender-coupon-widget")) {
	customElements.define("tender-coupon-widget", TenderCouponWidget);
}

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
				data-applied-text="Apply 20% coupon"
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
