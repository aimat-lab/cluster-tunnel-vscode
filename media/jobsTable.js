// Renders the model the extension posts (src/jobsTable.ts). No logic, no network:
// every click goes back to the extension as a message.
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const COLUMN_COUNT = 6;
  /** JOBS_DRAG_MIME in src/projectsView.ts: the Projects view accepts drops of this type. */
  const JOBS_DRAG_MIME = "application/vnd.ctun.jobs";
  /** The rows of the last model, for the drag image. */
  let shownRows = [];
  /** Row keys whose commit list is open; kept here so a re-render does not close it. */
  const openCommitLists = new Set();
  /** The serial of the last reveal request the table scrolled to. */
  let revealedSerial = 0;

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

  /** A project's band: fold button, name, job count and, for Unassigned, why. Indented by its depth. */
  function projectBand(band) {
    const title = el("span", "band-title");
    const fold = button("fold", undefined, { type: "toggleProject", project: band.project });
    fold.append(el("span", "chevron"));
    fold.setAttribute("aria-expanded", String(!band.collapsed));
    fold.setAttribute("aria-label", `${band.collapsed ? "Unfold" : "Fold"} ${band.label}`);
    title.append(fold, el("strong", "", band.label), el("span", "count", String(band.count)));
    if (band.note) title.append(el("span", "muted", band.note));
    const tr = fullWidthRow(band.depth === 0 ? "group-row top-level" : "group-row", title);
    tr.style.setProperty("--depth", String(band.depth));
    acceptJobDrops(tr, band.project);
    return tr;
  }

  /** A project band takes dragged jobs: they move to its project. */
  function acceptJobDrops(tr, project) {
    const carriesJobs = (event) => event.dataTransfer?.types.includes(JOBS_DRAG_MIME);
    tr.addEventListener("dragover", (event) => {
      if (!carriesJobs(event)) return;
      event.preventDefault();
      tr.classList.add("drop-target");
    });
    tr.addEventListener("dragleave", () => tr.classList.remove("drop-target"));
    tr.addEventListener("drop", (event) => {
      if (!carriesJobs(event)) return;
      event.preventDefault();
      tr.classList.remove("drop-target");
      vscode.postMessage({ type: "dropOnProject", keys: JSON.parse(event.dataTransfer.getData(JOBS_DRAG_MIME)), project });
    });
  }

  /** A selected row drags the whole selection, shown as a stack of cards under the cursor. */
  function dragSelection(tr) {
    tr.draggable = true;
    tr.addEventListener("dragstart", (event) => {
      const selected = shownRows.filter((row) => row.selected);
      const keys = JSON.stringify(selected.map((row) => row.key));
      event.dataTransfer.setData(JOBS_DRAG_MIME, keys);
      event.dataTransfer.setData("text/plain", keys);
      event.dataTransfer.effectAllowed = "move";
      const image = dragImage(selected);
      document.body.append(image);
      event.dataTransfer.setDragImage(image, 16, 16);
      setTimeout(() => image.remove());
    });
  }

  const DRAG_IMAGE_ROWS = 3;

  /** The first jobs as cards, and how many more follow. */
  function dragImage(rows) {
    const stack = el("div", "drag-image");
    for (const row of rows.slice(0, DRAG_IMAGE_ROWS)) {
      const card = el("div", "drag-card");
      card.append(el("span", "mono muted", `${row.cluster} · ${row.id}`), " ", el("span", "mono", row.name));
      stack.append(card);
    }
    if (rows.length > DRAG_IMAGE_ROWS) stack.append(el("div", "drag-more", `+ ${rows.length - DRAG_IMAGE_ROWS} more`));
    return stack;
  }

  /**
   * A job's row. A click or Enter/Space opens or closes its details, unless the click
   * selected text; Ctrl-click (Cmd on macOS) and Shift-click select rows, and a selected
   * row drags the selection. A right-click opens VS Code's context menu for the row.
   */
  function jobRow(row, depth) {
    const tr = el("tr", ["job", row.expanded && "expanded", row.selected && "selected"].filter(Boolean).join(" "));
    tr.style.setProperty("--depth", String(depth));
    tr.dataset.rowKey = row.key;
    tr.dataset.vscodeContext = JSON.stringify({ webviewSection: "job", jobKey: row.key, preventDefaultContextMenuItems: true });
    tr.tabIndex = 0;
    tr.setAttribute("aria-expanded", String(row.expanded));
    tr.setAttribute("aria-selected", String(row.selected));
    tr.title = row.expanded ? "Hide details" : "Show details";
    if (row.selected) dragSelection(tr);
    const toggle = () => vscode.postMessage({ type: "expand", key: row.key });
    // A Shift-click would otherwise select the text between the two clicks.
    tr.addEventListener("mousedown", (event) => {
      if (event.shiftKey) event.preventDefault();
    });
    tr.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) vscode.postMessage({ type: "select", key: row.key, extend: "toggle" });
      else if (event.shiftKey) vscode.postMessage({ type: "select", key: row.key, extend: "range" });
      else if (!window.getSelection()?.toString()) toggle();
    });
    tr.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });

    const idCell = el("td");
    idCell.append(el("div", "", row.cluster), el("div", "mono muted", row.id));

    const nameCell = el("td", "name-cell");
    const name = el("div", "mono name", row.name);
    name.title = row.name;
    nameCell.append(name);
    if (row.note) {
      const note = el("div", "note-preview");
      note.append(row.note.preview);
      nameCell.append(note);
    }

    const stateCell = el("td");
    stateCell.append(stateBadge(row.group, row.stateLabel, row.state));

    const timeCell = el("td");
    timeCell.append(el("div", "mono small elapsed", row.timeText));
    if (row.progress !== undefined) {
      const track = el("div", "track");
      const fill = el("div", row.active ? "fill active" : "fill");
      fill.style.width = `${row.progress * 100}%`;
      track.append(fill);
      timeCell.append(track);
    }

    const startCell = el("td", row.group === "queued" ? "small muted" : "small", row.startText ?? "");

    tr.append(idCell, nameCell, stateCell, startCell, timeCell, el("td", "mono small muted", row.partitionNodes));
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

  function reviewButtons(key) {
    const actions = el("div", "review-actions");
    actions.append(
      button("primary", "Confirm", { type: "review", key, action: "confirm" }),
      button("secondary", "Edit", { type: "review", key, action: "edit" }),
      button("secondary", "Discard", { type: "review", key, action: "discard" }),
    );
    return actions;
  }

  function detailItem(list, term, ...content) {
    const dd = el("dd");
    dd.append(...content);
    list.append(el("dt", "", term), dd);
  }

  function noteDetail(key, note) {
    const box = el("div", `note-box status-${note.status}`);
    box.append(el("div", "note-status", note.statusLabel), el("p", "note-text", note.text));
    if (note.status === "unreviewed") box.append(reviewButtons(key));
    else box.append(button("link-button", "Edit", { type: "review", key, action: "edit" }));
    return box;
  }

  /** One add-on line: its text, a link to open and a command that helps. */
  function addOnDetail(line) {
    const node = el("span", line.muted ? "muted" : "");
    node.append(el("span", line.muted ? "" : "mono small", line.text));
    if (line.link) node.append(" ", button("link-button", `${line.link.label} ↗`, { type: "openUrl", url: line.link.url }));
    if (line.help) node.append(" ", button("link-button", line.help.label, { type: "runCommand", command: line.help.command }));
    return node;
  }

  function addOnDetails(list, addOnLines) {
    if (addOnLines?.state === "loading") {
      for (const label of addOnLines.labels) detailItem(list, label, el("span", "muted", "Loading…"));
    } else if (addOnLines?.state === "loaded") {
      for (const line of addOnLines.lines) detailItem(list, line.label, addOnDetail(line));
    }
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
    } else if (!details.hasFacts) {
      detailItem(list, "Record", el("span", "muted", "Made by ctun jobs edit: no commit or submit time."));
    }
    if (row.note) detailItem(list, "Note", noteDetail(row.key, row.note));
    if (details.code) detailItem(list, "Code", codeDetail(details.code));
    if (details.from) detailItem(list, "From", details.from);
    if (details.previous) detailItem(list, "Changes", changesDetail(row, details));
    addOnDetails(list, details.addOnLines);
    if (details.edits.length) {
      const edits = el("ul", "edits");
      for (const edit of details.edits) edits.append(el("li", "small", edit));
      detailItem(list, "Edits", edits);
    }
    return fullWidthRow("details-row", list);
  }

  const SORT_ARROWS = { ascending: "↑", descending: "↓" };

  /** A column header whose button sorts by it; `aria-sort` tells screen readers the order. */
  function columnHeader(column) {
    const th = el("th");
    if (column.sort) th.setAttribute("aria-sort", column.sort);
    const sortButton = button("sort-button", column.label, { type: "sort", column: column.id });
    sortButton.append(el("span", "sort-arrow", column.sort ? SORT_ARROWS[column.sort] : ""));
    th.append(sortButton);
    return th;
  }

  /** What to do with the Ctrl/Shift-selected rows; absent while none is selected. */
  function selectionBar(model) {
    const bar = el("div", "selection-bar");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Selected jobs");
    bar.append(
      el("span", "", `${model.selectedCount} selected`),
      button("primary", "Move to project…", { type: "moveToProject" }),
      button("secondary", "Clear", { type: "clearSelection" }),
    );
    return bar;
  }

  function table(model) {
    const wrapper = el("div", "table-wrapper");
    if (model.selectedCount > 0) wrapper.append(selectionBar(model));
    const tableNode = el("table");
    tableNode.setAttribute("aria-label", "Cluster jobs");
    const head = el("thead");
    const headRow = el("tr");
    for (const column of model.columns) headRow.append(columnHeader(column));
    head.append(headRow);

    const body = el("tbody");
    for (const band of model.groups) {
      body.append(projectBand(band));
      for (const row of band.rows) {
        body.append(jobRow(row, band.depth));
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
      el("p", "muted", "The agent's notes wait here until you confirm, edit or discard them. Facts from git, Slurm and W&B need no review. Your choice is saved in the job's record on the cluster."),
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
        el("div", "muted small", [`Job ${card.id} on ${card.cluster}`, `project ${card.project}`, card.submittedText && `submitted ${card.submittedText}`].filter(Boolean).join(" · ")),
        el("div", "note-status", "Unreviewed · agent draft"),
        el("p", "note-text", card.note),
      );
      if (card.references.length) {
        const refs = el("ul", "references");
        for (const reference of card.references) {
          const item = el("li", "");
          item.append(el("span", "check", "✓"), " ", el("span", "mono", reference), el("span", "muted", " checked by ctun"));
          refs.append(item);
        }
        article.append(refs);
      }
      const actions = reviewButtons(card.rowKey);
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
    shownRows = model.groups.flatMap((band) => band.rows);
    const focusedKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
    app.replaceChildren(header(model, message.refreshing), filters(model));
    if (message.error) app.append(el("p", "notice error", `ctun failed: ${message.error}`));
    app.append(model.mode === "review" ? reviewView(model) : table(model));
    app.setAttribute("aria-busy", String(message.refreshing));
    restoreFocus(focusedKey);
    scrollToRevealed(message.reveal);
  });

  /** Scrolls to the row another tab asked for, once; waits for a later model while the row is not there yet. */
  function scrollToRevealed(reveal) {
    if (!reveal || reveal.serial === revealedSerial) return;
    const row = [...app.querySelectorAll("tr.job")].find((node) => node.dataset.rowKey === reveal.key);
    if (!row) return;
    revealedSerial = reveal.serial;
    row.scrollIntoView({ block: "center" });
  }

  /** Re-rendering replaces the controls; put the focus back on the one that had it. */
  function restoreFocus(key) {
    if (!key) return;
    const match = [...app.querySelectorAll("[data-key]")].find((node) => node.dataset.key === key);
    match?.focus();
  }

  vscode.postMessage({ type: "ready" });
})();
