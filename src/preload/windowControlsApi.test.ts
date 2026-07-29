import { describe, expect, it, vi } from 'vitest';
import { createWindowControlsApi } from './windowControlsApi';

/**
 * Fake standing in for Electron's `ipcRenderer` — this is the boundary the
 * preload-side window-controls API contract is written against.
 */
function createFakeIpcRenderer() {
  return {
    invoke: vi.fn(async (_channel: string, ..._args: unknown[]): Promise<unknown> => undefined)
  };
}

describe('createWindowControlsApi (preload)', () => {
  it('minimize() invokes the window:minimize channel', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const windowControlsApi = createWindowControlsApi(ipcRenderer);

    await windowControlsApi.minimize();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window:minimize');
  });

  it('toggleMaximize() invokes the window:maximize channel', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const windowControlsApi = createWindowControlsApi(ipcRenderer);

    await windowControlsApi.toggleMaximize();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window:maximize');
  });

  it('close() invokes the window:close channel', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const windowControlsApi = createWindowControlsApi(ipcRenderer);

    await windowControlsApi.close();

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('window:close');
  });
});
