// ============================================================
// Visual Planner - preload script (bridge between renderer and main)
// ============================================================
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vpNative", {
  // ---- Workspace files ----
  saveWorkspace: (content, suggestedName, defaultPath) =>
    ipcRenderer.invoke("workspace:save", { content, suggestedName, defaultPath }),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  writeTextFile: (filePath, content) =>
    ipcRenderer.invoke("fs:write-text", { filePath, content }),
  readTextFile: (filePath) => ipcRenderer.invoke("fs:read-text", { filePath }),

  // ---- Attachments ----
  pickFile: (opts) => ipcRenderer.invoke("dialog:pick-file", opts || {}),
  openExternal: (filePath) => ipcRenderer.invoke("shell:open-path", filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke("shell:reveal-in-folder", filePath),
  fileExists: (filePath) => ipcRenderer.invoke("fs:exists", filePath),

  // ---- Image export (PNG / SVG) via the native save dialog ----
  // data: SVG text (encoding "utf8") or base64 string (encoding "base64")
  saveImage: (data, suggestedName, encoding) =>
    ipcRenderer.invoke("image:save", { data, suggestedName, encoding: encoding || "utf8" }),

  // Combined application CSS (styles.css + attachments.css) for SVG export
  readAppCss: () => ipcRenderer.invoke("app:read-css"),

  // Resolve the real absolute path of a File object dropped from Explorer
  pathForFile: (file) => {
    try {
      const p = webUtils.getPathForFile(file);
      return p || null;
    } catch (err) {
      try {
        return file.path || null; // fallback for older Electron
      } catch (e2) {
        return null;
      }
    }
  },

  // ---- Menu events from main process ----
  onMenuAction: (callback) => {
    ipcRenderer.on("vp:menu", (_event, action) => callback(action));
  },
});
