import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("claudePet", {
  // Renderer gates its per-pixel click-through on this: setIgnoreMouseEvents'
  // `forward` (needed to detect the cursor re-entering) is macOS/Windows only.
  platform: process.platform,
  onLoad: (cb: (p: any) => void) => ipcRenderer.on("pet:load", (_e, p) => cb(p)),
  onState: (cb: (s: any) => void) => ipcRenderer.on("pet:state", (_e, s) => cb(s)),
  onScale: (cb: (n: number) => void) => ipcRenderer.on("pet:scale", (_e, n) => cb(n)),
  onGhost: (cb: (on: boolean) => void) => ipcRenderer.on("pet:ghost", (_e, on) => cb(on)),
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send("pet:ignoreMouse", ignore),
  click: () => ipcRenderer.send("pet:click"),
  getWinPos: () => ipcRenderer.invoke("win:getpos"),
  moveWin: (x: number, y: number) => ipcRenderer.send("win:move", x, y),
  contextMenu: () => ipcRenderer.send("pet:contextmenu"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (s: any) => ipcRenderer.invoke("settings:save", s),
  listPets: () => ipcRenderer.invoke("pets:list"),
  currentPet: () => ipcRenderer.invoke("pets:current"),
  switchPet: (slug: string) => ipcRenderer.invoke("pets:switch", slug),
  importPet: () => ipcRenderer.invoke("pets:import"),
});
