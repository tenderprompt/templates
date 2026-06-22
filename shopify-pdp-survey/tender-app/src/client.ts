type LineProperties = Record<string, string>;

type CartAddLine = {
	properties?: LineProperties | null;
	[key: string]: unknown;
};

type CartAddPayload = CartAddLine & {
	items?: CartAddLine[];
};

const DEFAULT_FORM_SELECTOR =
	'form[action*="/cart/add"], form[action*="/cart/add.js"], form[data-type="add-to-cart-form"]';
const CART_ADD_PATH_PATTERN = /\/cart\/add(?:\.js)?$/;
const selectedSurveys = new Set<TenderProductSurvey>();
let cartAddFetchPatched = false;

class TenderProductSurvey extends HTMLElement {
	private selectedAnswer = "";
	private question = "";
	private answers: string[] = [];
	private answerPropertyKey = "_tender_product_survey";
	private questionPropertyKey = "_tender_product_survey_question";
	private statusText = "Answer saved with your cart.";
	private formSelector = "";

	connectedCallback() {
		ensureCartAddFetchPatch();
		this.readConfig();
		if (!this.question || this.answers.length === 0) {
			this.hidden = true;
			return;
		}

		this.selectedAnswer = this.readStoredAnswer();
		selectedSurveys.add(this);
		this.render();
		this.syncLineProperties();
	}

	disconnectedCallback() {
		selectedSurveys.delete(this);
	}

	getLineProperties(): LineProperties {
		if (!this.selectedAnswer) return {};
		return {
			[this.answerPropertyKey]: this.selectedAnswer,
			[this.questionPropertyKey]: this.question
		};
	}

	private readConfig() {
		this.question = textValue(
			this.dataset.question,
			"How did you hear about this product?"
		);
		this.answers = textValue(this.dataset.answers, "Instagram|Friend|Search|Other")
			.split("|")
			.map((answer) => answer.trim())
			.filter(Boolean)
			.slice(0, 8);
		this.answerPropertyKey = privatePropertyKey(
			this.dataset.answerPropertyKey,
			"_tender_product_survey"
		);
		this.questionPropertyKey = privatePropertyKey(
			this.dataset.questionPropertyKey,
			"_tender_product_survey_question"
		);
		this.statusText = textValue(
			this.dataset.statusText,
			"Answer saved with your cart."
		);
		this.formSelector = textValue(this.dataset.formSelector, "");
	}

	private render() {
		const status = this.selectedAnswer ? this.statusText : "";
		this.innerHTML = `
			<section class="tp-survey" aria-label="${escapeAttr(this.question)}">
				<h2 class="tp-survey__question">${escapeHtml(this.question)}</h2>
				<div class="tp-survey__options">
					${this.answers
						.map((answer) => this.renderAnswerButton(answer))
						.join("")}
				</div>
				<p class="tp-survey__status" aria-live="polite">${escapeHtml(status)}</p>
			</section>
		`;

		this.querySelectorAll<HTMLButtonElement>("[data-survey-answer]").forEach(
			(button) => {
				button.addEventListener("click", () => {
					const answer = button.dataset.surveyAnswer || "";
					this.selectAnswer(answer);
				});
			}
		);
	}

	private renderAnswerButton(answer: string) {
		return `
			<button
				class="tp-survey__option"
				type="button"
				aria-pressed="${this.selectedAnswer === answer}"
				data-survey-answer="${escapeAttr(answer)}"
			>${escapeHtml(answer)}</button>
		`;
	}

	private selectAnswer(answer: string) {
		if (!this.answers.includes(answer)) return;
		this.selectedAnswer = answer;
		this.writeStoredAnswer(answer);
		this.render();
		this.syncLineProperties();
	}

	private syncLineProperties() {
		const properties = this.getLineProperties();
		const forms = this.findProductForms();
		forms.forEach((form) => {
			syncHiddenInput(form, `properties[${this.answerPropertyKey}]`, properties[this.answerPropertyKey] || "");
			syncHiddenInput(form, `properties[${this.questionPropertyKey}]`, properties[this.questionPropertyKey] || "");
		});
	}

