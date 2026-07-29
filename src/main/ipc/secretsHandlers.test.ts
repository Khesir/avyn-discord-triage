import { describe, expect, it, vi } from 'vitest';
import { createSecretsHandlers } from './secretsHandlers';
import type { SecretStore } from '../store/secretStore';

/**
 * Fake standing in for SecretStore — this is the boundary the IPC handlers
 * are written against, so we don't need a real file-backed store here (that
 * behavior is already covered by secretStore.test.ts).
 */
function createFakeSecretStore(initial: Record<string, string> = {}) {
  const values: Record<string, string> = { ...initial };
  return {
    getAll: vi.fn(() => ({ ...values })),
    setSecret: vi.fn((key: string, value: string) => {
      values[key] = value;
    })
  } as unknown as SecretStore;
}

describe('createSecretsHandlers', () => {
  it('get() returns whatever the underlying store has saved', async () => {
    const store = createFakeSecretStore({ discordBotToken: 'saved-token' });
    const handlers = createSecretsHandlers(store);

    await expect(handlers.get()).resolves.toEqual({ discordBotToken: 'saved-token' });
  });

  it('save() persists both secrets via the store when both are non-empty', async () => {
    const store = createFakeSecretStore();
    const handlers = createSecretsHandlers(store);

    await handlers.save({ discordBotToken: 'new-discord-token', githubPat: 'new-github-pat' });

    expect(store.setSecret).toHaveBeenCalledWith('discordBotToken', 'new-discord-token');
    expect(store.setSecret).toHaveBeenCalledWith('githubPat', 'new-github-pat');
  });

  it('save() rejects when the Discord bot token is empty and does not touch the store', async () => {
    const store = createFakeSecretStore();
    const handlers = createSecretsHandlers(store);

    await expect(handlers.save({ discordBotToken: '', githubPat: 'new-github-pat' })).rejects.toThrow();
    expect(store.setSecret).not.toHaveBeenCalled();
  });

  it('save() persists only the Discord bot token when the GitHub PAT is left empty', async () => {
    const store = createFakeSecretStore();
    const handlers = createSecretsHandlers(store);

    await handlers.save({ discordBotToken: 'new-discord-token', githubPat: '   ' });

    expect(store.setSecret).toHaveBeenCalledWith('discordBotToken', 'new-discord-token');
    expect(store.setSecret).not.toHaveBeenCalledWith('githubPat', expect.anything());
  });

  it('never logs saved secret values to the console', async () => {
    const store = createFakeSecretStore();
    const handlers = createSecretsHandlers(store);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handlers.save({ discordBotToken: 'secret-discord-token', githubPat: 'secret-github-pat' });
    await handlers.get();

    const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => JSON.stringify(arg))
      .join('\n');

    expect(allLoggedText).not.toContain('secret-discord-token');
    expect(allLoggedText).not.toContain('secret-github-pat');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
