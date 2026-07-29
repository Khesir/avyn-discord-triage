import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecretStore } from './secretStore';
import { createFakeEncryptor } from './testHelpers/fakeEncryptor';

let tempDir: string;
let secretsFilePath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avyn-secret-store-'));
  secretsFilePath = path.join(tempDir, 'secrets.enc');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('SecretStore', () => {
  it('returns an empty object when nothing has been saved yet', () => {
    const store = new SecretStore(secretsFilePath, createFakeEncryptor());

    expect(store.getAll()).toEqual({});
  });

  it('reads back a saved secret', () => {
    const store = new SecretStore(secretsFilePath, createFakeEncryptor());

    store.setSecret('discordBotToken', 'my-discord-token');

    expect(store.get('discordBotToken')).toBe('my-discord-token');
  });

  it('preserves other secrets already saved when saving a new one', () => {
    const store = new SecretStore(secretsFilePath, createFakeEncryptor());

    store.setSecret('discordBotToken', 'my-discord-token');
    store.setSecret('githubPat', 'my-github-pat');

    expect(store.getAll()).toEqual({
      discordBotToken: 'my-discord-token',
      githubPat: 'my-github-pat'
    });
  });

  it('rejects saving an empty or whitespace-only value', () => {
    const store = new SecretStore(secretsFilePath, createFakeEncryptor());

    expect(() => store.setSecret('discordBotToken', '')).toThrow();
    expect(() => store.setSecret('discordBotToken', '   ')).toThrow();
    expect(store.getAll()).toEqual({});
  });

  it('reads back saved secrets from a fresh SecretStore instance pointed at the same file (simulating an app restart)', () => {
    const firstRun = new SecretStore(secretsFilePath, createFakeEncryptor());
    firstRun.setSecret('discordBotToken', 'my-discord-token');
    firstRun.setSecret('githubPat', 'my-github-pat');

    const afterRestart = new SecretStore(secretsFilePath, createFakeEncryptor());

    expect(afterRestart.getAll()).toEqual({
      discordBotToken: 'my-discord-token',
      githubPat: 'my-github-pat'
    });
  });

  it('never writes the plaintext secret value into the secrets file on disk', () => {
    const store = new SecretStore(secretsFilePath, createFakeEncryptor());

    store.setSecret('discordBotToken', 'super-secret-plaintext-token');

    const rawBytesOnDisk = fs.readFileSync(secretsFilePath, 'utf-8');
    expect(rawBytesOnDisk.includes('super-secret-plaintext-token')).toBe(false);
  });
});
