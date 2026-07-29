import { describe, expect, it, vi } from 'vitest';
import { createShellHandlers } from './shellHandlers';

/**
 * Fake standing in for Electron's `shell` module — this is the boundary the
 * `shell:openExternal` handler is written against, so we can verify it
 * without a live Electron runtime or actually opening a browser.
 */
function createFakeShell() {
  return {
    openExternal: vi.fn(async (_url: string) => {})
  };
}

describe('createShellHandlers', () => {
  it('openExternal() forwards the given URL to shell.openExternal and resolves { ok: true }', async () => {
    const shell = createFakeShell();
    const handlers = createShellHandlers(shell);

    await expect(handlers.openExternal('https://discord.com/channels/guild-1/thread-1')).resolves.toEqual({
      ok: true
    });
    expect(shell.openExternal).toHaveBeenCalledWith('https://discord.com/channels/guild-1/thread-1');
  });

  it('openExternal() rejects for an empty URL and does not call shell.openExternal', async () => {
    const shell = createFakeShell();
    const handlers = createShellHandlers(shell);

    await expect(handlers.openExternal('')).rejects.toThrow();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
