import type { WindowControlsApi } from '../shared/ipcTypes';

/**
 * Structural subset of Electron's `ipcRenderer` this module depends on, kept
 * minimal so it can be unit-tested against a fake without a live Electron
 * runtime (mirrors botApi.ts).
 */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Preload-side half of the window-controls IPC contract (010): fire-and-wait
 * requests over `ipcRenderer.invoke`, no streamed events (unlike the bot
 * log/status/pulled-posts channels) — main applies the action synchronously
 * to its single BrowserWindow instance and resolves.
 */
export function createWindowControlsApi(ipcRenderer: IpcRendererLike): WindowControlsApi {
  return {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:maximize') as Promise<void>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>
  };
}
