(function () {
	const BLOCK_SELECTOR = "[data-fixed-price-bundle-builder-block]";
	const loadedScripts = new Map();
	const loadedStylesheets = new Set();
	const passThroughDatasetKeys = [
		"mode",
		"productHandle",
		"productId",
		"productTitle",
		"shopDomain",
		"stylesheetUrl",
	];

	function loadStylesheet(href) {
		if (!href || loadedStylesheets.has(href)) return;

		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		document.head.appendChild(link);
		loadedStylesheets.add(href);
	}

	function loadScript(src) {
		if (loadedScripts.has(src)) return loadedScripts.get(src);

		const promise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.type = "module";
			script.src = src;
			script.crossOrigin = "anonymous";
			script.addEventListener("load", resolve, { once: true });
			script.addEventListener("error", reject, { once: true });
			document.head.appendChild(script);
		});

		loadedScripts.set(src, promise);
		return promise;
	}

	function createBundleElement(root, tagName) {
		const element = document.createElement(tagName);
		for (const key of passThroughDatasetKeys) {
			const value = root.dataset[key];
			if (value) element.dataset[key] = value;
		}

		const configData = root.querySelector(
			"script[data-fixed-price-bundle-config]"
		);
		if (configData) {
			element.appendChild(configData.cloneNode(true));
		}

		return element;
	}

	async function mountBlock(root) {
		if (root.dataset.fpMounted === "true") return;

		const runtimeSrc = root.dataset.tenderRuntimeSrc;
		const elementTag = root.dataset.tenderElementTag || "fixed-price-bundle-builder";
		if (!runtimeSrc) return;

		root.dataset.fpMounted = "true";
		loadStylesheet(root.dataset.stylesheetUrl);

		try {
			await loadScript(runtimeSrc);
			await customElements.whenDefined(elementTag);
			root.replaceChildren(createBundleElement(root, elementTag));
		} catch (error) {
			root.dataset.fpMounted = "false";
			root.classList.add("fp-bundle-builder-app-block--failed");
			console.error("Bundle builder failed to load", error);
		}
	}

	function mountBlocks(container) {
		const scope = container || document;
		scope.querySelectorAll(BLOCK_SELECTOR).forEach((root) => {
			mountBlock(root);
		});
	}

	document.addEventListener("DOMContentLoaded", () => mountBlocks(document));
	document.addEventListener("shopify:section:load", (event) => {
		mountBlocks(event.target);
	});
	mountBlocks(document);
})();

