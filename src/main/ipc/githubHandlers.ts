import type { CreateGitHubIssuePayload, CreateGitHubIssueResult } from '../../shared/ipcTypes';
import type { ConfigStore } from '../store/configStore';
import type { SecretStore } from '../store/secretStore';
import type { GitHubClient } from '../github/githubClient';

/**
 * Pure(ish) handler logic for the `github:createIssue` IPC channel, factored
 * out of ipcMain wiring so it's testable without a live Electron runtime
 * (mirrors secretsHandlers.ts/configHandlers.ts/botHandlers.ts). Resolves
 * the post's `forumChannelId` to a target repo via the forum-to-repo mapping
 * (003/ConfigStore), reads the GitHub PAT from secure storage (001/SecretStore),
 * and delegates the actual REST call to GitHubClient (008). main/index.ts
 * binds this to ipcMain.handle('github:createIssue', ...).
 */
export function createGitHubHandlers(githubClient: GitHubClient, configStore: ConfigStore, secretStore: SecretStore) {
  return {
    createIssue: async (payload: CreateGitHubIssuePayload): Promise<CreateGitHubIssueResult> => {
      const title = payload?.title?.trim();
      if (!title) {
        throw new Error('An issue title is required.');
      }

      const mapping = configStore
        .getForumRepoMappings()
        .find((candidate) => candidate.forumChannelId === payload.forumChannelId);
      if (!mapping) {
        return { ok: false, error: `No GitHub repo is mapped to forum channel "${payload.forumChannelId}".` };
      }
      if (!mapping.repo) {
        return {
          ok: false,
          error: `Forum channel "${payload.forumChannelId}" doesn't have a repo mapped yet. Add one in Forum Config before creating an issue.`
        };
      }

      const pat = secretStore.get('githubPat');
      if (!pat) {
        return { ok: false, error: 'No GitHub personal access token is saved. Add one during onboarding.' };
      }

      return githubClient.createIssue(pat, {
        repo: mapping.repo,
        title,
        body: payload.body ?? '',
        labels: payload.labels ?? []
      });
    }
  };
}
