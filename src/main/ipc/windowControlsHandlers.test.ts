import { describe, expect, it, vi } from 'vitest';
import { createWindowControlsHandlers } from './windowControlsHandlers';

/**
 * Fake standing in for Electron's `BrowserWindow` — this is the boundary the
 * window-controls handlers are written against, so we can verify them
 * without a live Electron runtime or an actual OS window.
 */
function createFakeWindow(overrides: { isMaximized?: boolean } = {}) {
  return {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    isMaximized: vi.fn(() => overrides.isMaximized ?? false),
    close: vi.fn()
  };
}

describe('createWindowControlsHandlers', () => {
  it('minimize() calls window.minimize()', async () => {
    const window = createFakeWindow();
    const handlers = createWindowControlsHandlers(window);

    await handlers.minimize();

    expect(window.minimize).toHaveBeenCalledTimes(1);
  });

  it('toggleMaximize() calls window.maximize() when the window is not currently maximized', async () => {
    const window = createFakeWindow({ isMaximized: false });
    const handlers = createWindowControlsHandlers(window);

    await handlers.toggleMaximize();

    expect(window.maximize).toHaveBeenCalledTimes(1);
    expect(window.unmaximize).not.toHaveBeenCalled();
  });

  it('toggleMaximize() calls window.unmaximize() when the window is currently maximized', async () => {
    const window = createFakeWindow({ isMaximized: true });
    const handlers = createWindowControlsHandlers(window);

    await handlers.toggleMaximize();

    expect(window.unmaximize).toHaveBeenCalledTimes(1);
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it('close() calls window.close()', async () => {
    const window = createFakeWindow();
    const handlers = createWindowControlsHandlers(window);

    await handlers.close();

    expect(window.close).toHaveBeenCalledTimes(1);
  });
});
