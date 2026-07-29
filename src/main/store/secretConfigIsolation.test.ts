import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SecretStore } from './secretStore';
import { ConfigStore } from './configStore';
import { createFakeEncryptor } from './testHelpers/fakeEncryptor';

/**
 * Verifies the PRD's "split storage" decision holds at the module boundary:
 * secrets (Discord bot token, GitHub PAT) must never end up in the
 * non-secret config file, and the two stores must never touch each other's
 * file on disk.
 */

let tempDir: string;
let secretsFilePath: string;
let configFilePath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avyn-isolation-'));
  secretsFilePath = path.join(tempDir, 'secrets.enc');
  configFilePath = path.join(tempDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('secret / non-secret config isolation', () => {
  it('does not create the non-secret config file just from saving a secret', () => {
    const secretStore = new SecretStore(secretsFilePath, createFakeEncryptor());

    secretStore.setSecret('discordBotToken', 'discord-token-value');
    secretStore.setSecret('githubPat', 'github-pat-value');

    expect(fs.existsSync(configFilePath)).toBe(false);
  });

  it('never writes secret values into the non-secret config file, even when both stores are used together', () => {
    const secretStore = new SecretStore(secretsFilePath, createFakeEncryptor());
    const configStore = new ConfigStore(configFilePath);

    secretStore.setSecret('discordBotToken', 'discord-token-value');
    secretStore.setSecret('githubPat', 'github-pat-value');
    configStore.write({ forumRepoMappings: [{ forumChannelId: '123', repo: 'org/repo' }] });

    const rawConfig = fs.readFileSync(configFilePath, 'utf-8');
    expect(rawConfig).not.toContain('discord-token-value');
    expect(rawConfig).not.toContain('github-pat-value');
  });

  it("does not expose secret values through the config store's read API", () => {
    const secretStore = new SecretStore(secretsFilePath, createFakeEncryptor());
    const configStore = new ConfigStore(configFilePath);

    secretStore.setSecret('discordBotToken', 'discord-token-value');
    configStore.write({ trackedChannelIds: ['abc'] });

    const configValues = JSON.stringify(configStore.read());
    expect(configValues).not.toContain('discord-token-value');
  });
});
