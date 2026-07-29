// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Titlebar from './Titlebar';
import type { BotPresence, BotStatusEvent } from '../../shared/ipcTypes';

function installFakeApi(
  initialStatus: BotStatusEvent = { status: 'stopped' },
  initialPresence: BotPresence = { status: 'online', message: '' }
) {
  const minimize = vi.fn().mockResolvedValue(undefined);
  const toggleMaximize = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);

  let capturedCallback: ((event: BotStatusEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const getStatus = vi.fn().mockResolvedValue(initialStatus);
  const onStatus = vi.fn((callback: (event: BotStatusEvent) => void) => {
    capturedCallback = callback;
    return unsubscribe;
  });
  const getPresence = vi.fn().mockResolvedValue(initialPresence);
  const setPresence = vi.fn().mockResolvedValue({ ok: true as const });

  (window as unknown as { api: Window['api'] }).api = {
    secrets: { get: vi.fn().mockResolvedValue({}), save: vi.fn().mockResolvedValue({ ok: true as const }) },
    forumConfig: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ ok: true as const }),
      remove: vi.fn().mockResolvedValue({ ok: true as const })
    },
    bot: {
      onLog: vi.fn(() => vi.fn()),
      scan: vi.fn().mockResolvedValue({ ok: true as const }),
      onPulledPosts: vi.fn(() => vi.fn()),
      sendRemark: vi.fn().mockResolvedValue({ ok: true as const }),
      setStatus: vi.fn().mockResolvedValue({ ok: true as const }),
      getStatus,
      onStatus,
      getPulledPosts: vi.fn().mockResolvedValue([]),
      getForumNames: vi.fn().mockResolvedValue({}),
      setPresence,
      getPresence
    },
    shell: { openExternal: vi.fn().mockResolvedValue({ ok: true as const }) },
    github: { createIssue: vi.fn().mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' }) },
    windowControls: { minimize, toggleMaximize, close }
  };

  return {
    minimize,
    toggleMaximize,
    close,
    getStatus,
    onStatus,
    unsubscribe,
    getPresence,
    setPresence,
    emit: (event: BotStatusEvent) => capturedCallback?.(event)
  };
}

describe('Titlebar', () => {
  it('clicking the minimize button calls windowControls.minimize()', () => {
    const fakeApi = installFakeApi();
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /minimize/i }));

    expect(fakeApi.minimize).toHaveBeenCalledTimes(1);
  });

  it('clicking the maximize/restore button calls windowControls.toggleMaximize()', () => {
    const fakeApi = installFakeApi();
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /maximize|restore/i }));

    expect(fakeApi.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('clicking the close button calls windowControls.close()', () => {
    const fakeApi = installFakeApi();
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(fakeApi.close).toHaveBeenCalledTimes(1);
  });

  it('clicking the console toggle button calls the onToggleConsole callback', () => {
    installFakeApi();
    const onToggleConsole = vi.fn();
    render(<Titlebar onToggleConsole={onToggleConsole} />);

    fireEvent.click(screen.getByRole('button', { name: /console/i }));

    expect(onToggleConsole).toHaveBeenCalledTimes(1);
  });

  it("shows the bot's current connection status, fetched on mount", async () => {
    const fakeApi = installFakeApi({ status: 'connected' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    expect(await screen.findByText(/connected/i)).toBeInTheDocument();
    expect(fakeApi.getStatus).toHaveBeenCalledTimes(1);
  });

  it('updates the status live as bot status events arrive', async () => {
    const { emit } = installFakeApi({ status: 'connecting' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    await screen.findByText(/connecting/i);
    emit({ status: 'connected' });

    await waitFor(() => expect(screen.getByText(/connected/i)).toBeInTheDocument());
  });

  // NOTE: The `-webkit-app-region: drag`/`no-drag` CSS on the titlebar
  // container and button group (required so the window is draggable but
  // the buttons stay clickable) is implemented in Titlebar.tsx but not
  // assertable here — jsdom's CSSStyleDeclaration (via the `cssstyle`
  // package) silently drops this non-standard, Electron-only property
  // entirely (verified directly: setting it never reaches the DOM under
  // jsdom, in any casing or via setProperty). Actual drag behavior can only
  // be verified in a live Electron window — flagged for human QA.
});

describe('Titlebar — bot presence menu (019)', () => {
  it('clicking the connection-status indicator opens the presence menu when connected', async () => {
    installFakeApi({ status: 'connected' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));

    expect(await screen.findByRole('menu', { name: /bot presence/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Online' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Idle' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Do Not Disturb' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Invisible' })).toBeInTheDocument();
  });

  it('clicking the connection-status indicator does nothing while stopped', async () => {
    installFakeApi({ status: 'stopped' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));

    await waitFor(() => expect(screen.queryByRole('menu', { name: /bot presence/i })).not.toBeInTheDocument());
  });

  it('clicking the connection-status indicator does nothing while connecting', async () => {
    installFakeApi({ status: 'connecting' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));

    await waitFor(() => expect(screen.queryByRole('menu', { name: /bot presence/i })).not.toBeInTheDocument());
  });

  it('clicking the connection-status indicator does nothing while in an error state', async () => {
    installFakeApi({ status: 'error', error: 'boom' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));

    await waitFor(() => expect(screen.queryByRole('menu', { name: /bot presence/i })).not.toBeInTheDocument());
  });

  it('selecting a presence option calls setPresence immediately', async () => {
    const fakeApi = installFakeApi({ status: 'connected' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));
    await screen.findByRole('menu', { name: /bot presence/i });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Idle' }));

    expect(fakeApi.setPresence).toHaveBeenCalledWith('idle', '');
  });

  it('selecting a different presence option preserves the already-applied status message', async () => {
    const fakeApi = installFakeApi({ status: 'connected' }, { status: 'online', message: 'Reviewing posts' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));
    await screen.findByRole('menu', { name: /bot presence/i });
    await waitFor(() => expect(fakeApi.getPresence).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Do Not Disturb' }));

    expect(fakeApi.setPresence).toHaveBeenCalledWith('dnd', 'Reviewing posts');
  });

  it('typing in the status message field updates local state but does not call setPresence', async () => {
    const fakeApi = installFakeApi({ status: 'connected' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));
    const input = await screen.findByLabelText(/status message/i);
    fireEvent.change(input, { target: { value: 'Out of office' } });

    expect(input).toHaveValue('Out of office');
    expect(fakeApi.setPresence).not.toHaveBeenCalled();
  });

  it('clicking Update applies the typed status message with the current presence status', async () => {
    const fakeApi = installFakeApi({ status: 'connected' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));
    const input = await screen.findByLabelText(/status message/i);
    fireEvent.change(input, { target: { value: 'Out of office' } });
    fireEvent.click(screen.getByRole('button', { name: /update/i }));

    expect(fakeApi.setPresence).toHaveBeenCalledWith('online', 'Out of office');
  });

  it('fetches the persisted presence on mount, for the menu\'s initial render', async () => {
    const fakeApi = installFakeApi({ status: 'connected' }, { status: 'dnd', message: 'In review mode' });
    render(<Titlebar onToggleConsole={vi.fn()} />);

    await waitFor(() => expect(fakeApi.getPresence).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /bot presence menu/i }));
    const dndOption = await screen.findByRole('menuitemradio', { name: 'Do Not Disturb' });
    expect(dndOption).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByLabelText(/status message/i)).toHaveValue('In review mode');
  });
});