	private findProductForms() {
		const selectors = [
			this.formSelector,
			this.closest("form") ? "" : DEFAULT_FORM_SELECTOR
		].filter(Boolean);
		const forms = new Set<HTMLFormElement>();
		const closestForm = this.closest("form");
		if (closestForm instanceof HTMLFormElement) {
			forms.add(closestForm);
		}
		selectors.forEach((selector) => {
			document.querySelectorAll<HTMLFormElement>(selector).forEach((form) => {
				forms.add(form);
			});
		});
		return [...forms];
	}

	private storageKey() {
		return `tender_product_survey:${this.question}`;
	}

	private readStoredAnswer() {
		const answer = window.sessionStorage.getItem(this.storageKey()) || "";
		return this.answers.includes(answer) ? answer : "";
	}

	private writeStoredAnswer(answer: string) {
		window.sessionStorage.setItem(this.storageKey(), answer);
	}
}

function ensureCartAddFetchPatch() {
	if (cartAddFetchPatched || typeof window.fetch !== "function") return;
	const originalFetch = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const patchedInit = patchCartAddInit(input, init);
		return originalFetch(input, patchedInit);
	};
	cartAddFetchPatched = true;
}

function patchCartAddInit(input: RequestInfo | URL, init?: RequestInit) {
	const url = requestUrl(input);
	if (!url || !CART_ADD_PATH_PATTERN.test(url.pathname)) return init;

	const properties = activeLineProperties();
	if (Object.keys(properties).length === 0) return init;

	const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
	if (method !== "POST") return init;

	const body = init?.body;
	if (typeof body === "string") {
		const patchedJson = patchJsonBody(body, properties);
		if (patchedJson) return { ...init, body: patchedJson };

		const patchedParams = patchUrlEncodedBody(body, properties);
		if (patchedParams) return { ...init, body: patchedParams };
	}

	if (body instanceof FormData) {
		const nextBody = new FormData();
		body.forEach((value, key) => nextBody.append(key, value));
		Object.entries(properties).forEach(([key, value]) => {
			nextBody.set(`properties[${key}]`, value);
		});
		return { ...init, body: nextBody };
	}

	return init;
}

function patchJsonBody(body: string, properties: LineProperties) {
	try {
		const parsed = JSON.parse(body) as CartAddPayload;
		if (Array.isArray(parsed.items)) {
			parsed.items = parsed.items.map((item) => ({
				...item,
				properties: { ...(item.properties || {}), ...properties }
			}));
		} else {
			parsed.properties = { ...(parsed.properties || {}), ...properties };
		}
		return JSON.stringify(parsed);
	} catch {
		return null;
	}
}

function patchUrlEncodedBody(body: string, properties: LineProperties) {
	const params = new URLSearchParams(body);
	if (!params.has("id") && !params.has("items[][id]")) return null;
	Object.entries(properties).forEach(([key, value]) => {
		params.set(`properties[${key}]`, value);
	});
	return params.toString();
}

function activeLineProperties() {
	const merged: LineProperties = {};
	selectedSurveys.forEach((survey) => {
		Object.assign(merged, survey.getLineProperties());
	});
	return merged;
}

function requestUrl(input: RequestInfo | URL) {
	try {
		const value = input instanceof Request ? input.url : input.toString();
		return new URL(value, window.location.origin);
	} catch {
		return null;
	}
}

function syncHiddenInput(form: HTMLFormElement, name: string, value: string) {
	const selector = `input[type="hidden"][name="${cssEscape(name)}"]`;
	let input = form.querySelector<HTMLInputElement>(selector);
	if (!value) {
		input?.remove();
		return;
	}
	if (!input) {
		input = document.createElement("input");
		input.type = "hidden";
		input.name = name;
		form.appendChild(input);
	}
	input.value = value;
}

function privatePropertyKey(value: string | undefined, fallback: string) {
	const normalized = textValue(value, fallback).replace(/[^a-zA-Z0-9_]/g, "_");
	return normalized.startsWith("_") ? normalized : `_${normalized}`;
}

function textValue(value: string | undefined, fallback: string) {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed || fallback;
}

function cssEscape(value: string) {
	if (window.CSS?.escape) return window.CSS.escape(value);
	return value.replace(/"/g, '\\"');
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeAttr(value: string) {
	return escapeHtml(value);
}

if (!customElements.get("tender-product-survey")) {
	customElements.define("tender-product-survey", TenderProductSurvey);
}
