// ============================================================
// Visual Planner - Electron native integration
// Replaces the browser "crutches" (File System Access API,
// Blob downloads, hidden <input type="file">) with normal
// desktop file dialogs and direct disk access via the main process.
// ============================================================
(function () {
  "use strict";

  const native = window.vpNative;
  if (!native) {
    console.warn("vpNative bridge not available - Electron integration disabled");
    return;
  }

  // ---------- Workspace file registry (wsId -> absolute path) ----------
  // Shared with attachments.js via window.vpWorkspacePaths.
  const workspaceFilePaths = (window.vpWorkspacePaths = window.vpWorkspacePaths || {});
  // Keep the original handle registry working: the tab bar shows a folder
  // icon based on workspaceFileHandles, so we put lightweight stubs there.
  // (It is a const object from app.js - its contents are mutable.)

  function basename(p) {
    if (!p) return "";
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  function sanitizeWsName(name) {
    return String(name || "workspace")
      .replace(/[^\wа-яА-ЯёЁ\s_-]/g, "")
      .trim() || "workspace";
  }

  function markSaved(w) {
    w.unsaved = false;
    renderTabs();
    saveState();
  }

  // ---------- Inline application styles for SVG export ----------
  // In the original single-file HTML the whole CSS lived in a <style> block,
  // and the SVG export embedded it into the standalone file. In the Electron
  // port the CSS moved to external files, so we inject their content as a
  // <style> element again - getSvgString() picks it up during export.
  (function injectExportStyles() {
    try {
      if (!document.getElementById("vp-inline-export-styles")) {
        native
          .readAppCss()
          .then((res) => {
            if (res && res.ok && res.css && res.css.trim()) {
              const style = document.createElement("style");
              style.id = "vp-inline-export-styles";
              style.textContent = res.css;
              document.head.appendChild(style);
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      /* non-critical */
    }
  })();

  // ---------- Save workspace ----------
  window.saveWorkspaceToDisk = async function (forceSaveAs) {
    const w = ws();
    if (!w) return;
    const dataStr = getWorkspaceExportData(w);
    const knownPath = workspaceFilePaths[w.wsId];

    // Repeated save into the same file - no dialog
    if (knownPath && !forceSaveAs) {
      const res = await native.writeTextFile(knownPath, dataStr);
      if (res.ok) {
        markSaved(w);
        showToast("Сохранено: " + res.name);
      } else {
        showToast("Ошибка сохранения: " + res.error);
      }
      return;
    }

    const suggestedName = sanitizeWsName(w.name) + ".json";
    const res = await native.saveWorkspace(dataStr, suggestedName, knownPath);
    if (res.canceled) return;
    if (res.ok) {
      workspaceFilePaths[w.wsId] = res.path;
      workspaceFileHandles[w.wsId] = { name: res.name, path: res.path };
      markSaved(w);
      showToast("Сохранено: " + res.name);
    } else {
      showToast("Ошибка сохранения: " + (res.error || "неизвестная ошибка"));
    }
  };

  // ---------- Open workspace ----------
  window.openWorkspaceFromDisk = async function () {
    const res = await native.openWorkspace();
    if (res.canceled || !res.ok) {
      if (!res.ok && !res.canceled && res.error) {
        showToast("Ошибка открытия: " + res.error);
      }
      return;
    }
    try {
      const data = JSON.parse(res.content);
      if (!data || !data.nodes) {
        showToast("Неверный формат JSON: нет nodes");
        return;
      }
      importWorkspaceData(data, res.name.replace(/\.json$/i, ""));
      const newWs = state.workspaces[state.activeWsIndex];
      if (newWs) {
        workspaceFilePaths[newWs.wsId] = res.path;
        workspaceFileHandles[newWs.wsId] = { name: res.name, path: res.path };
      }
      renderTabs();
      showToast("Открыто: " + res.name);
    } catch (err) {
      showToast("Ошибка чтения JSON: " + err.message);
    }
  };

  // ---------- Legacy "download" export routed to the native dialog ----------
  window.exportWorkspaceToFile = function () {
    return saveWorkspaceToDisk(true);
  };

  // ---------- "Save As" button becomes available ----------
  const btnSaveAs = document.getElementById("btn-save-as-ws");
  if (btnSaveAs) {
    btnSaveAs.style.display = "";
    btnSaveAs.onclick = () => saveWorkspaceToDisk(true);
  }

  // ---------- Application menu actions (Ctrl+O, File menu) ----------
  native.onMenuAction((action) => {
    if (action === "open-workspace") {
      openWorkspaceFromDisk();
    } else if (action === "save-workspace") {
      saveWorkspaceToDisk(false);
    } else if (action === "save-workspace-as") {
      saveWorkspaceToDisk(true);
    }
  });

  // ---------- Remember file path when a workspace JSON is dropped in ----------
  const _origImportWorkspaceData = window.importWorkspaceData;
  window.importWorkspaceData = function (data, name, sourcePath) {
    _origImportWorkspaceData(data, name);
    if (sourcePath) {
      const newWs = state.workspaces[state.activeWsIndex];
      if (newWs) {
        workspaceFilePaths[newWs.wsId] = sourcePath;
        workspaceFileHandles[newWs.wsId] = { name: basename(sourcePath), path: sourcePath };
        renderTabs();
      }
    }
  };
})();
