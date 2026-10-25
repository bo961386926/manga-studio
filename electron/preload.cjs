// Preload bridge: expose a minimal, explicit API to the renderer. No Node
// capabilities leak beyond the documented bridge methods.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mangaStudioBridge', {
  // Seal legacy localStorage config into an encrypted envelope file via the
  // main process (Argon2id + AES-256-GCM). Returns { ok, path } or { ok:false, reason }.
  exportLegacy: (data, password) => ipcRenderer.invoke('legacy:export', { data, password }),
});
