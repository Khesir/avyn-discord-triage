// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConsoleDrawer from './ConsoleDrawer';

function installFakeApi() {
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
      getStatus: vi.fn().mockResolvedValue({ status: 'stopped' as const }),
      onStatus: vi.fn(() => vi.fn()),
      getPulledPosts: vi.fn().mockResolvedValue([]),
      getForumNames: vi.fn().mockResolvedValue({}),
      setPresence: vi.fn().mockResolvedValue({ ok: true as const }),
      getPresence: vi.fn().mockResolvedValue({ status: 'online' as const, message: '' })
    },
    shell: { openExternal: vi.fn().mockResolvedValue({ ok: true as const }) },
    github: {
      createIssue: vi
        .fn()
        .mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' })
    },
    windowControls: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
  };
}

describe('ConsoleDrawer', () => {
  it('renders nothing when closed', () => {
    installFakeApi();
    render(<ConsoleDrawer open={false} />);

    expect(screen.queryByRole('region', { name: 'Console drawer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bot console' })).not.toBeInTheDocument();
  });

  it('renders the wrapped bot console when open', () => {
    installFakeApi();
    render(<ConsoleDrawer open={true} />);

    expect(screen.getByRole('region', { name: 'Console drawer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bot console' })).toBeInTheDocument();
  });

  it('dragging the resize handle changes the drawer height', () => {
    installFakeApi();
    render(<ConsoleDrawer open={true} />);

    const drawer = screen.getByRole('region', { name: 'Console drawer' });
    const initialHeight = drawer.style.height;

    const handle = screen.getByRole('separator', { name: /resize/i });
    fireEvent.mouseDown(handle, { clientY: 400 });
    fireEvent.mouseMove(window, { clientY: 250 });
    fireEvent.mouseUp(window);

    expect(drawer.style.height).not.toBe(initialHeight);
  });
});
