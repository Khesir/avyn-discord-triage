// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BotConsole from './BotConsole';
import type { BotLogLine } from '../../shared/ipcTypes';

function installFakeApi() {
  let capturedCallback: ((line: BotLogLine) => void) | undefined;
  const unsubscribe = vi.fn();
  const onLog = vi.fn((callback: (line: BotLogLine) => void) => {
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
      onLog,
      scan: vi.fn().mockResolvedValue({ ok: true as const }),
      onPulledPosts: vi.fn(() => vi.fn()),
      sendRemark: vi.fn().mockResolvedValue({ ok: true as const }),
      setStatus: vi.fn().mockResolvedValue({ ok: true as const }),
      getStatus: vi.fn().mockResolvedValue({ status: 'stopped' as const }),
      onStatus: vi.fn(() => vi.fn()),
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
    onLog,
    unsubscribe,
    emit: (line: BotLogLine) => capturedCallback?.(line)
  };
}

let fakeApi: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  fakeApi = installFakeApi();
});

describe('BotConsole', () => {
  it('subscribes to bot log lines on mount', () => {
    render(<BotConsole />);

    expect(fakeApi.onLog).toHaveBeenCalledTimes(1);
  });

  it('renders a live stdout line as it arrives', async () => {
    render(<BotConsole />);

    fakeApi.emit({ stream: 'stdout', text: 'Bot ready — logged in as AvynBot#1234.' });

    expect(await screen.findByText(/Bot ready — logged in as AvynBot#1234\./)).toBeInTheDocument();
  });

  it('renders a live stderr line as it arrives', async () => {
    render(<BotConsole />);

    fakeApi.emit({ stream: 'stderr', text: 'Discord client error: connection reset' });

    expect(await screen.findByText(/Discord client error: connection reset/)).toBeInTheDocument();
  });

  it('appends multiple lines in arrival order', async () => {
    render(<BotConsole />);

    fakeApi.emit({ stream: 'stdout', text: 'first line' });
    fakeApi.emit({ stream: 'stdout', text: 'second line' });

    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['first line', 'second line']);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<BotConsole />);

    unmount();

    expect(fakeApi.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('auto-scrolls to the latest line as new lines arrive', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<BotConsole />);
    fakeApi.emit({ stream: 'stdout', text: 'first line' });
    await screen.findByText('first line');
    fakeApi.emit({ stream: 'stdout', text: 'second line' });
    await screen.findByText('second line');

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('visually distinguishes stderr lines from stdout lines', async () => {
    render(<BotConsole />);

    fakeApi.emit({ stream: 'stdout', text: 'a normal line' });
    fakeApi.emit({ stream: 'stderr', text: 'a problem line' });

    const stdoutLine = await screen.findByText('a normal line');
    const stderrLine = await screen.findByText('a problem line');

    expect(stdoutLine.style.color).not.toBe(stderrLine.style.color);
  });
});
