// Renders the model the extension posts (src/jobsTable.ts). No logic, no network:
// every click goes back to the extension as a message.
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  /** What a drag of job rows carries: their row keys as a JSON list. */
  const JOBS_DRAG_MIME = "application/vnd.ctun.jobs";
  /** What a drag of a column header carries: the column's id. */
  const COLUMN_DRAG_MIME = "application/vnd.ctun.column";
  /** Pixels a nesting level indents a band's name and a job's ID. */
  const INDENT_STEP = 16;
  const MIN_COLUMN_WIDTH = 60;
  /** The width Note keeps however narrow the tab gets. */
  const FLEXIBLE_MIN_WIDTH = 160;
  /** The last model, for the drag image, a live column resize and the column menu. */
  let model;
  /** The rows of the last model, for the drag image. */
  let shownRows = [];
  /** While jobs are dragged: the page's scroll position before, and the newest model, rendered once the drag ends. */
  let drag;
  /** While a column divider is dragged: the column, where the drag began and which way widens it. */
  let resize;
  /** Where the column menu is open, in viewport px; undefined while it is closed. */
  let columnMenuAt;
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

  /** 16 px stroke icons, drawn in the text color. */
  const ICON_PATHS = {
    refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5",
    columns: "M2.5 3.5h11v9h-11zM6.2 3.5v9M9.8 3.5v9",
    chevron: "M6 4l4 4-4 4",
    completed: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM5.3 8.2l1.9 1.9 3.6-3.8",
    failed: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4",
    running: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM6.7 5.6v4.8L10.4 8z",
    queued: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 4.8V8l2.2 1.4",
    cancelled: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM3.8 12.2l8.4-8.4",
    other: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z",
  };

  function icon(name, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className ? `icon ${className}` : "icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.append(path);
    return svg;
  }

  /** A button showing only `name`'s icon; it posts `message` when given one. */
  function iconButton(name, label, message) {
    const node = message ? button("icon-button", undefined, message) : el("button", "icon-button");
    node.type = "button";
    node.setAttribute("aria-label", label);
    node.title = label;
    node.append(icon(name));
    return node;
  }

  function select(id, label, options, onChange) {
    const wrapper = el("span", "select-group");
    if (label) {
      const labelNode = el("label", "select-label", label);
      labelNode.htmlFor = id;
      wrapper.append(labelNode);
    }
    const node = el("select", "select");
    node.id = id;
    node.dataset.key = id;
    if (!label) node.setAttribute("aria-label", options.find((option) => option.selected)?.label ?? id);
    for (const option of options) {
      const optionNode = el("option", "", option.label);
      optionNode.value = option.value;
      optionNode.selected = option.selected;
      node.append(optionNode);
    }
    node.addEventListener("change", () => onChange(node.value));
    wrapper.append(node);
    return wrapper;
  }

  /** One row: the title, the state toggles, the window, the cluster, then the review link, the time and the actions. */
  function toolbar(refreshing) {
    const bar = el("div", "toolbar");
    bar.append(el("h1", "", "Cluster jobs"));

    const toggles = el("div", "toggles");
    toggles.setAttribute("role", "group");
    toggles.setAttribute("aria-label", "Which jobs to show");
    for (const toggle of model.toggles) {
      const node = button(`toggle group-${toggle.id}`, "", { type: "toggle", group: toggle.id }, toggle.pressed);
      node.append(el("span", "dot"), el("span", "", toggle.label), el("span", "count", String(toggle.count)));
      toggles.append(node);
    }
    bar.append(toggles, el("span", "separator"));
    bar.append(
      select(
        "since",
        "Ended in",
        model.sinceOptions.map((option) => ({ ...option, selected: option.value === model.since })),
        (since) => vscode.postMessage({ type: "pickSince", since }),
      ),
      select(
        "cluster",
        undefined,
        model.chips.map((chip) => ({ value: chip.id, label: chip.label, selected: chip.pressed })),
        (cluster) => vscode.postMessage({ type: "pickCluster", cluster }),
      ),
    );

    bar.append(el("span", "spacer"));
    if (model.pendingCount > 0) {
      const noun = model.pendingCount === 1 ? "note" : "notes";
      bar.append(button("link-button", `${model.pendingCount} ${noun} to review`, { type: "setMode", mode: "review" }));
    }
    bar.append(el("span", "muted updated", model.updatedText));
    const columns = iconButton("columns", "Columns");
    columns.setAttribute("aria-haspopup", "true");
    columns.setAttribute("aria-expanded", String(columnMenuAt !== undefined));
    columns.addEventListener("click", (event) => {
      event.stopPropagation();
      const box = columns.getBoundingClientRect();
      toggleColumnMenu({ x: box.right, y: box.bottom + 4, alignRight: true });
    });
    const refresh = iconButton("refresh", refreshing ? "Refreshing…" : "Refresh", { type: "refresh" });
    refresh.disabled = refreshing;
    if (refreshing) refresh.classList.add("spinning");
    bar.append(columns, refresh);
    return bar;
  }

  /** The grid's column tracks: px for each column, the rest for Note, or for an empty last track when Note is hidden. */
  function columnTemplate(widthOverride) {
    const tracks = model.columns.map((column) => {
      if (column.width === undefined) return `minmax(${FLEXIBLE_MIN_WIDTH}px, 1fr)`;
      const width = widthOverride && widthOverride.id === column.id ? widthOverride.width : column.width;
      return `${width}px`;
    });
    if (!model.columns.some((column) => column.width === undefined)) tracks.push("minmax(0, 1fr)");
    return tracks.join(" ");
  }

  /** True when no column takes the rest, so an empty track fills the row. */
  function hasSpacer() {
    return !model.columns.some((column) => column.width === undefined);
  }

  const SORT_ARROWS = { ascending: "↑", descending: "↓" };

  /**
   * A column's header: a click sorts by it, its divider drags its width, and the header
   * itself drags to another place. Left of the column that takes the rest, a column's
   * right edge drags; right of it, its left edge, so a drag always pushes against Note.
   */
  function columnHeader(column, index) {
    const header = el("div", "th");
    header.setAttribute("role", "columnheader");
    header.dataset.column = column.id;
    if (column.sort) header.setAttribute("aria-sort", column.sort);
    const sortButton = button("sort-button", column.label, { type: "sort", column: column.id });
    sortButton.append(el("span", "sort-arrow", column.sort ? SORT_ARROWS[column.sort] : ""));
    header.append(sortButton);

    if (column.width !== undefined) {
      const flexibleIndex = model.columns.findIndex((other) => other.width === undefined);
      const isLeftOfFlexible = flexibleIndex === -1 || index < flexibleIndex;
      const handle = el("span", isLeftOfFlexible ? "resize-handle right" : "resize-handle left");
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", `Resize the ${column.label} column`);
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        resize = { id: column.id, x: event.clientX, width: column.width, direction: isLeftOfFlexible ? 1 : -1, current: column.width };
        handle.classList.add("active");
      });
      handle.addEventListener("pointermove", (event) => {
        if (!resize) return;
        resize.current = Math.max(MIN_COLUMN_WIDTH, Math.round(resize.width + resize.direction * (event.clientX - resize.x)));
        app.querySelector(".grid")?.style.setProperty("--columns", columnTemplate({ id: resize.id, width: resize.current }));
      });
      const endResize = () => {
        if (!resize) return;
        const { id, width, current } = resize;
        resize = undefined;
        handle.classList.remove("active");
        if (current !== width) vscode.postMessage({ type: "setColumnWidth", column: id, width: current });
      };
      handle.addEventListener("pointerup", endResize);
      handle.addEventListener("lostpointercapture", endResize);
      // A click on the divider must not sort.
      handle.addEventListener("click", (event) => event.stopPropagation());
      header.append(handle);
    }

    if (!column.pinned) dragColumn(header, column);
    acceptColumnDrops(header, column);
    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      toggleColumnMenu({ x: event.clientX, y: event.clientY, alignRight: false });
    });
    return header;
  }

  function dragColumn(header, column) {
    header.draggable = true;
    header.addEventListener("dragstart", (event) => {
      // A drag that began on a divider resizes; it must not also move the column.
      if (resize) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData(COLUMN_DRAG_MIME, column.id);
      event.dataTransfer.effectAllowed = "move";
      header.classList.add("moving");
    });
    header.addEventListener("dragend", () => header.classList.remove("moving"));
  }

  /** A header takes a dragged column: it moves to where this one is. ID stays first. */
  function acceptColumnDrops(header, column) {
    const carriesColumn = (event) => !column.pinned && event.dataTransfer?.types.includes(COLUMN_DRAG_MIME);
    header.addEventListener("dragover", (event) => {
      if (!carriesColumn(event)) return;
      event.preventDefault();
      const box = header.getBoundingClientRect();
      const isRightHalf = event.clientX > box.left + box.width / 2;
      header.classList.toggle("drop-after", isRightHalf);
      header.classList.toggle("drop-before", !isRightHalf);
    });
    header.addEventListener("dragleave", () => header.classList.remove("drop-before", "drop-after"));
    header.addEventListener("drop", (event) => {
      if (!carriesColumn(event)) return;
      event.preventDefault();
      header.classList.remove("drop-before", "drop-after");
      const moved = event.dataTransfer.getData(COLUMN_DRAG_MIME);
      if (moved && moved !== column.id) vscode.postMessage({ type: "moveColumn", column: moved, target: column.id });
    });
  }

  /** Opens the menu that shows and hides columns at `at`, or closes it when it is open. */
  function toggleColumnMenu(at) {
    columnMenuAt = columnMenuAt ? undefined : at;
    renderColumnMenu();
  }

  function renderColumnMenu() {
    document.querySelector(".column-menu")?.remove();
    app.querySelector('[aria-label="Columns"]')?.setAttribute("aria-expanded", String(columnMenuAt !== undefined));
    if (!columnMenuAt || !model) return;
    const menu = el("div", "column-menu");
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Shown columns");
    menu.style.top = `${columnMenuAt.y}px`;
    if (columnMenuAt.alignRight) menu.style.right = `${window.innerWidth - columnMenuAt.x}px`;
    else menu.style.left = `${columnMenuAt.x}px`;
    menu.append(el("div", "menu-title", "Shown columns"));
    for (const column of model.columnMenu) {
      const item = el("label", column.pinned ? "menu-item pinned" : "menu-item");
      const box = el("input");
      box.type = "checkbox";
      box.checked = column.shown;
      box.disabled = column.pinned;
      box.addEventListener("change", () => vscode.postMessage({ type: "toggleColumn", column: column.id }));
      item.append(box, el("span", "", column.label));
      if (column.pinned) item.append(el("span", "muted", "always"));
      menu.append(item);
    }
    menu.append(el("div", "menu-separator"), button("menu-item menu-button", "Reset columns", { type: "resetColumns" }));
    menu.addEventListener("mousedown", (event) => event.stopPropagation());
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") toggleColumnMenu(undefined);
    });
    document.body.append(menu);
  }

  document.addEventListener("mousedown", () => {
    if (columnMenuAt) toggleColumnMenu(undefined);
  });

  /** A project's band: fold button, name, job count and, for Unassigned, why. Its name is indented by its depth. */
  function projectBand(band) {
    const row = el("div", band.depth === 0 ? "group-row top-level" : "group-row");
    row.setAttribute("role", "row");
    row.style.setProperty("--depth", String(band.depth));
    const fold = button("fold", undefined, { type: "toggleProject", project: band.project });
    fold.append(icon("chevron", "chevron"));
    fold.setAttribute("aria-expanded", String(!band.collapsed));
    fold.setAttribute("aria-label", `${band.collapsed ? "Unfold" : "Fold"} ${band.label}`);
    row.append(fold, el("strong", "", band.label), el("span", "count", String(band.count)));
    if (band.note) row.append(el("span", "muted band-note", band.note));
    acceptJobDrops(row, band.project);
    return row;
  }

  /** A project band takes dragged jobs: they move to its project. */
  function acceptJobDrops(row, project) {
    const carriesJobs = (event) => event.dataTransfer?.types.includes(JOBS_DRAG_MIME);
    row.addEventListener("dragover", (event) => {
      if (!carriesJobs(event)) return;
      event.preventDefault();
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (event) => {
      if (!carriesJobs(event)) return;
      event.preventDefault();
      row.classList.remove("drop-target");
      vscode.postMessage({ type: "dropOnProject", keys: JSON.parse(event.dataTransfer.getData(JOBS_DRAG_MIME)), project });
    });
  }

  /**
   * A selected row drags the whole selection, any other row only itself; shown as a stack of cards under the cursor.
   * While it drags, the table folds into one band per project, so every target is in view.
   */
  function dragJobs(row, jobRowModel) {
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      const selected = jobRowModel.selected ? shownRows.filter((shown) => shown.selected) : [jobRowModel];
      event.dataTransfer.setData(JOBS_DRAG_MIME, JSON.stringify(selected.map((shown) => shown.key)));
      event.dataTransfer.effectAllowed = "move";
      const image = dragImage(selected);
      document.body.append(image);
      event.dataTransfer.setDragImage(image, 16, 16);
      drag = { scrollY: window.scrollY, deferredMessage: undefined };
      // Hiding the dragged row inside dragstart would cancel the drag, so fold just after it.
      setTimeout(() => {
        image.remove();
        app.classList.add("dragging-jobs");
        app.querySelector(".grid")?.scrollIntoView({ block: "start" });
      });
    });
    row.addEventListener("dragend", () => {
      const { scrollY, deferredMessage } = drag;
      drag = undefined;
      app.classList.remove("dragging-jobs");
      if (deferredMessage) render(deferredMessage);
      window.scrollTo(0, scrollY);
    });
  }

  const DRAG_IMAGE_ROWS = 3;

  /** The first jobs as cards, and how many more follow. */
  function dragImage(rows) {
    const stack = el("div", "drag-image");
    for (const row of rows.slice(0, DRAG_IMAGE_ROWS)) {
      const card = el("div", "drag-card");
      card.append(el("span", "mono muted", `${row.cluster} ${row.id}`), " ", el("span", "", row.name));
      stack.append(card);
    }
    if (rows.length > DRAG_IMAGE_ROWS) stack.append(el("div", "drag-more", `+ ${rows.length - DRAG_IMAGE_ROWS} more`));
    return stack;
  }

  /** What a job's row shows in `column`. */
  function jobCell(row, column) {
    const cell = el("span", `cell cell-${column}`);
    cell.setAttribute("role", "cell");
    switch (column) {
      case "id":
        cell.append(el("span", "muted", row.cluster), " ", el("span", "mono", row.id));
        break;
      case "name":
        cell.textContent = row.name;
        cell.title = row.name;
        break;
      case "note":
        if (row.note) {
          cell.textContent = row.note.preview;
          cell.title = row.note.text;
        }
        break;
      case "state":
        cell.classList.add(`group-${row.group ?? "other"}`);
        cell.title = row.state;
        cell.append(icon(row.group ?? "other"), el("span", "", row.stateLabel));
        break;
      case "start":
        if (row.group === "queued") cell.classList.add("muted");
        cell.textContent = row.startText ?? "";
        break;
      case "elapsed":
        cell.append(el("span", "", row.elapsedText), el("span", "muted", ` / ${row.limitText}`));
        if (row.group === "running" && row.progress !== undefined) {
          const track = el("span", "track");
          const fill = el("span", "fill");
          fill.style.width = `${row.progress * 100}%`;
          track.append(fill);
          cell.append(track);
        }
        break;
      case "partition":
        cell.classList.add("muted");
        cell.textContent = row.partitionNodes;
        break;
    }
    return cell;
  }

  /**
   * A job's row. A click or Enter/Space opens or closes its details; Ctrl-click (Cmd on
   * macOS) and Shift-click select rows. A row drags itself, or the selection if it is in
   * it. A right-click opens VS Code's context menu for the row.
   */
  function jobRow(row, depth) {
    const node = el("div", ["job", row.expanded && "expanded", row.selected && "selected"].filter(Boolean).join(" "));
    node.setAttribute("role", "row");
    node.style.setProperty("--depth", String(depth));
    node.dataset.rowKey = row.key;
    node.dataset.vscodeContext = JSON.stringify({ webviewSection: "job", jobKey: row.key, preventDefaultContextMenuItems: true });
    node.tabIndex = 0;
    node.setAttribute("aria-expanded", String(row.expanded));
    node.setAttribute("aria-selected", String(row.selected));
    dragJobs(node, row);
    const toggle = () => vscode.postMessage({ type: "expand", key: row.key });
    // A Shift-click would otherwise select the text between the two clicks.
    node.addEventListener("mousedown", (event) => {
      if (event.shiftKey) event.preventDefault();
    });
    node.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) vscode.postMessage({ type: "select", key: row.key, extend: "toggle" });
      else if (event.shiftKey) vscode.postMessage({ type: "select", key: row.key, extend: "range" });
      else if (!window.getSelection()?.toString()) toggle();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    for (const column of model.columns) node.append(jobCell(row, column.id));
    if (hasSpacer()) node.append(el("span", "cell"));
    return node;
  }

  /** A row across the whole table, for notices and the empty state. */
  function fullWidthRow(className, ...children) {
    const row = el("div", `full-row ${className}`);
    row.setAttribute("role", "row");
    row.append(...children);
    return row;
  }

  function reviewButtons(key) {
    const actions = el("div", "review-actions");
    actions.append(
      button("primary", "Confirm", { type: "review", key, action: "confirm" }),
      button("link-button", "Edit", { type: "review", key, action: "edit" }),
      button("link-button", "Discard", { type: "review", key, action: "discard" }),
    );
    return actions;
  }

  /** Opens the user's directions that agents follow when they write notes. */
  function customizeNoteWritingButton() {
    const node = button("link-button", "Customize note writing…", { type: "customizeNoteWriting" });
    node.title = "Your own directions for the agents' notes, kept when the skill updates";
    return node;
  }

  function detailItem(list, term, ...content) {
    const dd = el("dd");
    dd.append(...content);
    list.append(el("dt", "", term), dd);
  }

  function noteDetail(key, note) {
    const wrapper = el("div", "note-detail");
    wrapper.append(el("p", "note-text", note.text));
    if (note.status === "unreviewed") {
      const actions = reviewButtons(key);
      actions.prepend(el("span", "muted draft-label", "Draft by the agent"));
      actions.append(customizeNoteWritingButton());
      wrapper.append(actions);
    } else {
      const actions = el("div", "review-actions");
      actions.append(el("span", "muted draft-label", note.statusLabel), button("link-button", "Edit", { type: "review", key, action: "edit" }));
      wrapper.append(actions);
    }
    return wrapper;
  }

  /** One add-on line: its text, a link to open and a command that helps. */
  function addOnDetail(line) {
    const node = el("span", line.muted ? "muted" : "");
    node.append(el("span", line.muted ? "" : "mono", line.text));
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
    line.append(el("span", "muted", ` · ${code.workdir}, at submit time`));
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

  /**
   * A job's details: an inset panel on the table's own grid, so each label sits under the
   * job's ID and each value starts where the second column does.
   */
  function detailsRow(row, depth) {
    const details = row.details;
    const node = el("div", "details-row");
    node.setAttribute("role", "row");
    node.style.setProperty("--depth", String(depth));
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
      for (const edit of details.edits) edits.append(el("li", "", edit));
      detailItem(list, "Edits", edits);
    }
    node.append(list);
    return node;
  }

  /** What to do with the Ctrl/Shift-selected rows; absent while none is selected. */
  function selectionBar() {
    const bar = el("div", "selection-bar");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Selected jobs");
    bar.append(
      el("span", "", `${model.selectedCount} selected`),
      button("primary", "Move to project…", { type: "moveToProject" }),
      button("link-button", "Clear", { type: "clearSelection" }),
    );
    return bar;
  }

  function table() {
    const wrapper = el("div", "table-wrapper");
    if (model.selectedCount > 0) wrapper.append(selectionBar());
    const grid = el("div", "grid");
    grid.setAttribute("role", "table");
    grid.setAttribute("aria-label", "Cluster jobs");
    grid.style.setProperty("--columns", columnTemplate());

    const head = el("div", "header-row");
    head.setAttribute("role", "row");
    model.columns.forEach((column, index) => head.append(columnHeader(column, index)));
    if (hasSpacer()) head.append(el("span", "th"));

    const body = el("div", "job-rows");
    body.setAttribute("role", "rowgroup");
    for (const band of model.groups) {
      body.append(projectBand(band));
      for (const row of band.rows) {
        body.append(jobRow(row, band.depth));
        if (row.details) body.append(detailsRow(row, band.depth));
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

    grid.append(head, body, dropTargets());
    wrapper.append(grid);
    return wrapper;
  }

  /** One folded band per project, shown in place of the job rows while jobs are dragged. */
  function dropTargets() {
    const body = el("div", "drop-targets");
    body.setAttribute("role", "rowgroup");
    for (const target of model.dropTargets) {
      const row = el("div", target.depth === 0 ? "group-row top-level" : "group-row");
      row.setAttribute("role", "row");
      row.style.setProperty("--depth", String(target.depth));
      row.append(icon("chevron", "chevron"), el("strong", "", target.label));
      acceptJobDrops(row, target.project);
      body.append(row);
    }
    return body;
  }

  function reviewView() {
    const section = el("section", "review");
    const top = el("div", "review-top");
    top.append(
      button("link-button", "← All jobs", { type: "setMode", mode: "jobs" }),
      el("p", "muted", "The agent's notes wait here until you confirm, edit or discard them. Facts from git, Slurm and W&B need no review. Your choice is saved in the job's record on the cluster."),
      customizeNoteWritingButton(),
    );
    section.append(top);
    if (model.reviewCards.length === 0) {
      section.append(el("p", "empty-text", "Nothing to review."));
      return section;
    }
    for (const card of model.reviewCards) {
      const article = el("article", "review-card");
      const heading = el("div", "review-heading");
      heading.append(el("strong", "", card.name), " ", el("span", "muted", card.stateLabel));
      article.append(
        heading,
        el("div", "muted small", [`Job ${card.id} on ${card.cluster}`, `project ${card.project}`, card.submittedText && `submitted ${card.submittedText}`].filter(Boolean).join(" · ")),
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
    // A re-render would replace the dragged row, and its dragend would never come.
    if (drag) drag.deferredMessage = message;
    else render(message);
  });

  function render(message) {
    model = message.model;
    shownRows = model.groups.flatMap((band) => band.rows);
    const focusedKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
    app.style.setProperty("--indent-step", `${INDENT_STEP}px`);
    app.replaceChildren(toolbar(message.refreshing));
    if (message.error) app.append(el("p", "notice error", `ctun failed: ${message.error}`));
    app.append(model.mode === "review" ? reviewView() : table());
    app.setAttribute("aria-busy", String(message.refreshing));
    renderColumnMenu();
    restoreFocus(focusedKey);
    scrollToRevealed(message.reveal);
  }

  /** Scrolls to the row another tab asked for, once; waits for a later model while the row is not there yet. */
  function scrollToRevealed(reveal) {
    if (!reveal || reveal.serial === revealedSerial) return;
    const row = [...app.querySelectorAll(".job")].find((node) => node.dataset.rowKey === reveal.key);
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
