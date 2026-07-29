// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AppShell from './AppShell';
import type { SecretsGetResult } from '../../shared/ipcTypes';

function installFakeApi(secrets: SecretsGetResult = {}) {
  (window as unknown as { api: Window['api'] }).api = {
    secrets: { get: vi.fn().mockResolvedValue(secrets), save: vi.fn().mockResolvedValue({ ok: true as const }) },
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
    github: { createIssue: vi.fn().mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' }) },
    windowControls: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
  };
}

describe('AppShell', () => {
  it('renders the titlebar above the sidebar and content', () => {
    installFakeApi({ discordBotToken: 'token' });
    render(<AppShell />);

    expect(screen.getByRole('banner', { name: 'Titlebar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeInTheDocument();
  });

  it('opens to Settings when no Discord bot token has been saved yet', async () => {
    installFakeApi({});
    render(<AppShell />);

    expect(await screen.findByRole('form', { name: 'Onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Forum-to-repo configuration' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Scan' })).not.toBeInTheDocument();
  });

  it('opens to Triage when a Discord bot token has already been saved', async () => {
    installFakeApi({ discordBotToken: 'saved-token' });
    render(<AppShell />);

    expect(await screen.findByRole('region', { name: 'Scan' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Onboarding' })).not.toBeInTheDocument();
  });

  it('switches from the first-run Settings section to Triage when the sidebar Triage item is clicked', async () => {
    installFakeApi({});
    render(<AppShell />);

    await screen.findByRole('form', { name: 'Onboarding' });
    fireEvent.click(screen.getByRole('button', { name: /triage/i }));

    expect(await screen.findByRole('region', { name: 'Scan' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Onboarding' })).not.toBeInTheDocument();
  });

  it('switches from the returning-user Triage section to Settings when the sidebar Settings item is clicked', async () => {
    installFakeApi({ discordBotToken: 'saved-token' });
    render(<AppShell />);

    await screen.findByRole('region', { name: 'Scan' });
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));

    expect(await screen.findByRole('form', { name: 'Onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Scan' })).not.toBeInTheDocument();
  });

  it('keeps both sidebar items enabled even before setup is complete (no gating)', async () => {
    installFakeApi({});
    render(<AppShell />);

    await screen.findByRole('form', { name: 'Onboarding' });

    expect(screen.getByRole('button', { name: /triage/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /settings/i })).not.toBeDisabled();
  });

  it('consults secrets.get() to make the initial routing decision', async () => {
    installFakeApi({});
    render(<AppShell />);

    await screen.findByRole('form', { name: 'Onboarding' });
    // Onboarding itself also calls secrets.get() on mount to hydrate its form
    // fields (pre-existing, unrelated behavior) — so this only asserts the
    // shell's own routing check happened, not an exact call count.
    await waitFor(() => expect(window.api.secrets.get).toHaveBeenCalled());
  });

  it('is closed by default, and toggles open/closed when the titlebar console button is clicked', async () => {
    installFakeApi({ discordBotToken: 'token' });
    render(<AppShell />);

    await screen.findByRole('region', { name: 'Scan' });
    expect(screen.queryByRole('region', { name: 'Console drawer' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /console/i }));
    expect(screen.getByRole('region', { name: 'Console drawer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /console/i }));
    expect(screen.queryByRole('region', { name: 'Console drawer' })).not.toBeInTheDocument();
  });

  it('toggles the console drawer open/closed on a Ctrl+` keydown from anywhere in the app', async () => {
    installFakeApi({ discordBotToken: 'token' });
    render(<AppShell />);

    await screen.findByRole('region', { name: 'Scan' });
    expect(screen.queryByRole('region', { name: 'Console drawer' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });
    expect(screen.getByRole('region', { name: 'Console drawer' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });
    expect(screen.queryByRole('region', { name: 'Console drawer' })).not.toBeInTheDocument();
  });

  it('keeps the console drawer open when switching between Triage and Settings', async () => {
    installFakeApi({ discordBotToken: 'token' });
    render(<AppShell />);

    await screen.findByRole('region', { name: 'Scan' });
    fireEvent.click(screen.getByRole('button', { name: /console/i }));
    expect(screen.getByRole('region', { name: 'Console drawer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    await screen.findByRole('form', { name: 'Onboarding' });
    expect(screen.getByRole('region', { name: 'Console drawer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /triage/i }));
    await screen.findByRole('region', { name: 'Scan' });
    expect(screen.getByRole('region', { name: 'Console drawer' })).toBeInTheDocument();
  });
});
