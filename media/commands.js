// Renders the model the extension posts (src/commandsTranscript.ts). No logic, no network:
// every click goes back to the extension as a message.
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  /** How close to the end, in px, still counts as reading the newest command. */
  const BOTTOM_SLACK = 24;
  let rendered = false;

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
    node.dataset.key = JSON.stringify(message);
    node.addEventListener("click", () => vscode.postMessage(message));
    return node;
  }

  function toolbar(model, refreshing) {
    const bar = el("div", "toolbar");
    const left = el("div", "group");
    const label = el("label", "muted", "Cluster");
    label.htmlFor = "cluster";
    const select = el("select", "select");
    select.id = "cluster";
    select.dataset.key = "cluster";
    for (const option of model.clusterOptions) {
      const node = el("option", "", option.id);
      node.value = option.id;
      node.selected = option.selected;
      select.append(node);
    }
    select.addEventListener("change", () => vscode.postMessage({ type: "pickCluster", cluster: select.value }));
    left.append(label, select, el("span", "muted", model.countsText));

    const right = el("div", "group");
    const refresh = button("secondary", refreshing ? "Refreshing…" : "Refresh", { type: "refresh" });
    refresh.disabled = refreshing;
    right.append(button("secondary", "Copy all", { type: "copyAll" }), refresh);
    bar.append(left, right);
    return bar;
  }

  function gapDivider(text) {
    const divider = el("div", "gap");
    divider.append(el("span", "rule"), text, el("span", "rule"));
    return divider;
  }

  function commandLine(line) {
    const node = el("div", "line");
    node.append(el("span", "time", line.timeText), el("span", "prompt", "$"), el("span", "command", line.command));
    return node;
  }

  function jobBubble(job) {
    const bubble = el("span", "bubble");
    bubble.append(el("span", "muted", job.verb));
    if (job.key) {
      const link = button("link-button", job.id, { type: "showJob", key: job.key });
      link.title = "Show this job in Cluster jobs";
      bubble.append(link);
    } else {
      bubble.append(el("span", "", job.id));
    }
    if (job.name) bubble.append(el("span", "name", job.name));
    const state = el("span", `state group-${job.group ?? "unknown"}`);
    if (job.group) state.append(el("span", "dot"));
    state.append(el("span", "label", job.stateLabel));
    bubble.append(state);
    if (job.detail) bubble.append(el("span", "muted", job.detail));
    return bubble;
  }

  function transcript(model) {
    const section = el("section", "transcript");
    section.setAttribute("aria-label", `Commands sent to ${model.cluster}`);
    const log = el("div", "log");
    for (const line of model.lines) {
      if (line.gapText) log.append(gapDivider(line.gapText));
      log.append(commandLine(line));
      if (line.jobs.length) {
        const jobs = el("div", "jobs");
        jobs.append(...line.jobs.map(jobBubble));
        log.append(jobs);
      }
    }
    section.append(el("div", "header", model.headerText), log);
    if (model.emptyText) section.append(el("p", "muted", model.emptyText));
    return section;
  }

  function isAtBottom() {
    return window.innerHeight + window.scrollY >= document.body.scrollHeight - BOTTOM_SLACK;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "model") return;
    const followNewest = !rendered || isAtBottom();
    const focusedKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
    app.replaceChildren(toolbar(message.model, message.refreshing));
    if (message.error) app.append(el("p", "error", `ctun failed: ${message.error}`));
    app.append(transcript(message.model));
    app.setAttribute("aria-busy", String(message.refreshing));
    restoreFocus(focusedKey);
    if (followNewest) window.scrollTo(0, document.body.scrollHeight);
    rendered = true;
  });

  /** Re-rendering replaces the controls; put the focus back on the one that had it. */
  function restoreFocus(key) {
    if (!key) return;
    const match = [...app.querySelectorAll("[data-key]")].find((node) => node.dataset.key === key);
    match?.focus();
  }

  vscode.postMessage({ type: "ready" });
})();
