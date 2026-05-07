const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseEpg } = require("./epg");
const { parsePlaylist } = require("./playlist");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_INDEX_PATH = path.join(__dirname, "..", "dist", "renderer", "index.html");
const REMOTE_PLAYLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EPG_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const ICONS_DIR = path.join(__dirname, "..", "build", "icons");

function getAppIconPath() {
  if (process.platform === "darwin") {
    return path.join(ICONS_DIR, "icon.icns");
  }

  if (process.platform === "win32") {
    return path.join(ICONS_DIR, "icon.ico");
  }

  return path.join(ICONS_DIR, "icon.png");
}

const WINDOW_OPTIONS = {
  width: 1480,
  height: 920,
  minWidth: 1180,
  minHeight: 720,
  backgroundColor: "#0b1120",
  icon: getAppIconPath(),
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: false
  }
};

function createWindow() {
  const window = new BrowserWindow(WINDOW_OPTIONS);

  if (VITE_DEV_SERVER_URL) {
    window.loadURL(VITE_DEV_SERVER_URL);
    return;
  }

  window.loadFile(RENDERER_INDEX_PATH);
}

function getRemoteTextCachePath(kind, source, extension = "txt") {
  const cacheKey = crypto.createHash("sha256").update(source).digest("hex");
  return path.join(app.getPath("userData"), `${kind}-cache`, `${cacheKey}.${extension}`);
}

async function readRemoteTextCache(kind, source, ttlMs, extension) {
  const cachePath = getRemoteTextCachePath(kind, source, extension);

  try {
    const stats = await fs.stat(cachePath);
    return {
      cachePath,
      rawText: await fs.readFile(cachePath, "utf8"),
      isFresh: Date.now() - stats.mtimeMs < ttlMs
    };
  } catch {
    return null;
  }
}

async function writeRemoteTextCache(kind, source, rawText, extension) {
  const cachePath = getRemoteTextCachePath(kind, source, extension);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, rawText, "utf8");
}

async function fetchRemoteText(source) {
  const response = await fetch(source, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/136.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Playlist alinamadi (${response.status} ${response.statusText})`);
  }

  return response.text();
}

async function readPlaylistSource(source) {
  const normalizedSource = String(source || "").trim();

  if (!normalizedSource) {
    throw new Error("Playlist adresi bos birakilamaz.");
  }

  if (/^https?:\/\//i.test(normalizedSource)) {
    const cachedPlaylist = await readRemoteTextCache("playlist", normalizedSource, REMOTE_PLAYLIST_CACHE_TTL_MS, "m3u");

    if (cachedPlaylist?.isFresh) {
      return {
        source: normalizedSource,
        rawPlaylist: cachedPlaylist.rawText
      };
    }

    try {
      const rawPlaylist = await fetchRemoteText(normalizedSource);
      await writeRemoteTextCache("playlist", normalizedSource, rawPlaylist, "m3u");

      return {
        source: normalizedSource,
        rawPlaylist
      };
    } catch (error) {
      if (cachedPlaylist) {
        console.warn(`Playlist uzaktan alinamadi, cache kullaniliyor: ${error.message}`);
        return {
          source: normalizedSource,
          rawPlaylist: cachedPlaylist.rawText
        };
      }

      throw error;
    }
  }

  if (normalizedSource.startsWith("file://")) {
    const filePath = new URL(normalizedSource);
    return {
      source: normalizedSource,
      rawPlaylist: await fs.readFile(filePath, "utf8")
    };
  }

  return {
    source: normalizedSource,
    rawPlaylist: await fs.readFile(normalizedSource, "utf8")
  };
}

async function readEpgSource(source) {
  const normalizedSource = String(source || "").trim();

  if (!normalizedSource) {
    throw new Error("EPG adresi bos birakilamaz.");
  }

  if (/^https?:\/\//i.test(normalizedSource)) {
    const cachedEpg = await readRemoteTextCache("epg", normalizedSource, EPG_CACHE_TTL_MS, "xml");

    if (cachedEpg?.isFresh) {
      return {
        source: normalizedSource,
        rawEpg: cachedEpg.rawText
      };
    }

    try {
      const rawEpg = await fetchRemoteText(normalizedSource);
      await writeRemoteTextCache("epg", normalizedSource, rawEpg, "xml");

      return {
        source: normalizedSource,
        rawEpg
      };
    } catch (error) {
      if (cachedEpg) {
        console.warn(`EPG uzaktan alinamadi, cache kullaniliyor: ${error.message}`);
        return {
          source: normalizedSource,
          rawEpg: cachedEpg.rawText
        };
      }

      throw error;
    }
  }

  if (normalizedSource.startsWith("file://")) {
    const filePath = new URL(normalizedSource);
    return {
      source: normalizedSource,
      rawEpg: await fs.readFile(filePath, "utf8")
    };
  }

  return {
    source: normalizedSource,
    rawEpg: await fs.readFile(normalizedSource, "utf8")
  };
}

ipcMain.handle("playlist:load", async (_event, source) => {
  const playlistData = await readPlaylistSource(source);
  return parsePlaylist(playlistData.rawPlaylist, playlistData.source);
});

ipcMain.handle("epg:load", async (_event, source) => {
  const epgData = await readEpgSource(source);
  return parseEpg(epgData.rawEpg, epgData.source);
});

ipcMain.handle("playlist:pick-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Playlist", extensions: ["m3u", "m3u8", "txt"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("epg:pick-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "EPG / XMLTV", extensions: ["xml", "xmltv"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

function sendMenuAction(action) {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && !focusedWindow.isDestroyed()) {
    focusedWindow.webContents.send("app-menu:action", action);
  }
}

function buildApplicationMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Playlist File...",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuAction("open-local-file")
        },
        {
          label: "Playlist Options",
          accelerator: "CmdOrCtrl+,",
          click: () => sendMenuAction("open-options")
        },
        {
          label: "Reload Playlist",
          accelerator: "CmdOrCtrl+R",
          click: () => sendMenuAction("reload-playlist")
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Search",
          accelerator: "CmdOrCtrl+F",
          click: () => sendMenuAction("focus-global-search")
        },
        {
          label: "Clear Searches",
          accelerator: "Escape",
          click: () => sendMenuAction("clear-searches")
        }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Live TV",
          accelerator: "CmdOrCtrl+1",
          click: () => sendMenuAction("set-category:live")
        },
        {
          label: "Movies",
          accelerator: "CmdOrCtrl+2",
          click: () => sendMenuAction("set-category:movies")
        },
        {
          label: "Series",
          accelerator: "CmdOrCtrl+3",
          click: () => sendMenuAction("set-category:series")
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" }
      ]
    },
    {
      label: "Playback",
      submenu: [
        {
          label: "Previous Episode",
          accelerator: "Alt+Left",
          click: () => sendMenuAction("previous-episode")
        },
        {
          label: "Next Episode",
          accelerator: "Alt+Right",
          click: () => sendMenuAction("next-episode")
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin" ? [
          { type: "separator" },
          { role: "front" },
          { role: "window" }
        ] : [{ role: "close" }])
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Project README",
          click: () => shell.openPath(path.join(__dirname, "..", "README.md"))
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    const dockIcon = nativeImage.createFromPath(path.join(ICONS_DIR, "icon.icns"));
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  buildApplicationMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
