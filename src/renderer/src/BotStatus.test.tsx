// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BotStatus from './BotStatus';
import type { BotStatusEvent } from '../../shared/ipcTypes';

function installFakeApi(initialStatus: BotStatusEvent = { status: 'stopped' }) {
  let capturedCallback: ((event: BotStatusEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const getStatus = vi.fn().mockResolvedValue(initialStatus);
  const onStatus = vi.fn((callback: (event: BotStatusEvent) => void) => {
    capturedCallback = callback;
    return unsubscribe;
  });

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
      setPresence: vi.fn().mockResolvedValue({ ok: true as const }),
      getPresence: vi.fn().mockResolvedValue({ status: 'online' as const, message: '' })
    },
    shell: { openExternal: vi.fn().mockResolvedValue({ ok: true as const }) },
    github: { createIssue: vi.fn().mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' }) },
    windowControls: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
  };

  return {
    getStatus,
    onStatus,
    unsubscribe,
    emit: (event: BotStatusEvent) => capturedCallback?.(event)
  };
}

let fakeApi: ReturnType<typeof installFakeApi>;

describe('BotStatus', () => {
  it('fetches and renders the initial status on mount', async () => {
    fakeApi = installFakeApi({ status: 'connected' });
    render(<BotStatus />);

    expect(await screen.findByText(/connected/i)).toBeInTheDocument();
    expect(fakeApi.getStatus).toHaveBeenCalledTimes(1);
  });

  it('shows "not connected" before any bot token has been saved', async () => {
    fakeApi = installFakeApi({ status: 'stopped' });
    render(<BotStatus />);

    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
  });

  it('shows a connecting state', async () => {
    fakeApi = installFakeApi({ status: 'connecting' });
    render(<BotStatus />);

    expect(await screen.findByText(/connecting/i)).toBeInTheDocument();
  });

  it('updates live as onStatus events arrive', async () => {
    fakeApi = installFakeApi({ status: 'connecting' });
    render(<BotStatus />);

    await screen.findByText(/connecting/i);
    fakeApi.emit({ status: 'connected' });

    await waitFor(() => expect(screen.getByText(/connected/i)).toBeInTheDocument());
  });

  it('shows the error message when the status is "error"', async () => {
    fakeApi = installFakeApi({ status: 'stopped' });
    render(<BotStatus />);

    await screen.findByText(/not connected/i);
    fakeApi.emit({ status: 'error', error: 'An invalid token was provided.' });

    expect(await screen.findByRole('alert')).toHaveTextContent('An invalid token was provided.');
  });

  it('unsubscribes on unmount', async () => {
    fakeApi = installFakeApi();
    const { unmount } = render(<BotStatus />);
    await waitFor(() => expect(fakeApi.onStatus).toHaveBeenCalledTimes(1));

    unmount();

    expect(fakeApi.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
