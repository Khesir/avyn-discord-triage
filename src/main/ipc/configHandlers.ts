import type { ForumConfigApi, ForumRepoMapping } from '../../shared/ipcTypes';
import type { ConfigStore } from '../store/configStore';

/**
 * Pure(ish) handler logic for the `forumConfig:list` / `forumConfig:add` /
 * `forumConfig:remove` IPC channels, factored out of ipcMain wiring so it's
 * testable without a live Electron runtime. main/index.ts binds these to
 * ipcMain.handle(). Business rules (required fields, no duplicate
 * forumChannelId) live in ConfigStore itself; this layer just adapts the
 * IPC contract to it.
 */
export function createConfigHandlers(configStore: ConfigStore): ForumConfigApi {
  return {
    list: async (): Promise<ForumRepoMapping[]> => {
      return configStore.getForumRepoMappings();
    },

    add: async (mapping: ForumRepoMapping): Promise<{ ok: true }> => {
      const forumChannelId = mapping?.forumChannelId?.trim();
      // repo is optional — see ConfigStore.addForumRepoMapping.
      const repo = mapping?.repo?.trim() ?? '';

      if (!forumChannelId) {
        throw new Error('A forum channel ID is required.');
      }

      configStore.addForumRepoMapping({ forumChannelId, repo });
      return { ok: true };
    },

    remove: async (forumChannelId: string): Promise<{ ok: true }> => {
      configStore.removeForumRepoMapping(forumChannelId);
      return { ok: true };
    }
  };
}
