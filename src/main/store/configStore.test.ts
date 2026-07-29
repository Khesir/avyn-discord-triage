import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore } from './configStore';
import type { PulledPost } from '../../shared/ipcTypes';

let tempDir: string;
let configFilePath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avyn-config-store-'));
  configFilePath = path.join(tempDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('ConfigStore', () => {
  it('returns an empty object when nothing has been saved yet', () => {
    const store = new ConfigStore(configFilePath);

    expect(store.read()).toEqual({});
  });

  it('reads back written config data', () => {
    const store = new ConfigStore(configFilePath);

    store.write({ forumRepoMappings: [{ forumChannelId: '123', repo: 'org/repo' }] });

    expect(store.read()).toEqual({
      forumRepoMappings: [{ forumChannelId: '123', repo: 'org/repo' }]
    });
  });

  it('persists across a fresh ConfigStore instance pointed at the same file (simulating an app restart)', () => {
    const firstRun = new ConfigStore(configFilePath);
    firstRun.write({ trackedChannelIds: ['abc'] });

    const afterRestart = new ConfigStore(configFilePath);

    expect(afterRestart.read()).toEqual({ trackedChannelIds: ['abc'] });
  });

  it('stores config as plain, human-readable JSON on disk', () => {
    const store = new ConfigStore(configFilePath);

    store.write({ trackedChannelIds: ['abc'] });

    const raw = fs.readFileSync(configFilePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ trackedChannelIds: ['abc'] });
  });
});

describe('ConfigStore forum-to-repo mappings', () => {
  it('returns an empty array when no mappings have been added yet', () => {
    const store = new ConfigStore(configFilePath);

    expect(store.getForumRepoMappings()).toEqual([]);
  });

  it('adds a mapping and reflects it in getForumRepoMappings', () => {
    const store = new ConfigStore(configFilePath);

    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo' });

    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });

  it('rejects adding a second mapping for a forumChannelId that already has one', () => {
    const store = new ConfigStore(configFilePath);
    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo' });

    expect(() => store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/other-repo' })).toThrow();
    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });

  it('allows mappings for different forum channels', () => {
    const store = new ConfigStore(configFilePath);

    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo-a' });
    store.addForumRepoMapping({ forumChannelId: '456', repo: 'org/repo-b' });

    expect(store.getForumRepoMappings()).toEqual([
      { forumChannelId: '123', repo: 'org/repo-a' },
      { forumChannelId: '456', repo: 'org/repo-b' }
    ]);
  });

  it('rejects an empty or whitespace-only forumChannelId', () => {
    const store = new ConfigStore(configFilePath);

    expect(() => store.addForumRepoMapping({ forumChannelId: '', repo: 'org/repo' })).toThrow();
    expect(() => store.addForumRepoMapping({ forumChannelId: '   ', repo: 'org/repo' })).toThrow();
    expect(store.getForumRepoMappings()).toEqual([]);
  });

  it('allows adding a mapping with no repo yet — GitHub wiring is optional until issue creation is used', () => {
    const store = new ConfigStore(configFilePath);

    store.addForumRepoMapping({ forumChannelId: '123', repo: '' });

    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: '' }]);
  });

  it('treats a whitespace-only repo the same as no repo', () => {
    const store = new ConfigStore(configFilePath);

    store.addForumRepoMapping({ forumChannelId: '123', repo: '   ' });

    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: '' }]);
  });

  it('removes an existing mapping by forumChannelId', () => {
    const store = new ConfigStore(configFilePath);
    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo-a' });
    store.addForumRepoMapping({ forumChannelId: '456', repo: 'org/repo-b' });

    store.removeForumRepoMapping('123');

    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '456', repo: 'org/repo-b' }]);
  });

  it('removing a forumChannelId with no mapping is a no-op', () => {
    const store = new ConfigStore(configFilePath);
    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo-a' });

    expect(() => store.removeForumRepoMapping('does-not-exist')).not.toThrow();
    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: 'org/repo-a' }]);
  });

  it('preserves other non-secret config already saved when adding a mapping', () => {
    const store = new ConfigStore(configFilePath);
    store.write({ trackedChannelIds: ['abc'] });

    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo' });

    expect(store.read()).toEqual({
      trackedChannelIds: ['abc'],
      forumRepoMappings: [{ forumChannelId: '123', repo: 'org/repo' }]
    });
  });

  it('persists mappings across a fresh ConfigStore instance pointed at the same file (simulating an app restart)', () => {
    const firstRun = new ConfigStore(configFilePath);
    firstRun.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo' });

    const afterRestart = new ConfigStore(configFilePath);

    expect(afterRestart.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });
});

