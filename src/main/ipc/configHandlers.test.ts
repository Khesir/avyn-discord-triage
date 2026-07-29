import { describe, expect, it, vi } from 'vitest';
import { createConfigHandlers } from './configHandlers';
import type { ConfigStore, ForumRepoMapping } from '../store/configStore';

/**
 * Fake standing in for ConfigStore — this is the boundary the IPC handlers
 * are written against, so we don't need a real file-backed store here (that
 * behavior is already covered by configStore.test.ts).
 */
function createFakeConfigStore(initial: ForumRepoMapping[] = []) {
  let mappings: ForumRepoMapping[] = [...initial];
  return {
    getForumRepoMappings: vi.fn(() => [...mappings]),
    addForumRepoMapping: vi.fn((mapping: ForumRepoMapping) => {
      const forumChannelId = mapping.forumChannelId?.trim();
      const repo = mapping.repo?.trim() ?? '';
      if (!forumChannelId) {
        throw new Error('A forum channel ID is required.');
      }
      if (mappings.some((m) => m.forumChannelId === forumChannelId)) {
        throw new Error(`A repo mapping already exists for forum channel "${forumChannelId}".`);
      }
      mappings = [...mappings, { forumChannelId, repo }];
    }),
    removeForumRepoMapping: vi.fn((forumChannelId: string) => {
      mappings = mappings.filter((m) => m.forumChannelId !== forumChannelId);
    })
  } as unknown as ConfigStore;
}

describe('createConfigHandlers', () => {
  it('list() returns whatever the underlying store has saved', async () => {
    const store = createFakeConfigStore([{ forumChannelId: '123', repo: 'org/repo' }]);
    const handlers = createConfigHandlers(store);

    await expect(handlers.list()).resolves.toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });

  it('add() persists a valid mapping via the store', async () => {
    const store = createFakeConfigStore();
    const handlers = createConfigHandlers(store);

    await handlers.add({ forumChannelId: '123', repo: 'org/repo' });

    expect(store.addForumRepoMapping).toHaveBeenCalledWith({ forumChannelId: '123', repo: 'org/repo' });
    await expect(handlers.list()).resolves.toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });

  it('add() rejects when the forum channel ID is empty and does not touch the store', async () => {
    const store = createFakeConfigStore();
    const handlers = createConfigHandlers(store);

    await expect(handlers.add({ forumChannelId: '', repo: 'org/repo' })).rejects.toThrow();
    expect(store.addForumRepoMapping).not.toHaveBeenCalled();
  });

  it('add() persists a mapping with no repo yet — repo is optional until GitHub issue creation is used', async () => {
    const store = createFakeConfigStore();
    const handlers = createConfigHandlers(store);

    await handlers.add({ forumChannelId: '123', repo: '' });

    expect(store.addForumRepoMapping).toHaveBeenCalledWith({ forumChannelId: '123', repo: '' });
  });

  it('add() rejects a duplicate forumChannelId', async () => {
    const store = createFakeConfigStore([{ forumChannelId: '123', repo: 'org/repo' }]);
    const handlers = createConfigHandlers(store);

    await expect(handlers.add({ forumChannelId: '123', repo: 'org/other-repo' })).rejects.toThrow();
    await expect(handlers.list()).resolves.toEqual([{ forumChannelId: '123', repo: 'org/repo' }]);
  });

  it('remove() deletes the mapping for the given forumChannelId', async () => {
    const store = createFakeConfigStore([{ forumChannelId: '123', repo: 'org/repo' }]);
    const handlers = createConfigHandlers(store);

    await handlers.remove('123');

    expect(store.removeForumRepoMapping).toHaveBeenCalledWith('123');
    await expect(handlers.list()).resolves.toEqual([]);
  });
});
