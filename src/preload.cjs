const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("blssDesktop", {
  appName: "BLSS Trainer",
  platform: process.platform
});
