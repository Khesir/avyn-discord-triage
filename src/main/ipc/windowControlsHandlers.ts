/**
 * Structural subset of Electron's `BrowserWindow` this handler depends on,
 * kept minimal so it's testable without a live Electron runtime (mirrors how
 * shellHandlers.ts is factored out of ipcMain wiring).
 */
export interface BrowserWindowLike {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  close(): void;
}

/**
 * Pure(ish) handler logic for the `window:minimize` / `window:maximize` /
 * `window:close` IPC channels, factored out of ipcMain wiring so it's
 * testable without a live Electron runtime. main/index.ts binds this to
 * ipcMain.handle() against the app's single BrowserWindow instance. Backs
 * the custom titlebar's window controls (010) that replace the OS-native
 * titlebar once the window moves to a frameless configuration.
 */
export function createWindowControlsHandlers(window: BrowserWindowLike) {
  return {
    minimize: async (): Promise<void> => {
      window.minimize();
    },
    /**
     * Toggles between maximized and restored based on the window's current
     * state — the renderer only ever asks to "toggle"; main decides which
     * of maximize()/unmaximize() applies (PRD: "maximize/unmaximize (toggle
     * based on current state)").
     */
    toggleMaximize: async (): Promise<void> => {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    },
    close: async (): Promise<void> => {
      window.close();
    }
  };
}