describe('ConfigStore pulled posts', () => {
  const samplePost: PulledPost = {
    postId: 'thread-1',
    starterMessageId: 'msg-1',
    forumChannelId: 'forum-1',
    forumName: 'general',
    guildId: 'guild-1',
    title: 'A post',
    author: { id: 'user-1', name: 'Alice' },
    content: 'Post text',
    imageUrls: [],
    replies: [],
    status: 'pending'
  };

  it('returns an empty array when no posts have been persisted yet', () => {
    const store = new ConfigStore(configFilePath);

    expect(store.getPulledPosts()).toEqual([]);
  });

  it('appendPulledPosts adds new posts and reflects them in getPulledPosts', () => {
    const store = new ConfigStore(configFilePath);

    store.appendPulledPosts([samplePost]);

    expect(store.getPulledPosts()).toEqual([samplePost]);
  });

  it('appendPulledPosts accumulates across multiple calls rather than replacing', () => {
    const store = new ConfigStore(configFilePath);
    const secondPost: PulledPost = { ...samplePost, postId: 'thread-2' };

    store.appendPulledPosts([samplePost]);
    store.appendPulledPosts([secondPost]);

    expect(store.getPulledPosts()).toEqual([samplePost, secondPost]);
  });

  it('appendPulledPosts upserts by postId instead of duplicating (e.g. a recovery re-scan)', () => {
    const store = new ConfigStore(configFilePath);
    const updated: PulledPost = { ...samplePost, content: 'Updated text' };

    store.appendPulledPosts([samplePost]);
    store.appendPulledPosts([updated]);

    expect(store.getPulledPosts()).toEqual([updated]);
  });

  it('persists pulled posts across a fresh ConfigStore instance (simulating an app restart)', () => {
    const firstRun = new ConfigStore(configFilePath);
    firstRun.appendPulledPosts([samplePost]);

    const afterRestart = new ConfigStore(configFilePath);

    expect(afterRestart.getPulledPosts()).toEqual([samplePost]);
  });

  it("preserves an existing post's local status when re-appended by a recovery scan, rather than resetting it to pending", () => {
    const store = new ConfigStore(configFilePath);
    store.appendPulledPosts([samplePost]);
    store.updatePulledPostStatus(samplePost.postId, 'approved');

    const rescanned: PulledPost = { ...samplePost, content: 'Refreshed text from Discord', status: 'pending' };
    store.appendPulledPosts([rescanned]);

    expect(store.getPulledPosts()).toEqual([{ ...rescanned, status: 'approved' }]);
  });

  it("updatePulledPostStatus updates just that post's status, leaving others untouched", () => {
    const store = new ConfigStore(configFilePath);
    const secondPost: PulledPost = { ...samplePost, postId: 'thread-2' };
    store.appendPulledPosts([samplePost, secondPost]);

    store.updatePulledPostStatus(samplePost.postId, 'declined');

    expect(store.getPulledPosts()).toEqual([{ ...samplePost, status: 'declined' }, secondPost]);
  });

  it('updatePulledPostStatus on an unknown postId is a no-op', () => {
    const store = new ConfigStore(configFilePath);
    store.appendPulledPosts([samplePost]);

    expect(() => store.updatePulledPostStatus('does-not-exist', 'approved')).not.toThrow();
    expect(store.getPulledPosts()).toEqual([samplePost]);
  });

  it('defaults a persisted post missing a status field to pending (predates the status field existing on disk)', () => {
    fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
    const { status: _status, ...postWithoutStatus } = samplePost;
    fs.writeFileSync(configFilePath, JSON.stringify({ pulledPosts: [postWithoutStatus] }), 'utf-8');

    const store = new ConfigStore(configFilePath);

    expect(store.getPulledPosts()).toEqual([{ ...postWithoutStatus, status: 'pending' }]);
  });

  it('defaults a persisted post with an invalid status value to pending (e.g. hand-edited config.json)', () => {
    fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
    fs.writeFileSync(
      configFilePath,
      JSON.stringify({ pulledPosts: [{ ...samplePost, status: 'bogus' }] }),
      'utf-8'
    );

    const store = new ConfigStore(configFilePath);

    expect(store.getPulledPosts()).toEqual([{ ...samplePost, status: 'pending' }]);
  });

  it('preserves forum-to-repo mappings already saved when appending pulled posts', () => {
    const store = new ConfigStore(configFilePath);
    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo' });

    store.appendPulledPosts([samplePost]);

    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });
});

describe('ConfigStore bot presence', () => {
  it('defaults to online with no message when nothing has been saved yet', () => {
    const store = new ConfigStore(configFilePath);

    expect(store.getBotPresence()).toEqual({ status: 'online', message: '' });
  });

  it('round-trips a saved presence and status message', () => {
    const store = new ConfigStore(configFilePath);

    store.setBotPresence({ status: 'dnd', message: 'In review mode' });

    expect(store.getBotPresence()).toEqual({ status: 'dnd', message: 'In review mode' });
  });

  it('overwrites a previously saved presence rather than accumulating', () => {
    const store = new ConfigStore(configFilePath);

    store.setBotPresence({ status: 'idle', message: 'brb' });
    store.setBotPresence({ status: 'invisible', message: '' });

    expect(store.getBotPresence()).toEqual({ status: 'invisible', message: '' });
  });

  it('persists the saved presence across a fresh ConfigStore instance (simulating an app restart)', () => {
    const firstRun = new ConfigStore(configFilePath);
    firstRun.setBotPresence({ status: 'online', message: 'Reviewing posts' });

    const afterRestart = new ConfigStore(configFilePath);

    expect(afterRestart.getBotPresence()).toEqual({ status: 'online', message: 'Reviewing posts' });
  });

  it('preserves other non-secret config already saved when setting the presence', () => {
    const store = new ConfigStore(configFilePath);
    store.addForumRepoMapping({ forumChannelId: '123', repo: 'org/repo' });

    store.setBotPresence({ status: 'idle', message: '' });

    expect(store.getForumRepoMappings()).toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });

  it('falls back to the default when the saved value is malformed (e.g. hand-edited config.json)', () => {
    const store = new ConfigStore(configFilePath);
    store.write({ botPresence: 'not-an-object' });

    expect(store.getBotPresence()).toEqual({ status: 'online', message: '' });
  });
});
