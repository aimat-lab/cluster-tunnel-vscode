// Renders the model the extension posts (src/jobsTable.ts). No logic, no network:
// every click goes back to the extension as a message.
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const COLUMN_COUNT = 5;

  /** Creates an element with a class and text; text never goes through innerHTML. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, message, pressed) {
    const node = el("button", className, text);
    node.type = "button";
    node.dataset.key = JSON.stringify(message);
    if (pressed !== undefined) node.setAttribute("aria-pressed", String(pressed));
    node.addEventListener("click", () => vscode.postMessage(message));
    return node;
  }

  function select(id, label, options, onChange) {
    const wrapper = el("span", "select-group");
    const labelNode = el("label", "select-label", label);
    labelNode.htmlFor = id;
    const node = el("select", "select");
    node.id = id;
    node.dataset.key = id;
    for (const option of options) {
      const optionNode = el("option", "", option.label);
      optionNode.value = option.value;
      optionNode.selected = option.selected;
      node.append(optionNode);
    }
    node.addEventListener("change", () => onChange(node.value));
    wrapper.append(labelNode, node);
    return wrapper;
  }

  function header(model, refreshing) {
    const bar = el("div", "header");
    const titles = el("div");
    titles.append(
      el("h1", "", "Cluster jobs"),
      el("p", "subtitle", `From squeue and sacct over each open tunnel (ctun jobs --json). ${model.updatedText}`),
    );

    const controls = el("div", "controls");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Which jobs to show");
    for (const toggle of model.toggles) {
      const node = button("toggle", "", { type: "toggle", group: toggle.id }, toggle.pressed);
      node.append(el("span", `dot group-${toggle.id}`), `${toggle.label} · ${toggle.count}`);
      controls.append(node);
    }
    controls.append(
      select(
        "since",
        "Ended in",
        model.sinceOptions.map((option) => ({ ...option, selected: option.value === model.since })),
        (since) => vscode.postMessage({ type: "pickSince", since }),
      ),
    );
    const refresh = button("secondary", refreshing ? "Refreshing…" : "Refresh", { type: "refresh" });
    refresh.disabled = refreshing;
    controls.append(refresh);

    bar.append(titles, controls);
    return bar;
  }

  function filters(model) {
    const bar = el("div", "filters");
    const chips = el("div", "chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Filter by cluster");
    for (const chip of model.chips) {
      chips.append(button("chip", chip.label, { type: "pickCluster", cluster: chip.id }, chip.pressed));
    }
    bar.append(chips);
    return bar;
  }

  function stateBadge(group, label, title) {
    const badge = el("span", `badge group-${group ?? "other"}`);
    if (title) badge.title = title;
    badge.append(el("span", "dot"), label);
    return badge;
  }

  function jobRow(row) {
    const tr = el("tr", "job");

    const idCell = el("td");
    idCell.append(el("div", "", row.cluster), el("div", "mono muted", row.id));

    const nameCell = el("td", "name-cell");
    const name = el("div", "mono name", row.name);
    name.title = row.name;
    nameCell.append(name);

    const stateCell = el("td");
    stateCell.append(stateBadge(row.group, row.stateLabel, row.state));

    const timeCell = el("td");
    timeCell.append(el("div", "mono small", row.timeText));
    if (row.progress !== undefined) {
      const track = el("div", "track");
      const fill = el("div", row.active ? "fill active" : "fill");
      fill.style.width = `${row.progress * 100}%`;
      track.append(fill);
      timeCell.append(track);
    }

    tr.append(idCell, nameCell, stateCell, timeCell, el("td", "mono small muted", row.partitionNodes));
    return tr;
  }

  function fullWidthRow(className, ...children) {
    const tr = el("tr", className);
    const td = el("td");
    td.colSpan = COLUMN_COUNT;
    const content = el("div", "row-content");
    content.append(...children);
    td.append(content);
    tr.append(td);
    return tr;
  }

  function table(model) {
    const wrapper = el("div", "table-wrapper");
    const tableNode = el("table");
    tableNode.setAttribute("aria-label", "Cluster jobs");
    const head = el("thead");
    const headRow = el("tr");
    for (const title of ["Cluster · ID", "Job", "State", "Elapsed / limit", "Partition · nodes"]) {
      headRow.append(el("th", "", title));
    }
    head.append(headRow);

    const body = el("tbody");
    for (const row of model.rows) body.append(jobRow(row));
    if (model.showEmpty) body.append(fullWidthRow("empty", el("span", "", "No jobs match these filters.")));
    for (const error of model.errors) {
      body.append(fullWidthRow("notice error", el("span", "", `${error.cluster}: ${error.message}`)));
    }
    for (const locked of model.lockedClusters) {
      const text = el("span", "");
      text.append(el("strong", "", locked.cluster), " has no tunnel. Its jobs are not shown.");
      const action = locked.loggingIn
        ? el("span", "muted", "Waiting for the ctun login window…")
        : button("primary", `Log in to ${locked.cluster}`, { type: "login", cluster: locked.cluster });
      body.append(fullWidthRow("notice", text, action));
    }

    tableNode.append(head, body);
    wrapper.append(tableNode);
    return wrapper;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "model") return;
    const model = message.model;
    const focusedKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
    app.replaceChildren(header(model, message.refreshing), filters(model));
    if (message.error) app.append(el("p", "notice error", `ctun failed: ${message.error}`));
    app.append(table(model));
    app.setAttribute("aria-busy", String(message.refreshing));
    restoreFocus(focusedKey);
  });

  /** Re-rendering replaces the controls; put the focus back on the one that had it. */
  function restoreFocus(key) {
    if (!key) return;
    const match = [...app.querySelectorAll("[data-key]")].find((node) => node.dataset.key === key);
    match?.focus();
  }

  vscode.postMessage({ type: "ready" });
})();
