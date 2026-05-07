const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iptv", {
  loadPlaylist: (source) => ipcRenderer.invoke("playlist:load", source),
  loadEpg: (source) => ipcRenderer.invoke("epg:load", source),
  pickLocalFile: () => ipcRenderer.invoke("playlist:pick-file"),
  pickEpgFile: () => ipcRenderer.invoke("epg:pick-file"),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("app-menu:action", listener);
    return () => ipcRenderer.removeListener("app-menu:action", listener);
  }
});
