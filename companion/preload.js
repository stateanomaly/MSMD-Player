const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("guided", {
  onEvent(callback) {
    return subscribe("guided:event", callback);
  },
  onBounds(callback) {
    return subscribe("guided:bounds", callback);
  },
  onSteer(callback) {
    return subscribe("guided:steer", callback);
  },
  questData() {
    return ipcRenderer.invoke("guided:quest-data");
  },
  ready() {
    ipcRenderer.send("guided:ready");
  },
});
