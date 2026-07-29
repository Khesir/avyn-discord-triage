import type { ConfigStore } from '../store/configStore';
import type { BotProcessManager } from '../bot/botProcessManager';
import type {
  BotPresence,
  BotStatusEvent,
  PresenceStatus,
  PulledPost,
  ScanResult,
  SendRemarkResult,
  SetPresenceResult,
  SetStatusResult,
  TriageStatus
} from '../../shared/ipcTypes';

/**
 * Pure(ish) handler logic for the `bot:scan` IPC channel, factored out of
 * ipcMain wiring so it's testable without a live Electron runtime (mirrors
 * configHandlers.ts/secretsHandlers.ts). Reads the forum-to-repo mappings
 * from ConfigStore (003) to know which forums to sweep, then hands the
 * forum channel IDs to BotProcessManager to dispatch into the bot's utility
 * process (PRD: "a single manual, global 'Scan' action sweeps every
 * configured forum ... in one pass"). main/index.ts binds this to
 * ipcMain.handle('bot:scan', ...). Also carries the `bot:sendRemark`
 * handler (006): a thin pass-through to BotProcessManager.sendRemark(),
 * which round-trips through the bot's utility process and resolves once
 * the message has actually been posted (or failed to post). Also carries
 * the `bot:setStatus` handler (007): a thin pass-through to
 * BotProcessManager.setStatus(), applying the ✅/❌ triage reaction.
 */
export function createBotHandlers(botProcessManager: BotProcessManager, configStore: ConfigStore) {
  return {
    scan: async (options: { includeViewed?: boolean } = {}): Promise<ScanResult> => {
      if (!botProcessManager.isRunning()) {
        return { ok: false, error: 'Bot process is not running. Save a Discord bot token and wait for it to connect before scanning.' };
      }

      const forumChannelIds = configStore.getForumRepoMappings().map((mapping) => mapping.forumChannelId);
      botProcessManager.scan(forumChannelIds, options.includeViewed ?? false);
      return { ok: true };
    },
    sendRemark: async (threadId: string, text: string): Promise<SendRemarkResult> => {
      return botProcessManager.sendRemark(threadId, text);
    },
    setStatus: async (postId: string, starterMessageId: string, status: TriageStatus): Promise<SetStatusResult> => {
      const result = await botProcessManager.setStatus(postId, starterMessageId, status);
      if (result.ok) {
        // Local triage status (powers the Triage list's filter) is separate from the Discord reaction —
        // only persist it once the reaction is confirmed to have actually landed.
        configStore.updatePulledPostStatus(postId, status);
      }
      return result;
    },
    getStatus: async (): Promise<BotStatusEvent> => {
      return botProcessManager.getStatus();
    },
    getPulledPosts: async (): Promise<PulledPost[]> => {
      return configStore.getPulledPosts();
    },
    getForumNames: async (forumChannelIds: string[]): Promise<Record<string, string>> => {
      return botProcessManager.getForumNames(forumChannelIds);
    },
    // Presence (019): a thin pass-through to BotProcessManager.setPresence(), same as setStatus() —
    // persisted locally via ConfigStore only once the real Discord update is confirmed to have
    // succeeded, so a failed presence change can't be silently reapplied on the next reconnect.
    setPresence: async (status: PresenceStatus, statusMessage?: string): Promise<SetPresenceResult> => {
      const result = await botProcessManager.setPresence(status, statusMessage);
      if (result.ok) {
        configStore.setBotPresence({ status, message: statusMessage ?? '' });
      }
      return result;
    },
    // Reads the last-selected presence straight from ConfigStore (not the bot process) — this is
    // what the Titlebar's presence menu shows on initial render, independent of whether the bot is
    // currently connected.
    getPresence: async (): Promise<BotPresence> => {
      return configStore.getBotPresence();
    }
  };
}
