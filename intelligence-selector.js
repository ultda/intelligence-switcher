// ==UserScript==
// @name         ChatGPT Compact Intelligence Selector (for PLUS)
// @namespace    local.chatgpt.compact-model-selector
// @version      0.2.3
// @description  One-click Intelligence switcher for ChatGPT for 'Plus' subscription
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ultda/cgpt-addons/refs/heads/main/intelligence-selector.js
// @downloadURL  https://raw.githubusercontent.com/ultda/cgpt-addons/refs/heads/main/intelligence-selector.js
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const ROOT_ID = "cgpt-compact-model-selector";
  const STYLE_ID = "cgpt-compact-model-selector-style";

  const INTELLIGENCE = {
    high: {
      label: "High",
      icon: "◆",
      title: "High",
    },
    medium: {
      label: "Medium",
      icon: "◇",
      title: "Medium",
    },
    instant: {
      label: "Instant",
      icon: "⚡",
      title: "Instant",
    },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(...args) {
    console.debug("[compact-model-selector]", ...args);
  }

  function visibleText(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function clickLikeUser(el) {
    if (!el) return false;

    const pointerOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };

    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: 1,
    };

    try {
      el.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
      el.dispatchEvent(new PointerEvent("pointerenter", pointerOpts));
      el.dispatchEvent(new PointerEvent("pointermove", pointerOpts));
      el.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
    } catch {
      // PointerEvent fallback.
    }

    el.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
    el.dispatchEvent(new MouseEvent("mouseenter", mouseOpts));
    el.dispatchEvent(new MouseEvent("mousedown", mouseOpts));

    try {
      el.focus?.();
    } catch {}

    try {
      el.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
    } catch {}

    el.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
    el.dispatchEvent(new MouseEvent("click", mouseOpts));

    return true;
  }

  async function waitFor(fn, timeoutMs = 1500, intervalMs = 25) {
    const start = performance.now();

    while (performance.now() - start < timeoutMs) {
      const val = fn();
      if (val) return val;
      await sleep(intervalMs);
    }

    return null;
  }

  function getComposer() {
    const composers = [...document.querySelectorAll('[data-composer-surface="true"]')];
    return composers.at(-1) || document;
  }

  function getOldModelButton() {
    const composer = getComposer();

    const candidates = [
      ...composer.querySelectorAll('button.__composer-pill[aria-haspopup="menu"]'),
    ].filter((btn) => !btn.closest(`#${ROOT_ID}`));

    return (
      candidates.find((btn) =>
        /^(Instant|Medium|High|GPT|5\.5|5\.3|Auto|Thinking|Extended)$/i.test(
          visibleText(btn)
        )
      ) ||
      candidates.find((btn) =>
        /\b(Instant|Medium|High|GPT|5\.5|5\.3|Auto|Thinking|Extended)\b/i.test(
          visibleText(btn)
        )
      ) ||
      null
    );
  }

  function getOldModelWrapper() {
    const btn = getOldModelButton();
    if (!btn) return null;

    return (
      btn.closest(".relative.ms-1") ||
      btn.closest('[class*="relative"]') ||
      btn.parentElement
    );
  }

  function getOpenRadixMenus() {
    return [...document.querySelectorAll('[data-radix-menu-content][role="menu"]')];
  }

  function getMainModelMenu() {
    return (
      getOpenRadixMenus().find((menu) =>
        menu.querySelector('[data-testid="composer-intelligence-picker-content"]')
      ) || null
    );
  }

  function getMenuItems(menu) {
    return [...(menu?.querySelectorAll('[role="menuitemradio"], [role="menuitem"]') || [])];
  }

  function findRadioByExactText(menu, label) {
    return (
      getMenuItems(menu).find((item) => {
        if (item.getAttribute("role") !== "menuitemradio") return false;
        return visibleText(item).toLowerCase() === label.toLowerCase();
      }) || null
    );
  }

  function getActiveKindFromText(text) {
    if (/\bHigh\b/i.test(text)) return "high";
    if (/\bMedium\b/i.test(text)) return "medium";
    if (/\bInstant\b/i.test(text)) return "instant";
    return null;
  }

  function refreshActiveFromButton() {
    const oldButton = getOldModelButton();
    if (!oldButton) return;

    const kind = getActiveKindFromText(visibleText(oldButton));
    if (kind) setActive(kind);
  }

  function refreshActiveFromMenu(menu) {
    const checked = getMenuItems(menu).find(
      (item) =>
        item.getAttribute("role") === "menuitemradio" &&
        item.getAttribute("aria-checked") === "true"
    );

    const kind = getActiveKindFromText(visibleText(checked));
    if (kind) setActive(kind);
  }

  async function openMainModelMenu() {
    let menu = getMainModelMenu();
    if (menu) {
      refreshActiveFromMenu(menu);
      return menu;
    }

    const oldButton = getOldModelButton();
    if (!oldButton) {
      log("model/intelligence pill not found");
      return null;
    }

    clickLikeUser(oldButton);

    menu = await waitFor(getMainModelMenu);

    if (!menu) {
      log("intelligence menu did not open");
      return null;
    }

    refreshActiveFromMenu(menu);
    return menu;
  }

  async function selectIntelligence(kind) {
    const config = INTELLIGENCE[kind];
    if (!config) return false;

    setBusy(true);

    try {
      const menu = await openMainModelMenu();
      if (!menu) return false;

      const item = findRadioByExactText(menu, config.label);

      if (!item) {
        log("intelligence item not found", config.label, visibleText(menu));
        return false;
      }

      clickLikeUser(item);

      setActive(kind);
      await sleep(180);
      refreshActiveFromButton();

      return true;
    } finally {
      setBusy(false);
    }
  }

  async function showMoreModels() {
    await openMainModelMenu();
  }

  function setBusy(isBusy) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.dataset.busy = isBusy ? "true" : "false";
  }

  function setActive(kind) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    for (const btn of root.querySelectorAll("button[data-kind]")) {
      btn.dataset.active = btn.dataset.kind === kind ? "true" : "false";
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 36px;
        margin-inline: 0 2px;
        flex: 0 0 auto;
      }

      #${ROOT_ID}[data-busy="true"] {
        opacity: 0.55;
        pointer-events: none;
      }

      #${ROOT_ID} button {
        width: 27px;
        height: 27px;
        min-width: 27px;
        min-height: 27px;
        border: 0;
        border-radius: 999px;
        padding: 0;
        display: inline-grid;
        place-items: center;
        cursor: pointer;
        font: 600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text-secondary, #8f8f8f);
        background: transparent;
        transition:
          background-color 120ms ease,
          color 120ms ease,
          transform 80ms ease,
          opacity 120ms ease;
      }

      #${ROOT_ID} button:hover {
        background: var(--composer-surface-secondary, rgba(127, 127, 127, 0.14));
        color: var(--text-primary, currentColor);
      }

      #${ROOT_ID} button:active {
        transform: scale(0.94);
      }

      #${ROOT_ID} button[data-active="true"] {
        background: var(--composer-surface-secondary, rgba(127, 127, 127, 0.18));
        color: var(--text-primary, currentColor);
      }

      #${ROOT_ID} .cgpt-plus {
        font-size: 17px;
        font-weight: 500;
      }

      .cgpt-old-model-selector-hidden {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        min-width: 1px !important;
        min-height: 1px !important;
        max-width: 1px !important;
        max-height: 1px !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        clip-path: inset(50%) !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      @media (max-width: 640px) {
        #${ROOT_ID} {
          gap: 1px;
        }

        #${ROOT_ID} button {
          width: 24px;
          height: 24px;
          min-width: 24px;
          min-height: 24px;
          font-size: 12px;
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  function createButton(kind, label, title, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.kind = kind;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    return btn;
  }

  function install() {
    injectStyle();

    const oldWrapper = getOldModelWrapper();
    const oldButton = getOldModelButton();

    if (!oldWrapper || !oldButton) return;

    let root = document.getElementById(ROOT_ID);

    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.dataset.busy = "false";

      root.append(
        createButton("high", "◆", "High", () => selectIntelligence("high")),
        createButton("medium", "◇", "Medium", () => selectIntelligence("medium")),
        createButton("instant", "⚡", "Instant", () => selectIntelligence("instant")),
        createButton("more", "+", "More models", showMoreModels)
      );

      root.querySelector('[data-kind="more"]').classList.add("cgpt-plus");

      oldWrapper.parentElement.insertBefore(root, oldWrapper);
    }

    oldWrapper.classList.add("cgpt-old-model-selector-hidden");

    refreshActiveFromButton();
  }

  const observer = new MutationObserver(() => {
    cancelAnimationFrame(observer._raf);
    observer._raf = requestAnimationFrame(install);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  install();
})();
