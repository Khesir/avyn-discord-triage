// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ForumConfig from './ForumConfig';
import type { ForumRepoMapping } from '../../shared/ipcTypes';

function installFakeApi(overrides: {
  list?: () => Promise<ForumRepoMapping[]>;
  add?: (mapping: ForumRepoMapping) => Promise<{ ok: true }>;
  remove?: (forumChannelId: string) => Promise<{ ok: true }>;
  getForumNames?: (forumChannelIds: string[]) => Promise<Record<string, string>>;
} = {}) {
  const forumConfig = {
    list: vi.fn(overrides.list ?? (() => Promise.resolve([]))),
    add: vi.fn(overrides.add ?? (() => Promise.resolve({ ok: true as const }))),
    remove: vi.fn(overrides.remove ?? (() => Promise.resolve({ ok: true as const })))
  };
  const getForumNames = vi.fn(overrides.getForumNames ?? (() => Promise.resolve({})));
  (window as unknown as { api: Window['api'] }).api = {
    secrets: { get: vi.fn().mockResolvedValue({}), save: vi.fn().mockResolvedValue({ ok: true as const }) },
    forumConfig,
    bot: {
      onLog: vi.fn(() => vi.fn()),
      scan: vi.fn().mockResolvedValue({ ok: true as const }),
      onPulledPosts: vi.fn(() => vi.fn()),
      sendRemark: vi.fn().mockResolvedValue({ ok: true as const }),
      setStatus: vi.fn().mockResolvedValue({ ok: true as const }),
      getStatus: vi.fn().mockResolvedValue({ status: 'stopped' as const }),
      onStatus: vi.fn(() => vi.fn()),
      getPulledPosts: vi.fn().mockResolvedValue([]),
      getForumNames,
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
  return { ...forumConfig, getForumNames };
}

beforeEach(() => {
  installFakeApi();
});

describe('ForumConfig', () => {
  it('renders a forum channel ID field and a repo field', async () => {
    render(<ForumConfig />);

    expect(await screen.findByLabelText(/forum channel id/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/repo \(owner\/name\)/i)).toBeInTheDocument();
  });

  it('lists mappings fetched from the main process on mount', async () => {
    installFakeApi({
      list: () =>
        Promise.resolve([
          { forumChannelId: '111', repo: 'org/repo-a' },
          { forumChannelId: '222', repo: 'org/repo-b' }
        ])
    });

    render(<ForumConfig />);

    expect(await screen.findByText('111')).toBeInTheDocument();
    expect(await screen.findByText('org/repo-a')).toBeInTheDocument();
    expect(await screen.findByText('222')).toBeInTheDocument();
    expect(await screen.findByText('org/repo-b')).toBeInTheDocument();
  });

  it('adds a new mapping via text entry and shows it in the list', async () => {
    const forumConfig = installFakeApi();
    render(<ForumConfig />);

    fireEvent.change(await screen.findByLabelText(/forum channel id/i), { target: { value: '999' } });
    fireEvent.change(screen.getByLabelText(/repo \(owner\/name\)/i), { target: { value: 'org/new-repo' } });
    fireEvent.click(screen.getByRole('button', { name: /add mapping/i }));

    await waitFor(() =>
      expect(forumConfig.add).toHaveBeenCalledWith({ forumChannelId: '999', repo: 'org/new-repo' })
    );
    expect(await screen.findByText('999')).toBeInTheDocument();
    expect(await screen.findByText('org/new-repo')).toBeInTheDocument();
  });

  it('shows a validation message and does not call add when the forum channel ID is left empty', async () => {
    const forumConfig = installFakeApi();
    render(<ForumConfig />);

    fireEvent.click(await screen.findByRole('button', { name: /add mapping/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i);
    expect(forumConfig.add).not.toHaveBeenCalled();
  });

  it('adds a mapping with just a forum channel ID, leaving repo blank', async () => {
    const forumConfig = installFakeApi();
    render(<ForumConfig />);

    fireEvent.change(await screen.findByLabelText(/forum channel id/i), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /add mapping/i }));

    await waitFor(() => expect(forumConfig.add).toHaveBeenCalledWith({ forumChannelId: '999', repo: '' }));
    expect(await screen.findByText('999')).toBeInTheDocument();
    expect(await screen.findByText(/no repo mapped yet/i)).toBeInTheDocument();
  });

  it('shows an error and keeps the mapping list unchanged when adding fails (e.g. duplicate forumChannelId)', async () => {
    installFakeApi({
      list: () => Promise.resolve([{ forumChannelId: '123', repo: 'org/repo' }]),
      add: () => Promise.reject(new Error('A repo mapping already exists for forum channel "123".'))
    });
    render(<ForumConfig />);

    await screen.findByText('123');

    fireEvent.change(await screen.findByLabelText(/forum channel id/i), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText(/repo \(owner\/name\)/i), { target: { value: 'org/other-repo' } });
    fireEvent.click(screen.getByRole('button', { name: /add mapping/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(screen.queryByText('org/other-repo')).not.toBeInTheDocument();
  });

  it('requests real forum names for every configured mapping on mount', async () => {
    const forumConfig = installFakeApi({
      list: () =>
        Promise.resolve([
          { forumChannelId: '111', repo: 'org/repo-a' },
          { forumChannelId: '222', repo: 'org/repo-b' }
        ])
    });

    render(<ForumConfig />);

    await waitFor(() => expect(forumConfig.getForumNames).toHaveBeenCalledWith(['111', '222']));
  });

  it('shows the resolved forum name alongside the raw channel ID when available', async () => {
    installFakeApi({
      list: () => Promise.resolve([{ forumChannelId: '111', repo: 'org/repo-a' }]),
      getForumNames: () => Promise.resolve({ '111': 'bug-reports' })
    });

    render(<ForumConfig />);

    expect(await screen.findByText('bug-reports')).toBeInTheDocument();
    expect(screen.getByText('(111)')).toBeInTheDocument();
  });

  it('falls back to showing just the raw channel ID when the name cannot be resolved', async () => {
    installFakeApi({
      list: () => Promise.resolve([{ forumChannelId: '111', repo: 'org/repo-a' }]),
      getForumNames: () => Promise.resolve({})
    });

    render(<ForumConfig />);

    expect(await screen.findByText('111')).toBeInTheDocument();
    expect(screen.queryByText('bug-reports')).not.toBeInTheDocument();
  });

  it('requests the name for a newly added mapping too', async () => {
    const forumConfig = installFakeApi();
    render(<ForumConfig />);

    fireEvent.change(await screen.findByLabelText(/forum channel id/i), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /add mapping/i }));

    await waitFor(() => expect(forumConfig.getForumNames).toHaveBeenCalledWith(['999']));
  });

  it('removes a mapping and calls the remove API with its forumChannelId', async () => {
    const forumConfig = installFakeApi({
      list: () => Promise.resolve([{ forumChannelId: '123', repo: 'org/repo' }])
    });
    render(<ForumConfig />);

    await screen.findByText('123');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(forumConfig.remove).toHaveBeenCalledWith('123'));
    await waitFor(() => expect(screen.queryByText('123')).not.toBeInTheDocument());
  });
});
