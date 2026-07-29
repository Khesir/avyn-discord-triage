/**
 * Structural subset of Electron's `shell` module this handler depends on,
 * kept minimal so it's testable without a live Electron runtime (mirrors how
 * secretsHandlers.ts / configHandlers.ts are factored out of ipcMain
 * wiring).
 */
export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

/**
 * Pure(ish) handler logic for the `shell:openExternal` IPC channel, factored
 * out of ipcMain wiring so it's testable without a live Electron runtime.
 * main/index.ts binds this to ipcMain.handle(). Used by the renderer's post
 * detail view (005) "View on Discord" action to hand a
 * `https://discord.com/channels/{guildId}/{postId}` link to the OS default
 * browser/Discord client.
 */
export function createShellHandlers(shell: ShellLike) {
  return {
    openExternal: async (url: string): Promise<{ ok: true }> => {
      const trimmed = url?.trim();

      if (!trimmed) {
        throw new Error('A URL is required.');
      }

      await shell.openExternal(trimmed);
      return { ok: true };
    }
  };
}
