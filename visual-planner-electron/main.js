// ============================================================
// Visual Planner - Electron main process
// ============================================================
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { Readable } = require("stream");

// ---------- Custom protocol for viewing attachments inside the app ----------
// The renderer loads files through  vpfile://local/?path=<encoded absolute path>
protocol.registerSchemesAsPrivileged([
  {
    scheme: "vpfile",
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

// ---------- MIME types viewable inside Chromium ----------
const MIME_MAP = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/plain",
  ".csv": "text/plain",
  ".json": "application/json",
  ".xml": "text/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".opus": "audio/ogg",
};

let mainWindow = null;

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1150,
    minHeight: 640,
    show: false,
    title: "Visual Planner",
    autoHideMenuBar: true,
    backgroundColor: "#16213e",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true, // built-in PDF viewer
      spellcheck: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "app", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Keep our own title
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

  // Open external links in the system browser, never spawn child windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------- Application menu (no Ctrl+S/Ctrl+Shift+S accelerators:
// the renderer already handles them) ----------
function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Workspace...",
          accelerator: "CmdOrCtrl+O",
          click: () => sendToWindow("vp:menu", "open-workspace"),
        },
        { type: "separator" },
        {
          label: "Save Workspace",
          click: () => sendToWindow("vp:menu", "save-workspace"),
        },
        {
          label: "Save Workspace As...",
          click: () => sendToWindow("vp:menu", "save-workspace-as"),
        },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
    { role: "editMenu", label: "Edit" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools", accelerator: "F12" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============================================================
// IPC handlers
// ============================================================

// Save workspace to a chosen file
ipcMain.handle("workspace:save", async (event, { content, suggestedName, defaultPath }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: "Save workspace",
    defaultPath: defaultPath || suggestedName || "workspace.json",
    filters: [{ name: "Visual Planner workspace (*.json)", extensions: ["json"] }],
  };
  if (win) {
    var result = await dialog.showSaveDialog(win, options);
  } else {
    var result = await dialog.showSaveDialog(options);
  }
  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }
  try {
    await fsp.writeFile(result.filePath, content, "utf8");
    return {
      ok: true,
      canceled: false,
      path: result.filePath,
      name: path.basename(result.filePath),
    };
  } catch (err) {
    return { ok: false, canceled: false, error: err.message };
  }
});

// Open workspace from a chosen file
ipcMain.handle("workspace:open", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: "Open workspace",
    properties: ["openFile"],
    filters: [
      { name: "Visual Planner workspace (*.json)", extensions: ["json"] },
      { name: "All files (*.*)", extensions: ["*"] },
    ],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  try {
    const content = await fsp.readFile(filePath, "utf8");
    return {
      ok: true,
      canceled: false,
      content,
      path: filePath,
      name: path.basename(filePath),
    };
  } catch (err) {
    return { ok: false, canceled: false, error: err.message };
  }
});

// Direct write (used for repeated "Save" to an already known path)
ipcMain.handle("fs:write-text", async (event, { filePath, content }) => {
  try {
    await fsp.writeFile(filePath, content, "utf8");
    return { ok: true, name: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Read a text file (used when a JSON workspace is dropped onto the app)
ipcMain.handle("fs:read-text", async (event, { filePath }) => {
  try {
    const content = await fsp.readFile(filePath, "utf8");
    return { ok: true, content, name: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// File picker for attachments
ipcMain.handle("dialog:pick-file", async (event, { title } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: title || "Select attachment file",
    properties: ["openFile"],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  return {
    ok: true,
    canceled: false,
    path: result.filePaths[0],
    name: path.basename(result.filePaths[0]),
  };
});

// Open file with the system default application (same as double-click in Explorer)
ipcMain.handle("shell:open-path", async (event, filePath) => {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      return { ok: false, error: "Path is not a file" };
    }
  } catch (err) {
    return { ok: false, error: "File not found" };
  }
  const error = await shell.openPath(filePath);
  if (error) return { ok: false, error };
  return { ok: true };
});

// Show the file in Windows Explorer
ipcMain.handle("shell:reveal-in-folder", async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Check that a file exists
ipcMain.handle("fs:exists", async (event, filePath) => {
  try {
    const stat = await fsp.stat(filePath);
    return { ok: true, exists: stat.isFile(), size: stat.size };
  } catch (err) {
    return { ok: true, exists: false, size: 0 };
  }
});

// ============================================================
// vpfile:// protocol - serves local files for the internal viewer
// ============================================================
function registerAttachmentProtocol() {
  protocol.handle("vpfile", async (request) => {
    try {
      const u = new URL(request.url);
      const filePath = u.searchParams.get("path");
      if (!filePath) {
        return new Response("Bad request: missing path", { status: 400 });
      }
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch (err) {
        return new Response("File not found", { status: 404 });
      }
      if (!stat.isFile()) {
        return new Response("Not a file", { status: 404 });
      }
      const mime = MIME_MAP[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      const rangeHeader = request.headers.get("range");
      if (rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= stat.size) end = stat.size - 1;
        if (start > end) start = 0;
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(end - start + 1),
            "Cache-Control": "no-store",
          },
        });
      }
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(stat.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  });
}

// ============================================================
// App lifecycle
// ============================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAttachmentProtocol();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
