// Renders the model the extension posts (src/clustersModel.ts). No logic, no network:
// every click and every drop goes back to the extension as a message.
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const STATE_TEXT = { live: "connected", loggingIn: "logging in", loggedOut: "logged out" };
  /** The cluster being dragged; dataTransfer can't be read during dragover. */
  let dragged = "";

  /** Creates an element with a class and text; text never goes through innerHTML. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, message) {
    const node = el("button", className, text);
    node.type = "button";
    node.addEventListener("click", () => vscode.postMessage(message));
    return node;
  }

  function cards() {
    return /** @type {HTMLElement[]} */ ([...app.querySelectorAll(".cluster")]);
  }

  function move(cluster, before) {
    vscode.postMessage({ type: "move", cluster, before });
  }

  function head(card) {
    const node = el("div", "head");
    node.title = card.target;
    node.append(el("span", "grip", "⠿"), el("span", "dot"), el("span", "name", card.name), el("span", "status", STATE_TEXT[card.state]));
    if (card.state === "live") {
      node.append(button("link-button logout", "Log out", { type: "logout", cluster: card.name }));
    }
    return node;
  }

  function budgetBar(fraction) {
    const bar = el("div", "bar");
    const fill = el("div", "fill");
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    bar.append(fill);
    return bar;
  }

  function details(card) {
    const list = el("dl", "details");
    for (const detail of card.details) {
      const value = el("dd");
      if (detail.action) {
        value.append(button("link-button", detail.value, { type: detail.action, cluster: card.name }));
      } else {
        value.textContent = detail.value;
      }
      if (detail.tooltip) value.title = detail.tooltip;
      if (detail.label === "Budget" && card.budgetFraction !== undefined) value.append(budgetBar(card.budgetFraction));
      list.append(el("dt", "", detail.label), value);
    }
    return list;
  }

  function body(card) {
    if (card.state === "live") return details(card);
    const login = button("primary login", card.state === "loggingIn" ? "Logging in…" : "Log in", { type: "login", cluster: card.name });
    login.disabled = card.state === "loggingIn";
    return login;
  }

  function clearDropMarks() {
    for (const node of cards()) node.classList.remove("drop-before", "drop-after");
  }

  /** True when the pointer is in the lower half of `node`, so a drop goes after it. */
  function isLowerHalf(node, event) {
    const box = node.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  }

  /** Lets the card be dragged, and Alt+Up / Alt+Down move it from the keyboard. */
  function makeMovable(node, name) {
    node.draggable = true;
    node.addEventListener("dragstart", (event) => {
      dragged = name;
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      event.dataTransfer?.setData("text/plain", name);
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => {
      dragged = "";
      node.classList.remove("dragging");
      clearDropMarks();
    });
    node.addEventListener("dragover", (event) => {
      if (!dragged || dragged === name) return;
      event.preventDefault();
      clearDropMarks();
      node.classList.add(isLowerHalf(node, event) ? "drop-after" : "drop-before");
    });
    node.addEventListener("drop", (event) => {
      if (!dragged || dragged === name) return;
      event.preventDefault();
      clearDropMarks();
      const names = cards().map((card) => card.dataset.cluster);
      const before = isLowerHalf(node, event) ? names[names.indexOf(name) + 1] ?? null : name;
      if (before !== dragged) move(dragged, before);
    });
    node.addEventListener("keydown", (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.target !== node) return;
      event.preventDefault();
      const names = cards().map((card) => card.dataset.cluster);
      const index = names.indexOf(name);
      const before = event.key === "ArrowUp" ? names[index - 1] : names[index + 2];
      if (event.key === "ArrowUp" && before === undefined) return;
      move(name, before ?? null);
    });
  }

  function clusterCard(card) {
    const node = el("section", `cluster state-${card.state}`);
    node.dataset.cluster = card.name;
    node.tabIndex = 0;
    node.setAttribute("aria-label", `${card.name}, ${STATE_TEXT[card.state]}. Alt+Up or Alt+Down moves it.`);
    node.append(head(card), body(card));
    makeMovable(node, card.name);
    return node;
  }

  function render(model) {
    const focused = /** @type {HTMLElement | null} */ (document.activeElement)?.closest?.(".cluster")?.getAttribute("data-cluster");
    const nodes = [];
    if (model.error) nodes.push(el("div", "error", model.error));
    if (model.clusters.length === 0) {
      nodes.push(el("p", "muted", model.loaded ? "No clusters in your ctun config." : "Loading clusters…"));
    }
    nodes.push(...model.clusters.map(clusterCard));
    app.replaceChildren(...nodes);
    app.removeAttribute("aria-busy");
    if (focused) cards().find((card) => card.dataset.cluster === focused)?.focus();
  }

  // Over anything but another card the cursor shows "no drop": releasing there keeps the order.
  document.addEventListener("dragover", (event) => {
    if (!dragged || event.defaultPrevented || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
    clearDropMarks();
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type === "model") render(event.data.model);
  });
  vscode.postMessage({ type: "ready" });
})();
