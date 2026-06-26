// ==UserScript==
// @name         ChatGPT Collapsible Sections
// @namespace    https://chatgpt.com/
// @version      1.2.0
// @description  Click any heading in ChatGPT responses to collapse or expand its section.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @updateURL    https://raw.githubusercontent.com/ultda/cgpt-addons/refs/heads/main/collapsible-sections.js
// @downloadURL  https://raw.githubusercontent.com/ultda/cgpt-addons/refs/heads/main/collapsible-sections.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==


(() => {
  "use strict";

  const ROOT_SELECTOR =
    '[data-message-author-role="assistant"] .markdown';

  const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
  const STORAGE_PREFIX = "cgpt-collapsible-section:v1:";
  let ownerCounter = 0;
  let updateQueued = false;

  const style = document.createElement("style");
  style.textContent = `
    .cgpt-collapsible-heading {
      position: relative;
      cursor: pointer;
      padding-inline-start: 1.35em;
      border-radius: 0.35rem;
    }

    .cgpt-collapsible-heading::before {
      content: "▾";
      position: absolute;
      inset-inline-start: 0.1em;
      top: 0;
      opacity: 0.65;
      transition: transform 120ms ease;
      transform-origin: center;
    }

    .cgpt-collapsible-heading[data-cgpt-collapsed="true"]::before {
      transform: rotate(-90deg);
    }

    .cgpt-collapsible-heading:hover {
      background: color-mix(in srgb, currentColor 7%, transparent);
    }

    .cgpt-collapsible-heading:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 3px;
    }

    .cgpt-section-hidden {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  function headingLevel(element) {
    return Number(element.tagName.slice(1));
  }

  function isBoundary(element, currentLevel) {
    return (
      element.matches?.(HEADING_SELECTOR) &&
      headingLevel(element) <= currentLevel
    );
  }

  function sectionNodes(heading) {
    const nodes = [];
    const level = headingLevel(heading);
    let current = heading.nextElementSibling;

    while (current && !isBoundary(current, level)) {
      nodes.push(current);
      current = current.nextElementSibling;
    }

    return nodes;
  }

  function hiddenOwners(element) {
    return new Set(
      (element.dataset.cgptHiddenBy ?? "")
        .split(" ")
        .filter(Boolean)
    );
  }

  function setHiddenOwners(element, owners) {
    if (owners.size > 0) {
      element.dataset.cgptHiddenBy = [...owners].join(" ");
      element.classList.add("cgpt-section-hidden");
    } else {
      delete element.dataset.cgptHiddenBy;
      element.classList.remove("cgpt-section-hidden");
    }
  }

  function addOwner(element, owner) {
    const owners = hiddenOwners(element);
    owners.add(owner);
    setHiddenOwners(element, owners);
  }

  function removeOwner(element, owner) {
    const owners = hiddenOwners(element);
    owners.delete(owner);
    setHiddenOwners(element, owners);
  }

  function storageKey(heading, root) {
    const message =
      heading.closest("[data-message-id]")?.dataset.messageId ?? "unknown";

    const section =
      heading.dataset.sectionId ??
      `heading-${[...root.querySelectorAll(HEADING_SELECTOR)].indexOf(heading)}`;

    return `${STORAGE_PREFIX}${location.pathname}:${message}:${section}`;
  }

  function readCollapsed(heading, root) {
    const key = storageKey(heading, root);

    try {
      const saved = GM_getValue(key, null);
      if (saved !== null) {
        return saved === true;
      }
    } catch {
      // Fall through to the one-time localStorage migration below.
    }

    // Migrate state saved by version 1.0.0, then use GM storage from now on.
    try {
      const oldValue = localStorage.getItem(key);
      if (oldValue === "1") {
        GM_setValue(key, true);
        localStorage.removeItem(key);
        return true;
      }
    } catch {
      // No persisted state is still a valid state.
    }

    return false;
  }

  function writeCollapsed(heading, root, collapsed) {
    const key = storageKey(heading, root);

    try {
      if (collapsed) {
        GM_setValue(key, true);
      } else {
        GM_deleteValue(key);
      }
    } catch {
      // The collapse interaction still works if userscript storage fails.
    }
  }

  function applyState(heading) {
    const root = heading.closest(ROOT_SELECTOR);
    if (!root) return;

    const owner = heading.dataset.cgptCollapseOwner;
    const collapsed = heading.dataset.cgptCollapsed === "true";

    // Clear the owner's previous range first. This matters while ChatGPT is
    // still streaming or replacing DOM nodes.
    root.querySelectorAll("[data-cgpt-hidden-by]").forEach((element) => {
      if (hiddenOwners(element).has(owner)) {
        removeOwner(element, owner);
      }
    });

    if (collapsed) {
      sectionNodes(heading).forEach((element) => addOwner(element, owner));
    }

    heading.setAttribute("aria-expanded", String(!collapsed));
    heading.title = collapsed
      ? "Click to expand this section"
      : "Click to collapse this section";
  }

  function setCollapsed(heading, collapsed, persist = true) {
    const root = heading.closest(ROOT_SELECTOR);
    if (!root) return;

    heading.dataset.cgptCollapsed = String(collapsed);

    if (persist) {
      writeCollapsed(heading, root, collapsed);
    }

    applyState(heading);
  }

  function toggleHeading(heading) {
    setCollapsed(
      heading,
      heading.dataset.cgptCollapsed !== "true"
    );
  }

  function prepareHeading(heading, root) {
    if (heading.dataset.cgptCollapsibleReady === "true") {
      return;
    }

    heading.dataset.cgptCollapsibleReady = "true";
    heading.dataset.cgptCollapseOwner = `cgpt-${++ownerCounter}`;
    heading.classList.add("cgpt-collapsible-heading");
    heading.setAttribute("role", "button");
    heading.setAttribute("tabindex", "0");

    heading.addEventListener("click", (event) => {
      if (event.target.closest("a, button, input, textarea, select")) return;
      toggleHeading(heading);
    });

    heading.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleHeading(heading);
    });

    setCollapsed(heading, readCollapsed(heading, root), false);
  }

  function update() {
    updateQueued = false;

    document.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
      root.querySelectorAll(HEADING_SELECTOR).forEach((heading) => {
        prepareHeading(heading, root);
      });

      // Recalculate ranges because content may have streamed in.
      root
        .querySelectorAll(".cgpt-collapsible-heading")
        .forEach(applyState);
    });
  }

  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(update);
  }

  new MutationObserver(queueUpdate).observe(document.body, {
    childList: true,
    subtree: true,
  });

  queueUpdate();
})();
