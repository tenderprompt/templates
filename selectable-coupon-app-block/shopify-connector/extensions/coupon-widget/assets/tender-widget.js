(function () {
  const loader = (window.TenderPromptBlockLoader ||= {});
  loader.scripts ||= new Map();
  loader.stylesheets ||= new Map();

  function loadScript(src) {
    if (!src) return Promise.reject(new Error("Missing Tender runtime URL"));

    const existing = loader.scripts.get(src);
    if (existing) return existing.promise;

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

    loader.scripts.set(src, { status: "loading", promise });
    promise.then(
      () => loader.scripts.set(src, { status: "loaded", promise }),
      () => loader.scripts.delete(src),
    );

    return promise;
  }

  function loadStylesheet(src) {
    if (!src) return Promise.resolve();
    const existing = loader.stylesheets.get(src);
    if (existing) return existing.promise;

    const promise = new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = src;
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });

    loader.stylesheets.set(src, { status: "loading", promise });
    promise.then(() => loader.stylesheets.set(src, { status: "loaded", promise }));
    return promise;
  }

  function afterFrame(callback) {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      callback();
    };

    setTimeout(finish, 80);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  }

  function stylesheetLoaded(href) {
    return performance.getEntriesByName(href).some((entry) => entry.responseEnd > 0);
  }

  function waitForWidgetPaintReady(widget, stylesheetUrl) {
    const stylesheetHref = stylesheetUrl ? new URL(stylesheetUrl, document.baseURI).href : null;

    return new Promise((resolve) => {
      let settled = false;
      let noShadowTimer = null;
      let rootWithoutStylesheetTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        clearTimeout(noShadowTimer);
        clearTimeout(rootWithoutStylesheetTimer);
        afterFrame(resolve);
      };

      const check = () => {
        const root = widget.shadowRoot;
        if (!root) {
          noShadowTimer ||= setTimeout(finish, 350);
          return;
        }

        clearTimeout(noShadowTimer);
        const links = Array.from(root.querySelectorAll('link[rel="stylesheet"]'));
        const stylesheet = stylesheetHref
          ? links.find((link) => link.href === stylesheetHref)
          : links[0];

        if (!stylesheet) {
          rootWithoutStylesheetTimer ||= setTimeout(finish, 500);
          return;
        }

        clearTimeout(rootWithoutStylesheetTimer);
        if (stylesheet.sheet || stylesheetLoaded(stylesheet.href)) {
          finish();
          return;
        }

        stylesheet.addEventListener("load", finish, { once: true });
        stylesheet.addEventListener("error", finish, { once: true });
      };

      const interval = setInterval(check, 25);
      const timeout = setTimeout(finish, 2200);
      check();
    });
  }

  function revealWidget(mount, widget) {
    const placeholder = mount.querySelector("[data-tender-placeholder]");
    widget.style.visibility = "";
    widget.style.position = "";
    widget.style.inset = "";
    widget.style.pointerEvents = "";
    placeholder?.remove();
    mount.dataset.tenderReady = "true";
    mount.setAttribute("aria-busy", "false");
  }

  class TenderPromptWidgetBlock extends HTMLElement {
    connectedCallback() {
      this.mount();
    }

    async mount() {
      const mount = this.querySelector("[data-tender-mount]");
      const elementTag = this.dataset.tenderElementTag;
      if (!mount || !elementTag || mount.dataset.tenderMounted === "true") return;

      const appBlock = this.closest(".shopify-app-block");
      if (appBlock) {
        appBlock.style.width = "100%";
        appBlock.style.alignSelf = "stretch";
      }

      mount.setAttribute("aria-busy", "true");
      const stylesheetPromise = loadStylesheet(this.dataset.stylesheetUrl);
      await loadScript(this.dataset.tenderRuntimeSrc);
      await Promise.race([
        customElements.whenDefined(elementTag),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);

      const widget = document.createElement(elementTag);
      widget.classList.add("tender-prompt-widget-block__widget");
      for (const [key, value] of Object.entries(this.dataset)) {
        if (value == null || key === "tenderRuntimeSrc" || key === "tenderElementTag") continue;
        widget.dataset[key] = value;
      }

      widget.style.visibility = "hidden";
      widget.style.position = "absolute";
      widget.style.inset = "0";
      widget.style.pointerEvents = "none";
      mount.appendChild(widget);
      mount.dataset.tenderMounted = "true";
      await Promise.all([
        stylesheetPromise,
        waitForWidgetPaintReady(widget, this.dataset.stylesheetUrl),
      ]);
      revealWidget(mount, widget);
    }
  }

  if (!customElements.get("tender-prompt-widget-block")) {
    customElements.define("tender-prompt-widget-block", TenderPromptWidgetBlock);
  }

  function clampHeight(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.ceil(value)));
  }

  class TenderPromptIframeBlock extends HTMLElement {
    connectedCallback() {
      this.mount();
    }

    disconnectedCallback() {
      if (this.messageHandler) {
        window.removeEventListener("message", this.messageHandler);
        this.messageHandler = null;
      }
    }

    mount() {
      const iframe = this.querySelector("iframe[data-tender-iframe]");
      if (!iframe || iframe.dataset.tenderMounted === "true") return;

      const appBlock = this.closest(".shopify-app-block");
      if (appBlock) {
        appBlock.style.width = "100%";
        appBlock.style.alignSelf = "stretch";
      }

      const minHeight = Number(this.dataset.minHeight || 620);
      const maxHeight = Number(this.dataset.maxHeight || 2600);
      const resizeType = this.dataset.resizeType;
      const allowedOrigin = new URL(iframe.src, document.baseURI).origin;

      this.messageHandler = (event) => {
        if (event.origin !== allowedOrigin) return;
        if (!event.data || event.data.type !== resizeType) return;

        const nextHeight = clampHeight(Number(event.data.height), minHeight, maxHeight);
        iframe.style.height = `${nextHeight}px`;
        iframe.dataset.tenderHeight = String(nextHeight);
      };

      iframe.dataset.tenderMounted = "true";
      window.addEventListener("message", this.messageHandler);
    }
  }

  if (!customElements.get("tender-prompt-iframe-block")) {
    customElements.define("tender-prompt-iframe-block", TenderPromptIframeBlock);
  }
})();
