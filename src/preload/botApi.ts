import type { IpcRendererEvent } from 'electron';
import { BOT_LOG_CHANNEL, BOT_PULLED_POSTS_CHANNEL, BOT_STATUS_CHANNEL } from '../shared/ipcTypes';
import type {
  BotApi,
  BotLogLine,
  BotPresence,
  BotStatusEvent,
  PresenceStatus,
  PulledPost,
  ScanResult,
  SendRemarkResult,
  SetPresenceResult,
  SetStatusResult,
  TriageStatus
} from '../shared/ipcTypes';

/**
 * Structural subset of Electron's `ipcRenderer` this module depends on, kept
 * minimal so it can be unit-tested against a fake without a live Electron
 * runtime (mirrors how main-process handlers are factored out of ipcMain
 * wiring — see src/main/ipc/*Handlers.ts).
 */
export interface IpcRendererLike {
  on(channel: string, listener: (event: IpcRendererEvent, line: BotLogLine) => void): void;
  on(channel: string, listener: (event: IpcRendererEvent, posts: PulledPost[]) => void): void;
  on(channel: string, listener: (event: IpcRendererEvent, status: BotStatusEvent) => void): void;
  removeListener(channel: string, listener: (event: IpcRendererEvent, line: BotLogLine) => void): void;
  removeListener(channel: string, listener: (event: IpcRendererEvent, posts: PulledPost[]) => void): void;
  removeListener(channel: string, listener: (event: IpcRendererEvent, status: BotStatusEvent) => void): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Preload-side half of the bot IPC contract. Log lines and pulled posts flow
 * main -> renderer as streamed events (BOT_LOG_CHANNEL / BOT_PULLED_POSTS_CHANNEL,
 * see botProcessManager.ts); scan is a fire-and-forget renderer -> main
 * request/response over `ipcRenderer.invoke('bot:scan')` (see botHandlers.ts).
 */
export function createBotApi(ipcRenderer: IpcRendererLike): BotApi {
  return {
    onLog: (callback: (line: BotLogLine) => void) => {
      const listener = (_event: IpcRendererEvent, line: BotLogLine) => callback(line);
      ipcRenderer.on(BOT_LOG_CHANNEL, listener);
      return () => ipcRenderer.removeListener(BOT_LOG_CHANNEL, listener);
    },
    scan: (options?: { includeViewed?: boolean }) => ipcRenderer.invoke('bot:scan', options) as Promise<ScanResult>,
    getPulledPosts: () => ipcRenderer.invoke('bot:getPulledPosts') as Promise<PulledPost[]>,
    onPulledPosts: (callback: (posts: PulledPost[]) => void) => {
      const listener = (_event: IpcRendererEvent, posts: PulledPost[]) => callback(posts);
      ipcRenderer.on(BOT_PULLED_POSTS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(BOT_PULLED_POSTS_CHANNEL, listener);
    },
    sendRemark: (threadId: string, text: string) =>
      ipcRenderer.invoke('bot:sendRemark', threadId, text) as Promise<SendRemarkResult>,
    setStatus: (postId: string, starterMessageId: string, status: TriageStatus) =>
      ipcRenderer.invoke('bot:setStatus', postId, starterMessageId, status) as Promise<SetStatusResult>,
    getStatus: () => ipcRenderer.invoke('bot:getStatus') as Promise<BotStatusEvent>,
    onStatus: (callback: (event: BotStatusEvent) => void) => {
      const listener = (_event: IpcRendererEvent, status: BotStatusEvent) => callback(status);
      ipcRenderer.on(BOT_STATUS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(BOT_STATUS_CHANNEL, listener);
    },
    getForumNames: (forumChannelIds: string[]) =>
      ipcRenderer.invoke('bot:getForumNames', forumChannelIds) as Promise<Record<string, string>>,
    setPresence: (status: PresenceStatus, statusMessage?: string) =>
      ipcRenderer.invoke('bot:setPresence', status, statusMessage) as Promise<SetPresenceResult>,
    getPresence: () => ipcRenderer.invoke('bot:getPresence') as Promise<BotPresence>
  };
}
