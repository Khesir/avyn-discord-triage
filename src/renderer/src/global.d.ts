import type { BotApi, ForumConfigApi, GitHubApi, SecretsApi, ShellApi, WindowControlsApi } from '../../shared/ipcTypes';

declare global {
  interface Window {
    api: {
      secrets: SecretsApi;
      forumConfig: ForumConfigApi;
      bot: BotApi;
      shell: ShellApi;
      github: GitHubApi;
      windowControls: WindowControlsApi;
    };
  }
}

export {};
