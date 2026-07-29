import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateGitHubIssuePayload,
  CreateGitHubIssueResult,
  ForumConfigApi,
  ForumRepoMapping,
  GitHubApi,
  SecretsApi,
  SecretsPayload,
  ShellApi
} from '../shared/ipcTypes';
import { createBotApi } from './botApi';
import { createWindowControlsApi } from './windowControlsApi';

const secrets: SecretsApi = {
  get: () => ipcRenderer.invoke('secrets:get'),
  save: (payload: SecretsPayload) => ipcRenderer.invoke('secrets:save', payload)
};

const forumConfig: ForumConfigApi = {
  list: () => ipcRenderer.invoke('forumConfig:list'),
  add: (mapping: ForumRepoMapping) => ipcRenderer.invoke('forumConfig:add', mapping),
  remove: (forumChannelId: string) => ipcRenderer.invoke('forumConfig:remove', forumChannelId)
};

const shell: ShellApi = {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
};

const bot = createBotApi(ipcRenderer);

const github: GitHubApi = {
  createIssue: (payload: CreateGitHubIssuePayload) =>
    ipcRenderer.invoke('github:createIssue', payload) as Promise<CreateGitHubIssueResult>
};

const windowControls = createWindowControlsApi(ipcRenderer);

contextBridge.exposeInMainWorld('api', { secrets, forumConfig, bot, shell, github, windowControls });
