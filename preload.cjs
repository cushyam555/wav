const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  chooseRecordingFolder: () => ipcRenderer.invoke('recording:folder'),
  saveRecording: (name, bytes) => ipcRenderer.invoke('recording:save', name, bytes),
  saveManifest: data => ipcRenderer.invoke('recording:manifest', data),
  recordingActive: active => ipcRenderer.invoke('recording:active', active)
});
