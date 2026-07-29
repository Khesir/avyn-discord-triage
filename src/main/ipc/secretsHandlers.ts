import type { SecretsGetResult, SecretsPayload } from '../../shared/ipcTypes';
import type { SecretStore } from '../store/secretStore';

/**
 * Pure(ish) handler logic for the `secrets:get` / `secrets:save` IPC
 * channels, factored out of ipcMain wiring so it's testable without a live
 * Electron runtime. main/index.ts binds these to ipcMain.handle().
 */
export function createSecretsHandlers(secretStore: SecretStore) {
  return {
    get: async (): Promise<SecretsGetResult> => {
      return secretStore.getAll();
    },

    save: async (payload: SecretsPayload): Promise<{ ok: true }> => {
      const discordBotToken = payload?.discordBotToken?.trim();
      const githubPat = payload?.githubPat?.trim();

      if (!discordBotToken) {
        throw new Error('The Discord bot token is required.');
      }

      secretStore.setSecret('discordBotToken', discordBotToken);
      if (githubPat) {
        secretStore.setSecret('githubPat', githubPat);
      }

      return { ok: true };
    }
  };
}
