// ==UserScript==
// @name         ChatGPT Collapsible Headings & Replies
// @namespace    https://chatgpt.com/
// @version      1.4.0
// @description  Collapse individual headings or entire ChatGPT assistant turns.
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

  /*
   * ChatGPT structure:
   *
   * section[data-turn="assistant"]       = one complete assistant turn
   *   data-message-author-role=assistant = individual streamed interludes,
   *                                        updates, or the final answer
   *
   * Reply-level collapsing therefore targets the outer section/turn, while
   * heading-level collapsing still targets markdown inside message blocks.
   */

  const TURN_SELECTOR =
    'section[data-turn="assistant"][data-turn-id]';

  const TURN_CONTENT_SELECTOR =
    '[data-conversation-screenshot-content]';

  const MESSAGE_SELECTOR =
    '[data-message-author-role="assistant"][data-message-id]';

  const MARKDOWN_ROOT_SELECTOR =
    `${MESSAGE_SELECTOR} .markdown`;

  const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

  const SECTION_STORAGE_PREFIX = "cgpt-collapsible-section:v1:";
  const TURN_STORAGE_PREFIX = "cgpt-collapsible-turn:v1:";

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

    .cgpt-collapsible-heading:focus-visible,
    .cgpt-turn-toggle:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 3px;
    }

    .cgpt-section-hidden {
      display: none !important;
    }

    .cgpt-turn-toggle {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-block: 0 0.35rem;
      padding: 0.2rem 0.55rem;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-tertiary, currentColor);
      font: inherit;
      font-size: 0.75rem;
      line-height: 1.4;
      opacity: 0.65;
      cursor: pointer;
    }

    .cgpt-turn-toggle:hover {
      opacity: 1;
      background: color-mix(in srgb, currentColor 8%, transparent);
    }

    .cgpt-turn-toggle-icon {
      display: inline-block;
      transition: transform 120ms ease;
    }

    .cgpt-turn-content[data-cgpt-turn-collapsed="true"]
      > .cgpt-turn-toggle
      .cgpt-turn-toggle-icon {
      transform: rotate(-90deg);
    }

    /*
     * The toggle is a direct child of the turn's content container. Everything
     * else—including thought interludes, progress updates, the final answer,
     * and response actions—is hidden as one unit.
     */
    .cgpt-turn-content[data-cgpt-turn-collapsed="true"]
      > :not(.cgpt-turn-toggle) {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  function getStoredBoolean(key) {
    try {
      return GM_getValue(key, false) === true;
    } catch {
      return false;
    }
  }

  function writeStoredBoolean(key, value) {
    try {
      if (value) {
        GM_setValue(key, true);
      } else {
        GM_deleteValue(key);
      }
    } catch {
      // The current-page interaction still works if storage is unavailable.
    }
  }

  // ---------------------------------------------------------------------------
  // Heading-level collapsing
  // ---------------------------------------------------------------------------

  function headingLevel(element) {
    return Number(element.tagName.slice(1));
  }

  function isHeadingBoundary(element, currentLevel) {
    return (
      element.matches?.(HEADING_SELECTOR) &&
      headingLevel(element) <= currentLevel
    );
  }

  function sectionNodes(heading) {
    const nodes = [];
    const level = headingLevel(heading);
    let current = heading.nextElementSibling;

    while (current && !isHeadingBoundary(current, level)) {
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

  function sectionStorageKey(heading, root) {
    const turnId =
      heading.closest(TURN_SELECTOR)?.dataset.turnId ?? "unknown-turn";

    const sectionId =
      heading.dataset.sectionId ??
      `heading-${[...root.querySelectorAll(HEADING_SELECTOR)].indexOf(heading)}`;

    return (
      `${SECTION_STORAGE_PREFIX}${location.pathname}:` +
      `${turnId}:${sectionId}`
    );
  }

  function readSectionCollapsed(heading, root) {
    const key = sectionStorageKey(heading, root);

    try {
      const saved = GM_getValue(key, null);
      if (saved !== null) {
        return saved === true;
      }
    } catch {
      // Fall through to legacy localStorage migration.
    }

    try {
      const legacyValue = localStorage.getItem(key);
      if (legacyValue === "1") {
        GM_setValue(key, true);
        localStorage.removeItem(key);
        return true;
      }
    } catch {
      // No persisted value is valid.
    }

    return false;
  }

  function applyHeadingState(heading) {
    const root = heading.closest(MARKDOWN_ROOT_SELECTOR);
    if (!root) return;

    const owner = heading.dataset.cgptCollapseOwner;
    const collapsed = heading.dataset.cgptCollapsed === "true";

    /*
     * Clear this heading owner's old range before recalculating it. ChatGPT can
     * stream additional nodes or replace parts of the DOM while responding.
     */
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

  function setHeadingCollapsed(heading, collapsed, persist = true) {
    const root = heading.closest(MARKDOWN_ROOT_SELECTOR);
    if (!root) return;

    heading.dataset.cgptCollapsed = String(collapsed);

    if (persist) {
      writeStoredBoolean(
        sectionStorageKey(heading, root),
        collapsed
      );
    }

    applyHeadingState(heading);
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

      setHeadingCollapsed(
        heading,
        heading.dataset.cgptCollapsed !== "true"
      );
    });

    heading.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      setHeadingCollapsed(
        heading,
        heading.dataset.cgptCollapsed !== "true"
      );
    });

    setHeadingCollapsed(
      heading,
      readSectionCollapsed(heading, root),
      false
    );
  }

  // ---------------------------------------------------------------------------
  // Whole-turn collapsing
  // ---------------------------------------------------------------------------

  function turnStorageKey(turn) {
    return (
      `${TURN_STORAGE_PREFIX}${location.pathname}:` +
      `${turn.dataset.turnId ?? "unknown-turn"}`
    );
  }

  function updateTurnButton(turn, container) {
    const button = container.querySelector(":scope > .cgpt-turn-toggle");
    if (!button) return;

    const collapsed = container.dataset.cgptTurnCollapsed === "true";
    const label = collapsed ? "Expand reply" : "Collapse reply";

    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", label);
    button.title = label;

    const text = button.querySelector(".cgpt-turn-toggle-text");
    if (text) {
      text.textContent = label;
    }
  }

  function setTurnCollapsed(turn, container, collapsed, persist = true) {
    container.dataset.cgptTurnCollapsed = String(collapsed);

    if (persist) {
      writeStoredBoolean(turnStorageKey(turn), collapsed);
    }

    updateTurnButton(turn, container);
  }

  function removeLegacyPerMessageButtons(turn) {
    turn.querySelectorAll(
      `${MESSAGE_SELECTOR} > .cgpt-reply-toggle`
    ).forEach((button) => button.remove());

    turn.querySelectorAll(MESSAGE_SELECTOR).forEach((message) => {
      delete message.dataset.cgptReplyReady;
      delete message.dataset.cgptReplyCollapsed;
    });
  }

  function prepareTurn(turn) {
    const container = turn.querySelector(TURN_CONTENT_SELECTOR);
    if (!container) return;

    /*
     * Clean up v1.3 controls if the userscript is hot-reloaded without a full
     * page refresh.
     */
    removeLegacyPerMessageButtons(turn);

    container.classList.add("cgpt-turn-content");

    let button = container.querySelector(":scope > .cgpt-turn-toggle");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "cgpt-turn-toggle";
      button.innerHTML = `
        <span class="cgpt-turn-toggle-icon" aria-hidden="true">▾</span>
        <span class="cgpt-turn-toggle-text">Collapse reply</span>
      `;

      button.addEventListener("click", () => {
        setTurnCollapsed(
          turn,
          container,
          container.dataset.cgptTurnCollapsed !== "true"
        );
      });

      container.prepend(button);
    }

    if (container.dataset.cgptTurnReady !== "true") {
      container.dataset.cgptTurnReady = "true";

      setTurnCollapsed(
        turn,
        container,
        getStoredBoolean(turnStorageKey(turn)),
        false
      );
    } else {
      updateTurnButton(turn, container);
    }
  }

  // ---------------------------------------------------------------------------
  // Dynamic ChatGPT DOM handling
  // ---------------------------------------------------------------------------

  function update() {
    updateQueued = false;

    document.querySelectorAll(TURN_SELECTOR).forEach(prepareTurn);

    document.querySelectorAll(MARKDOWN_ROOT_SELECTOR).forEach((root) => {
      root.querySelectorAll(HEADING_SELECTOR).forEach((heading) => {
        prepareHeading(heading, root);
      });

      root
        .querySelectorAll(".cgpt-collapsible-heading")
        .forEach(applyHeadingState);
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
