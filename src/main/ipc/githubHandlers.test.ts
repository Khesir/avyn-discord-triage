import { describe, expect, it, vi } from 'vitest';
import { createGitHubHandlers } from './githubHandlers';
import type { ConfigStore, ForumRepoMapping } from '../store/configStore';
import type { SecretStore } from '../store/secretStore';
import type { GitHubClient } from '../github/githubClient';

/** Fake standing in for ConfigStore — see configHandlers.test.ts for the same pattern. */
function createFakeConfigStore(mappings: ForumRepoMapping[]) {
  return {
    getForumRepoMappings: vi.fn(() => mappings)
  } as unknown as ConfigStore;
}

/** Fake standing in for SecretStore — see secretsHandlers.test.ts for the same pattern. */
function createFakeSecretStore(githubPat: string | undefined) {
  return {
    get: vi.fn((key: string) => (key === 'githubPat' ? githubPat : undefined))
  } as unknown as SecretStore;
}

/** Fake standing in for GitHubClient — the real HTTP-boundary behavior is covered by githubClient.test.ts. */
function createFakeGitHubClient() {
  return {
    createIssue: vi.fn()
  } as unknown as GitHubClient;
}

describe('createGitHubHandlers', () => {
  it('createIssue() resolves the post\'s forumChannelId to a repo and delegates to the GitHub client with the stored PAT', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: 'acme/widgets' }]);
    const secretStore = createFakeSecretStore('saved-pat');
    const githubClient = createFakeGitHubClient();
    (githubClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      number: 7,
      htmlUrl: 'https://github.com/acme/widgets/issues/7'
    });
    const handlers = createGitHubHandlers(githubClient, configStore, secretStore);

    const result = await handlers.createIssue({
      forumChannelId: 'forum-1',
      title: 'Bug report',
      body: 'Steps to reproduce...',
      labels: ['bug']
    });

    expect(githubClient.createIssue).toHaveBeenCalledWith('saved-pat', {
      repo: 'acme/widgets',
      title: 'Bug report',
      body: 'Steps to reproduce...',
      labels: ['bug']
    });
    expect(result).toEqual({ ok: true, number: 7, htmlUrl: 'https://github.com/acme/widgets/issues/7' });
  });

  it('resolves ok:false without calling the GitHub client when the post\'s forumChannelId has no repo mapping', async () => {
    const configStore = createFakeConfigStore([]);
    const secretStore = createFakeSecretStore('saved-pat');
    const githubClient = createFakeGitHubClient();
    const handlers = createGitHubHandlers(githubClient, configStore, secretStore);

    const result = await handlers.createIssue({
      forumChannelId: 'unmapped-forum',
      title: 'Bug report',
      body: '',
      labels: []
    });

    expect(result.ok).toBe(false);
    expect(githubClient.createIssue).not.toHaveBeenCalled();
  });

  it('resolves ok:false without calling the GitHub client when the forum is mapped but has no repo set yet', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: '' }]);
    const secretStore = createFakeSecretStore('saved-pat');
    const githubClient = createFakeGitHubClient();
    const handlers = createGitHubHandlers(githubClient, configStore, secretStore);

    const result = await handlers.createIssue({ forumChannelId: 'forum-1', title: 'Bug report', body: '', labels: [] });

    expect(result.ok).toBe(false);
    expect(githubClient.createIssue).not.toHaveBeenCalled();
  });

  it('resolves ok:false without calling the GitHub client when no GitHub PAT is saved', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: 'acme/widgets' }]);
    const secretStore = createFakeSecretStore(undefined);
    const githubClient = createFakeGitHubClient();
    const handlers = createGitHubHandlers(githubClient, configStore, secretStore);

    const result = await handlers.createIssue({ forumChannelId: 'forum-1', title: 'Bug report', body: '', labels: [] });

    expect(result.ok).toBe(false);
    expect(githubClient.createIssue).not.toHaveBeenCalled();
  });

  it('rejects when the title is empty and does not call the GitHub client', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: 'acme/widgets' }]);
    const secretStore = createFakeSecretStore('saved-pat');
    const githubClient = createFakeGitHubClient();
    const handlers = createGitHubHandlers(githubClient, configStore, secretStore);

    await expect(
      handlers.createIssue({ forumChannelId: 'forum-1', title: '   ', body: '', labels: [] })
    ).rejects.toThrow();
    expect(githubClient.createIssue).not.toHaveBeenCalled();
  });

  it('passes through a GitHub client error result (e.g. bad token) unchanged', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: 'acme/widgets' }]);
    const secretStore = createFakeSecretStore('bad-pat');
    const githubClient = createFakeGitHubClient();
    (githubClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'GitHub rejected the request: the stored personal access token is invalid or expired.',
      errorType: 'invalid_token'
    });
    const handlers = createGitHubHandlers(githubClient, configStore, secretStore);

    const result = await handlers.createIssue({ forumChannelId: 'forum-1', title: 'Bug report', body: '', labels: [] });

    expect(result).toEqual({
      ok: false,
      error: 'GitHub rejected the request: the stored personal access token is invalid or expired.',
      errorType: 'invalid_token'
    });
  });
});
