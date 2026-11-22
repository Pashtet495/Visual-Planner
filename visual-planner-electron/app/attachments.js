// ============================================================
// Visual Planner - attachments (Electron)
// - paperclip in the block popup (gear) and in the right panel
// - add / edit / delete attachment links (name, path, comment)
// - open with the system application (like Explorer double-click)
// - internal viewer (formats supported by Chromium) in a modal
// - drag&drop files from Explorer:
//     * onto a block  -> attachment modal with comment
//     * onto empty area -> new note with the file attached
// ============================================================
(function () {
  "use strict";

  const native = window.vpNative;
  if (!native) {
    console.warn("vpNative bridge not available - attachments disabled");
    return;
  }

  // ---------- constants / helpers ----------
  const INTERNAL_VIEW_EXT = new Set([
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
    "txt", "log", "md", "csv", "json", "xml", "js", "css", "html", "htm",
    "mp4", "m4v", "webm", "ogv", "mov",
    "mp3", "wav", "ogg", "oga", "flac", "m4a", "opus",
  ]);

  function basename(p) {
    if (!p) return "";
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || String(p);
  }

  function extOf(p) {
    const b = basename(p);
    const i = b.lastIndexOf(".");
    return i >= 0 ? b.slice(i + 1).toLowerCase() : "";
  }

  function canViewInternal(p) {
    return INTERNAL_VIEW_EXT.has(extOf(p));
  }

  function genAttId() {
    return "att_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Shared registry of workspace file paths (filled by electron-integration.js)
  const workspaceFilePaths = (window.vpWorkspacePaths = window.vpWorkspacePaths || {});

  let pendingDroppedPath = null; // path of a workspace JSON dropped onto empty area
  let dragHighlightEl = null;

  function clearDragHighlight() {
    if (dragHighlightEl) {
      dragHighlightEl.classList.remove("attachment-drop-target");
      dragHighlightEl = null;
    }
  }

  function refreshAfterAttachmentsChange(node) {
    if (typeof markUnsaved === "function") markUnsaved();
    if (typeof saveState === "function") saveState();
    if (typeof renderGraph === "function") renderGraph();
    if (typeof updatePanel === "function") updatePanel();
    if (
      typeof notePopupTarget !== "undefined" &&
      notePopupTarget &&
      notePopupTarget.id === node.id &&
      typeof showNotePopup === "function"
    ) {
      showNotePopup(node);
    }
    if (state.interfaceMode === "kanban" && typeof renderKanban === "function") {
      renderKanban();
    }
  }

  // ============================================================
  // Actions
  // ============================================================

  async function openAttachmentExternal(att) {
    const check = await native.fileExists(att.path);
    if (!check.exists) {
      if (typeof showToast === "function") showToast("Файл не найден: " + att.path, 4000);
      return;
    }
    const res = await native.openExternal(att.path);
    if (!res.ok) {
      if (typeof showToast === "function") showToast("Не удалось открыть файл: " + res.error, 4000);
    }
  }

  function revealAttachmentInFolder(att) {
    native.revealInFolder(att.path);
  }

  // ---------- Internal viewer modal ----------
  function openViewer(node, att) {
    native.fileExists(att.path).then((check) => {
      if (!check.exists) {
        if (typeof showToast === "function") showToast("Файл не найден: " + att.path, 4000);
        return;
      }
      buildViewerModal(att);
    });
  }

  function buildViewerModal(att) {
    const overlay = document.createElement("div");
    overlay.className = "vp-overlay vp-viewer-overlay";

    const modal = document.createElement("div");
    modal.className = "vp-viewer-modal";

    // Header
    const header = document.createElement("div");
    header.className = "vp-viewer-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "vp-viewer-title-wrap";
    const titleEl = document.createElement("div");
    titleEl.className = "vp-viewer-title";
    titleEl.textContent = att.name || basename(att.path);
    const pathEl = document.createElement("div");
    pathEl.className = "vp-viewer-path";
    pathEl.textContent = att.path;
    pathEl.title = att.path;
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(pathEl);
    header.appendChild(titleWrap);

    const closeX = document.createElement("button");
    closeX.className = "vp-viewer-close";
    closeX.textContent = "✕";
    closeX.title = "Закрыть просмотр";
    header.appendChild(closeX);
    modal.appendChild(header);

    // Content (iframe via custom protocol)
    const frame = document.createElement("iframe");
    frame.className = "vp-viewer-frame";
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.src = "vpfile://local/?path=" + encodeURIComponent(att.path);
    modal.appendChild(frame);

    // Footer buttons
    const footer = document.createElement("div");
    footer.className = "vp-viewer-footer";

    const btnExternal = document.createElement("button");
    btnExternal.className = "vp-btn";
    btnExternal.textContent = "Открыть во внешнем приложении";
    btnExternal.onclick = () => openAttachmentExternal(att);

    const btnReveal = document.createElement("button");
    btnReveal.className = "vp-btn vp-btn-secondary";
    btnReveal.textContent = "Показать в папке";
    btnReveal.onclick = () => revealAttachmentInFolder(att);

    const btnClose = document.createElement("button");
    btnClose.className = "vp-btn vp-btn-secondary";
    btnClose.textContent = "Закрыть";
    btnClose.onclick = () => overlay.remove();

    footer.appendChild(btnExternal);
    footer.appendChild(btnReveal);
    footer.appendChild(btnClose);
    modal.appendChild(footer);

    overlay.appendChild(modal);

    const close = () => overlay.remove();
    closeX.onclick = close;
    btnClose.onclick = close;
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    // capture Escape globally while the viewer is open
    const escHandler = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", escHandler, true);
    const mo = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        document.removeEventListener("keydown", escHandler, true);
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    document.body.appendChild(overlay);
  }

  // ---------- Edit / remove ----------
  function editAttachment(node, att) {
    window.openAttachmentModal(node, att);
  }

  function removeAttachment(node, att) {
    const ok = window.confirm(
      'Удалить вложение "' + (att.name || basename(att.path)) + '"?\n(сам файл на диске не удаляется)'
    );
    if (!ok) return;
    const idx = node.attachments.indexOf(att);
    if (idx >= 0) node.attachments.splice(idx, 1);
    refreshAfterAttachmentsChange(node);
  }

  // ============================================================
  // Attachment row (used in panel and in the block popup)
  // ============================================================
  function buildAttachmentRow(node, att) {
    const row = document.createElement("div");
    row.className = "vp-att-row";

    const nameLink = document.createElement("span");
    nameLink.className = "vp-att-name";
    nameLink.textContent = att.name || basename(att.path);
    nameLink.title = att.path + (att.comment ? "\n\n" + att.comment : "");
    nameLink.onclick = (e) => {
      e.stopPropagation();
      openAttachmentExternal(att);
    };
    row.appendChild(nameLink);

    if (att.comment) {
      const commentEl = document.createElement("div");
      commentEl.className = "vp-att-comment";
      commentEl.textContent = att.comment;
      commentEl.title = att.comment;
      row.appendChild(commentEl);
    }

    const btns = document.createElement("div");
    btns.className = "vp-att-btns";

    if (canViewInternal(att.path)) {
      const viewBtn = document.createElement("button");
      viewBtn.className = "vp-att-btn";
      viewBtn.textContent = "👁";
      viewBtn.title = "Открыть во встроенном просмотрщике";
      viewBtn.onmousedown = (e) => e.stopPropagation();
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        openViewer(node, att);
      };
      btns.appendChild(viewBtn);
    }

    const editBtn = document.createElement("button");
    editBtn.className = "vp-att-btn";
    editBtn.textContent = "✎";
    editBtn.title = "Редактировать описание и путь";
    editBtn.onmousedown = (e) => e.stopPropagation();
    editBtn.onclick = (e) => {
      e.stopPropagation();
      editAttachment(node, att);
    };
    btns.appendChild(editBtn);

    const folderBtn = document.createElement("button");
    folderBtn.className = "vp-att-btn";
    folderBtn.textContent = "📂";
    folderBtn.title = "Показать файл в папке (Проводник)";
    folderBtn.onmousedown = (e) => e.stopPropagation();
    folderBtn.onclick = (e) => {
      e.stopPropagation();
      revealAttachmentInFolder(att);
    };
    btns.appendChild(folderBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "vp-att-btn vp-att-btn-danger";
    delBtn.textContent = "✕";
    delBtn.title = "Удалить вложение";
    delBtn.onmousedown = (e) => e.stopPropagation();
    delBtn.onclick = (e) => {
      e.stopPropagation();
      removeAttachment(node, att);
    };
    btns.appendChild(delBtn);

    row.appendChild(btns);
    return row;
  }

  // ============================================================
  // Sections: gear popup + right properties panel
  // ============================================================

  // Section inside the popup attached to a block (gear button)
  window.renderAttachmentsSection = function (node, container) {
    if (!node || !container) return;
    const label = document.createElement("div");
    label.className = "np-section-label";
    label.innerHTML = "<span>Вложения</span>";
    container.appendChild(label);

    if (!node.attachments) node.attachments = [];
    if (node.attachments.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vp-att-empty";
      empty.textContent = "Вложений пока нет";
      container.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "vp-att-list";
      node.attachments.forEach((att) => list.appendChild(buildAttachmentRow(node, att)));
      container.appendChild(list);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "note-popup-add-todo vp-att-add-btn";
    addBtn.textContent = "📎 Вложение";
    addBtn.style.marginLeft = "0";
    addBtn.style.marginTop = "6px";
    addBtn.onmousedown = (e) => e.stopPropagation();
    addBtn.onclick = (e) => {
      e.stopPropagation();
      window.openAttachmentModal(node, null);
    };
    container.appendChild(addBtn);
  };

  // Right properties panel section
  window.renderPanelAttachments = function (node) {
    const section = document.getElementById("prop-attachments-section");
    const list = document.getElementById("prop-attachments-list");
    if (!section || !list) return;
    if (!node) {
      section.style.display = "none";
      list.innerHTML = "";
      return;
    }
    section.style.display = "";
    if (!node.attachments) node.attachments = [];
    list.innerHTML = "";
    if (node.attachments.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vp-att-empty";
      empty.textContent = "Вложений пока нет";
      list.appendChild(empty);
    } else {
      node.attachments.forEach((att) => list.appendChild(buildAttachmentRow(node, att)));
    }
  };

  // Button in the right panel
  window.openAttachmentModalFromPanel = function () {
    if (typeof selectedNodes === "undefined" || selectedNodes.length !== 1) return;
    const node = getNodeById(selectedNodes[0]);
    if (node) window.openAttachmentModal(node, null);
  };

  // ============================================================
  // Add / edit modal
  // ============================================================
  window.openAttachmentModal = async function (node, attachment, dropInfo) {
    if (!node) return;
    const isEdit = !!(attachment && attachment.id);
    const initialPath = (attachment && attachment.path) || (dropInfo && dropInfo.path) || "";
    const initialName =
      (attachment && attachment.name) ||
      (dropInfo && dropInfo.name) ||
      basename(initialPath);
    const initialComment = (attachment && attachment.comment) || "";

    const overlay = document.createElement("div");
    overlay.className = "vp-overlay vp-attach-overlay";

    const modal = document.createElement("div");
    modal.className = "vp-attach-modal";

    const header = document.createElement("div");
    header.className = "vp-attach-header";
    header.textContent = isEdit
      ? "Редактировать вложение"
      : dropInfo
        ? "Прикрепить файл к блоку"
        : "Добавить вложение";
    modal.appendChild(header);

    if (dropInfo && dropInfo.fromDrop) {
      const hint = document.createElement("div");
      hint.className = "vp-attach-hint";
      hint.textContent =
        'Файл "' + (dropInfo.name || basename(dropInfo.path || "")) + '" будет прикреплён к блоку "' +
        node.name +
        '". Вы можете задать название ссылки и комментарий.';
      modal.appendChild(hint);
    }

    // --- Name ---
    const nameField = document.createElement("div");
    nameField.className = "vp-attach-field";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Название документа:";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "vp-attach-input";
    nameInput.value = initialName || "";
    nameInput.placeholder = "Название, отображаемое в свойствах блока";
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    modal.appendChild(nameField);

    // --- Path ---
    const pathField = document.createElement("div");
    pathField.className = "vp-attach-field";
    const pathLabel = document.createElement("label");
    pathLabel.textContent = "Полный путь к файлу:";
    const pathRow = document.createElement("div");
    pathRow.className = "vp-attach-path-row";
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.className = "vp-attach-input";
    pathInput.value = initialPath || "";
    pathInput.placeholder = "C:\\Documents\\file.pdf";
    pathInput.title = "Полный путь к файлу на диске";
    const browseBtn = document.createElement("button");
    browseBtn.className = "vp-btn vp-btn-secondary";
    browseBtn.textContent = "Выбрать файл...";
    browseBtn.onclick = async () => {
      const res = await native.pickFile({ title: "Выбор файла вложения" });
      if (res.ok && res.path) {
        pathInput.value = res.path;
        if (!nameInput.value.trim() || nameInput.value === initialName) {
          nameInput.value = res.name;
        }
      }
    };
    pathRow.appendChild(pathInput);
    pathRow.appendChild(browseBtn);
    pathField.appendChild(pathLabel);
    pathField.appendChild(pathRow);
    modal.appendChild(pathField);

    // --- Comment ---
    const commentField = document.createElement("div");
    commentField.className = "vp-attach-field";
    const commentLabel = document.createElement("label");
    commentLabel.textContent = "Комментарий (необязательно):";
    const commentInput = document.createElement("textarea");
    commentInput.className = "vp-attach-input vp-attach-comment";
    commentInput.rows = 3;
    commentInput.value = initialComment;
    commentInput.placeholder = "Комментарий к ссылке";
    commentField.appendChild(commentLabel);
    commentField.appendChild(commentInput);
    modal.appendChild(commentField);

    // --- Footer ---
    const footer = document.createElement("div");
    footer.className = "vp-attach-footer";

    const btnCancel = document.createElement("button");
    btnCancel.className = "vp-btn vp-btn-secondary";
    btnCancel.textContent = "Отмена";
    btnCancel.onclick = () => overlay.remove();

    const btnOk = document.createElement("button");
    btnOk.className = "vp-btn vp-btn-primary";
    btnOk.textContent = isEdit ? "Сохранить" : "Добавить";
    btnOk.onclick = () => {
      const path = pathInput.value.trim();
      if (!path) {
        pathInput.classList.add("vp-input-error");
        pathInput.focus();
        return;
      }
      const name = nameInput.value.trim() || basename(path);
      const comment = commentInput.value;

      if (isEdit) {
        attachment.name = name;
        attachment.path = path;
        attachment.comment = comment;
      } else {
        if (!node.attachments) node.attachments = [];
        node.attachments.push({
          id: genAttId(),
          name: name,
          path: path,
          comment: comment,
          addedAt: new Date().toISOString(),
        });
      }
      overlay.remove();
      refreshAfterAttachmentsChange(node);
    };

    footer.appendChild(btnOk);
    footer.appendChild(btnCancel);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Escape closes
    const escHandler = (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", escHandler, true);
      }
    };
    document.addEventListener("keydown", escHandler, true);

    // Focus
    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 30);
  };

  // ============================================================
  // Drag & drop from Explorer
  // ============================================================

  function createNoteWithAttachment(filePath, fileName, e) {
    if (typeof ws !== "function" || typeof createDefaultNode !== "function") return;
    const w = ws();
    if (!w) return;
    const pos = getGraphPos(e);
    const node = createDefaultNode("note", 0, 0, false);
    node.id = "n" + w.nextId++;
    node.name = fileName;
    node.w = 180;
    node.h = 110;
    node.x = pos.x - node.w / 2;
    node.y = pos.y - node.h / 2;
    node.attachments = [
      {
        id: genAttId(),
        name: fileName,
        path: filePath,
        comment: "",
        addedAt: new Date().toISOString(),
      },
    ];
    w.nodes.push(node);
    if (typeof markUnsaved === "function") markUnsaved();
    if (typeof saveState === "function") saveState();
    if (typeof renderGraph === "function") renderGraph();
    if (typeof renderGantt === "function") renderGantt();
    if (typeof showToast === "function") showToast("Создана заметка с вложением: " + fileName);
  }

  window.vpHandleFileDrop = async function (e, files) {
    clearDragHighlight();
    const file = files && files[0];
    if (!file) return;
    const filePath = native.pathForFile(file);

    // What is under the cursor?
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl =
      target && target.closest
        ? target.closest(".node-group[data-node-id], .kanban-card[data-node-id]")
        : null;

    if (nodeEl) {
      const nodeId = nodeEl.getAttribute("data-node-id");
      const node = getNodeById(nodeId);
      if (node) {
        if (!filePath) {
          if (typeof showToast === "function") {
            showToast("Не удалось получить путь к файлу", 4000);
          }
          return;
        }
        // Modal: name + comment for the attachment link
        window.openAttachmentModal(node, null, {
          path: filePath,
          name: file.name,
          fromDrop: true,
        });
        return;
      }
    }

    // Empty area
    if (file.name && /\.json$/i.test(file.name) && filePath) {
      // Workspace JSON: keep the original "import as workspace / subgraph" flow
      try {
        const res = await native.readTextFile(filePath);
        if (!res.ok) {
          window.alert("Ошибка чтения JSON: " + res.error);
          return;
        }
        const data = JSON.parse(res.content);
        if (!data || !data.nodes) {
          window.alert("Неверный формат JSON: нет nodes");
          return;
        }
        pendingDroppedPath = filePath;
        if (typeof droppedJsonData !== "undefined") {
          droppedJsonData = data;
          droppedFileName = res.name.replace(/\.json$/i, "");
          const dz = document.getElementById("drop-zone-modal");
          if (dz) dz.classList.add("active");
        }
      } catch (err) {
        window.alert("Ошибка чтения JSON: " + err.message);
      }
      return;
    }

    if (!filePath) {
      if (typeof showToast === "function") showToast("Не удалось получить путь к файлу", 4000);
      return;
    }

    createNoteWithAttachment(filePath, file.name, e);
  };

  // After "Открыть как новое рабочее пространство" from a dropped JSON file,
  // remember the source file path so Ctrl+S updates that same file.
  const dzOpenBtn = document.getElementById("dz-btn-open");
  if (dzOpenBtn && typeof droppedJsonData !== "undefined") {
    const origDzOpen = dzOpenBtn.onclick;
    dzOpenBtn.onclick = function (ev) {
      origDzOpen && origDzOpen.call(this, ev);
      if (pendingDroppedPath) {
        const w = ws();
        if (w) {
          workspaceFilePaths[w.wsId] = pendingDroppedPath;
          if (typeof workspaceFileHandles !== "undefined") {
            workspaceFileHandles[w.wsId] = { name: basename(pendingDroppedPath), path: pendingDroppedPath };
          }
          if (typeof renderTabs === "function") renderTabs();
        }
        pendingDroppedPath = null;
      }
    };
  }

  // ---------- Visual highlight of the drop target ----------
  document.addEventListener(
    "dragover",
    (e) => {
      try {
        const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
        if (!types.includes("Files")) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const nodeEl =
          el && el.closest
            ? el.closest(".node-group[data-node-id], .kanban-card[data-node-id]")
            : null;
        if (nodeEl !== dragHighlightEl) {
          clearDragHighlight();
          dragHighlightEl = nodeEl;
          if (dragHighlightEl) dragHighlightEl.classList.add("attachment-drop-target");
        }
      } catch (err) {
        /* ignore */
      }
    },
    true
  );

  document.addEventListener("dragleave", (e) => {
    if (
      !e.relatedTarget ||
      e.clientX <= 0 ||
      e.clientY <= 0 ||
      e.clientX >= window.innerWidth ||
      e.clientY >= window.innerHeight
    ) {
      clearDragHighlight();
    }
  });

  document.addEventListener("drop", () => clearDragHighlight(), true);
  document.addEventListener("dragend", () => clearDragHighlight(), true);
})();
