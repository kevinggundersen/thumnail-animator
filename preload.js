const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
    scanFolder: (path) => ipcRenderer.invoke('scan-folder', path),
    triggerGC: () => ipcRenderer.invoke('trigger-gc'),
    revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
    renameFile: (filePath, newName) => ipcRenderer.invoke('rename-file', filePath, newName),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    openWithDefault: (filePath) => ipcRenderer.invoke('open-with-default', filePath),
    openWith: (filePath) => ipcRenderer.invoke('open-with', filePath),
    getDrives: () => ipcRenderer.invoke('get-drives'),
    onWindowMinimized: (callback) => ipcRenderer.on('window-minimized', callback),
    onWindowRestored: (callback) => ipcRenderer.on('window-restored', callback),
    removeWindowMinimizedListener: () => ipcRenderer.removeAllListeners('window-minimized'),
    removeWindowRestoredListener: () => ipcRenderer.removeAllListeners('window-restored')
});
