// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsPage from './SettingsPage';

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

describe('SettingsPage', () => {
  it('renders both the Credentials (Onboarding) and Forum Mappings (ForumConfig) content', async () => {
    installFakeApi();
    render(<SettingsPage />);

    expect(await screen.findByRole('form', { name: 'Onboarding' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Forum-to-repo configuration' })).toBeInTheDocument();
  });

  it('renders Credentials above Forum Mappings in document order', async () => {
    installFakeApi();
    render(<SettingsPage />);

    const credentials = await screen.findByRole('form', { name: 'Onboarding' });
    const forumMappings = screen.getByRole('region', { name: 'Forum-to-repo configuration' });

    // Bit 4 (DOCUMENT_POSITION_FOLLOWING) set means forumMappings comes after credentials in the DOM.
    expect(credentials.compareDocumentPosition(forumMappings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
