// Renders the model the extension posts (src/jobsTable.ts). No logic, no network:
// every click goes back to the extension as a message.
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const COLUMN_COUNT = 6;
  /** Row keys whose commit list is open; kept here so a re-render does not close it. */
  const openCommitLists = new Set();

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
      el(
        "p",
        "subtitle",
        `From squeue and sacct over each open tunnel, with the job records ctun keeps on the cluster. ${model.updatedText}`,
      ),
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
    const right = el("div", "chips");
    right.append(
      select(
        "project",
        "Project",
        model.projects.map((project) => ({
          value: project.id,
          label: `${project.label} (${project.count})`,
          selected: project.selected,
        })),
        (project) => vscode.postMessage({ type: "pickProject", project }),
      ),
    );
    const review = button(
      model.pendingCount > 0 ? "review-button pending" : "review-button",
      `To review · ${model.pendingCount}`,
      { type: "setMode", mode: "review" },
    );
    right.append(review);
    bar.append(chips, right);
    return bar;
  }

  function stateBadge(group, label, title) {
    const badge = el("span", `badge group-${group ?? "other"}`);
    if (title) badge.title = title;
    badge.append(el("span", "dot"), label);
    return badge;
  }

  function jobRow(row) {
    const tr = el("tr", row.expanded ? "job expanded" : "job");

    const idCell = el("td");
    idCell.append(el("div", "", row.cluster), el("div", "mono muted", row.id));

    const nameCell = el("td", "name-cell");
    const name = el("div", "mono name", row.name);
    name.title = row.name;
    nameCell.append(name);
    if (row.note && row.note.status !== "discarded") {
      const note = el("div", "note-preview");
      if (row.note.status === "unreviewed") note.append(el("span", "tag", "unreviewed"), " ");
      note.append(row.note.preview);
      nameCell.append(note);
    }

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

    const actionCell = el("td", "actions");
    const expand = button("icon-button", row.expanded ? "Hide" : "Details", { type: "expand", key: row.key });
    expand.setAttribute("aria-expanded", String(row.expanded));
    expand.setAttribute("aria-label", `${row.expanded ? "Hide" : "Show"} details of job ${row.id}`);
    actionCell.append(expand);

    tr.append(idCell, nameCell, stateCell, timeCell, el("td", "mono small muted", row.partitionNodes), actionCell);
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

  function reviewButtons(reviewKey) {
    const actions = el("div", "review-actions");
    actions.append(
      button("primary", "Confirm", { type: "review", reviewKey, action: "confirm" }),
      button("secondary", "Edit", { type: "review", reviewKey, action: "edit" }),
      button("secondary", "Discard", { type: "review", reviewKey, action: "discard" }),
    );
    return actions;
  }

  function detailItem(list, term, ...content) {
    const dd = el("dd");
    dd.append(...content);
    list.append(el("dt", "", term), dd);
  }

  function noteDetail(note) {
    const box = el("div", `note-box status-${note.status}`);
    box.append(el("div", "note-status", note.statusLabel));
    if (note.status !== "discarded") box.append(el("p", "note-text", note.text));
    if (note.status === "unreviewed") box.append(reviewButtons(note.reviewKey));
    else if (note.status !== "discarded") box.append(button("link-button", "Edit", { type: "review", reviewKey: note.reviewKey, action: "edit" }));
    return box;
  }

  function trainingDetail(training) {
    if (!training || training.state === "loading") return el("span", "muted", "Looking up the W&B run…");
    if (training.state === "unavailable") return el("span", "muted", training.text);
    const line = el("span", "");
    line.append(el("span", "mono small", training.text), " ");
    line.append(button("link-button", "W&B ↗", { type: "openUrl", url: training.url }));
    return line;
  }

  function codeDetail(code) {
    const line = el("span", "");
    line.append(el("span", "mono", code.commit), ` on ${code.branch} · `);
    if (code.pushed === false) line.append(el("span", "warning", "not on remote"));
    else line.append(code.pushed ? "pushed" : "push state unknown");
    if (code.uncommitted) line.append(" · ", el("span", "warning", `${code.uncommitted} uncommitted files`));
    line.append(el("div", "muted small", `As of submit time, in ${code.workdir}.`));
    return line;
  }

  function changesDetail(row, details) {
    const previous = details.previous;
    const wrapper = el("div", "");
    wrapper.append(el("div", "", `Previous run: job ${previous.id} on ${previous.cluster} (${previous.stateLabel}).`));
    if (previous.sameCommit) {
      wrapper.append(el("div", "muted", "Same commit as the previous run."));
      return wrapper;
    }
    const changes = details.changes;
    if (!changes && details.changesRequest) {
      wrapper.append(button("link-button", `Show commits since job ${previous.id}`, { type: "loadChanges", key: row.key }));
    } else if (changes?.state === "loading") {
      wrapper.append(el("div", "muted", "Running git log on the cluster…"));
    } else if (changes?.state === "error") {
      wrapper.append(el("div", "error", changes.text));
    } else if (changes?.state === "loaded") {
      const disclosure = el("details", "commits");
      disclosure.open = openCommitLists.has(row.key);
      disclosure.addEventListener("toggle", () => {
        if (disclosure.open) openCommitLists.add(row.key);
        else openCommitLists.delete(row.key);
      });
      disclosure.append(el("summary", "", `${changes.commits.length} commits since job ${previous.id}`));
      const list = el("ol", "commit-list");
      for (const commit of changes.commits) {
        const item = el("li", "");
        item.append(el("span", "mono", commit.hash), ` ${commit.message}`);
        list.append(item);
      }
      disclosure.append(list);
      wrapper.append(disclosure);
    }
    return wrapper;
  }

  function detailsRow(row) {
    const details = row.details;
    const list = el("dl", "details");
    if (!details.hasRecord) {
      detailItem(list, "Record", el("span", "muted", "No job record: submitted without ctun run, or before records existed."));
    }
    if (row.note) detailItem(list, "Note", noteDetail(row.note));
    detailItem(list, "Training", trainingDetail(details.training));
    if (details.code) detailItem(list, "Code", codeDetail(details.code));
    if (details.from) detailItem(list, "From", details.from);
    if (details.previous) detailItem(list, "Changes", changesDetail(row, details));
    return fullWidthRow("details-row", list);
  }

  function table(model) {
    const wrapper = el("div", "table-wrapper");
    const tableNode = el("table");
    tableNode.setAttribute("aria-label", "Cluster jobs");
    const head = el("thead");
    const headRow = el("tr");
    for (const title of ["Cluster · ID", "Job · why it runs", "State", "Elapsed / limit", "Partition · nodes", ""]) {
      headRow.append(el("th", "", title));
    }
    head.append(headRow);

    const body = el("tbody");
    for (const group of model.groups) {
      const title = el("span", "");
      title.append(el("strong", "", group.label), " ", el("span", "muted", group.subtitle));
      body.append(fullWidthRow("group-row", title));
      for (const row of group.rows) {
        body.append(jobRow(row));
        if (row.details) body.append(detailsRow(row));
      }
    }
    if (model.showEmpty) body.append(fullWidthRow("empty", el("span", "", "No jobs match these filters.")));
    for (const error of model.errors) {
      body.append(fullWidthRow("notice error", el("span", "", `${error.cluster}: ${error.message}`)));
    }
    for (const locked of model.lockedClusters) {
      const text = el("span", "");
      text.append(el("strong", "", locked.cluster), " has no tunnel. Its jobs are not shown.");
      const action = locked.loggingIn
        ? el("span", "muted", "Waiting for the login…")
        : button("primary", `Log in to ${locked.cluster}`, { type: "login", cluster: locked.cluster });
      body.append(fullWidthRow("notice", text, action));
    }

    tableNode.append(head, body);
    wrapper.append(tableNode);
    return wrapper;
  }

  function reviewView(model) {
    const section = el("section", "review");
    const top = el("div", "review-top");
    top.append(
      button("secondary", "Back to all jobs", { type: "setMode", mode: "jobs" }),
      el("p", "muted", "The agent's notes wait here until you confirm, edit or discard them. Facts from git, Slurm and W&B need no review."),
    );
    section.append(top);
    if (model.reviewCards.length === 0) {
      section.append(el("p", "empty-text", "Nothing to review."));
      return section;
    }
    for (const card of model.reviewCards) {
      const article = el("article", "review-card");
      const heading = el("div", "review-heading");
      heading.append(el("strong", "mono", card.name), " ", el("span", "muted", card.stateLabel));
      article.append(
        heading,
        el("div", "muted small", `Job ${card.id} on ${card.cluster} · project ${card.project} · submitted ${card.submittedText}`),
        el("div", "note-status", "Unreviewed · agent draft"),
        el("p", "note-text", card.note),
      );
      if (card.references.length) {
        const refs = el("ul", "references");
        for (const reference of card.references) {
          const item = el("li", "");
          item.append(el("span", "check", "✓"), " ", el("span", "mono", reference), el("span", "muted", " checked by ctun at submit"));
          refs.append(item);
        }
        article.append(refs);
      }
      const actions = reviewButtons(card.reviewKey);
      actions.append(button("link-button", "Show job", { type: "showJob", key: card.rowKey }));
      article.append(actions);
      section.append(article);
    }
    return section;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "model") return;
    const model = message.model;
    const focusedKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
    app.replaceChildren(header(model, message.refreshing), filters(model));
    if (message.error) app.append(el("p", "notice error", `ctun failed: ${message.error}`));
    app.append(model.mode === "review" ? reviewView(model) : table(model));
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
