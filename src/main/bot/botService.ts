import type { BotPresence, BotStatusEvent, PresenceStatus, PulledPost, TriageStatus } from '../../shared/ipcTypes';
import { DEFAULT_BOT_PRESENCE } from '../../shared/ipcTypes';

/**
 * Bot Service — the discord.js wrapper that runs inside the utility process
 * (see botProcess.ts, the composition root that wires this to a real
 * discord.js Client). Written against a minimal structural interface
 * (DiscordClientLike) rather than importing discord.js's Client type
 * directly, so it can be unit-tested against a faked client per the PRD's
 * Testing Decisions, without a live Discord connection.
 *
 * This slice covers connection lifecycle (login/ready/error/destroy) and
 * scanning (004) — reactions for approve/decline and message posting are
 * later issues (006+).
 */
export interface DiscordClientLike {
  user: { tag: string } | null;
  once(event: 'ready', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  login(token: string): Promise<string>;
  destroy(): Promise<void>;
  /** Fetches a forum channel by ID. Resolves `null` if it doesn't exist or isn't accessible to the bot. */
  fetchForumChannel(forumChannelId: string): Promise<ForumChannelLike | null>;
  /**
   * Fetches a thread (a forum post's own channel) by ID, for posting a bot
   * message into it (006+: standalone remarks, 007 approve/decline remarks,
   * 009 post-issue-creation notifications — all post through the same
   * thread lookup). Resolves `null` if it doesn't exist or isn't accessible.
   */
  fetchThread(threadId: string): Promise<ThreadLike | null>;
  /**
   * Sets the bot's Discord presence — one of the four selectable statuses
   * plus an optional custom status message shown next to the bot's name
   * (019). Real client: `client.user.setPresence(...)` (botProcess.ts's
   * discord.js adapter). Used both for reviewer-triggered changes
   * (BotService.setPresence) and BotService's automatic reapply of the
   * last-persisted presence on `ready` (see BotService.start()).
   */
  setPresence(status: PresenceStatus, message: string): Promise<void>;
}

/** A Discord thread (a forum post's own channel) — the target of BotService.postMessage() and BotService.setStatus(). */
export interface ThreadLike {
  id: string;
  /** Posts a text message into this thread as the bot itself (PRD: no per-reviewer webhook identity). */
  send(text: string): Promise<void>;
  /**
   * Fetches a specific message within this thread by ID — used by
   * setStatus() (007) to locate the post's starter message so the ✅/❌
   * triage reaction lands on it. Resolves `null` if it doesn't exist or
   * isn't accessible.
   */
  fetchMessage(messageId: string): Promise<PostMessageLike | null>;
}

/** A Discord forum channel — a container of posts (threads), one per topic. */
export interface ForumChannelLike {
  id: string;
  guildId: string;
  /** The forum channel's real Discord name (e.g. "bug-reports") — shown in the UI instead of the raw channel ID. */
  name: string;
  /** Fetches every post (thread) currently in the forum, active or archived. */
  fetchPosts(): Promise<ForumPostLike[]>;
}

/** A single forum post — a Discord thread whose first message is the post itself. */
export interface ForumPostLike {
  /** The thread's channel ID — the same ID later issues (006+) send remarks/reactions to. */
  id: string;
  title: string;
  /** The message that started the thread — i.e. the post's own text, and what carries the 👀/✅/❌ reactions. */
  fetchStarterMessage(): Promise<PostMessageLike>;
  /** Every reply in the thread, oldest first, excluding the starter message. */
  fetchReplies(): Promise<PostMessageLike[]>;
}

/** A single Discord message — either a forum post's starter message or one of its replies. */
export interface PostMessageLike {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  /** CDN URLs of any image attachments/embeds on this message — links only, nothing downloaded (see PulledPost/PulledReply). */
  imageUrls: string[];
  hasReaction(emoji: string): boolean;
  react(emoji: string): Promise<void>;
}

export interface BotServiceOptions {
  client: DiscordClientLike;
  /** Defaults to console.log — the utility process's stdout, piped to the renderer's log console. */
  log?: (message: string) => void;
  /** Defaults to console.error — the utility process's stderr, piped to the renderer's log console. */
  logError?: (message: string) => void;
  /**
   * Called whenever the bot's Discord connection state changes (PRD: the
   * reviewer should be able to tell whether the bot is actually connected
   * before relying on it, e.g. before hitting Scan). Optional — has no
   * effect on connection behavior itself.
   */
  onStatusChange?: (event: BotStatusEvent) => void;
}

export interface ScanOptions {
  /** When true, re-pulls posts that already have 👀 instead of skipping them, without re-reacting. See BotService.scan(). */
  includeViewed?: boolean;
}

export interface BotService {
  /**
   * Logs in to Discord with the given token. `presence` (019) is the
   * last-persisted presence + status message (the caller reads it from
   * ConfigStore) — reapplied automatically once the client emits `ready`,
   * defaulting to `DEFAULT_BOT_PRESENCE` (online, no message) if omitted,
   * so a fresh connection never silently resets Discord's default
   * appearance instead of what the reviewer last chose.
   */
  start(token: string, presence?: BotPresence): Promise<void>;
  stop(): Promise<void>;
  /**
   * Sweeps every given forum channel in one pass (PRD: "a single manual,
   * global 'Scan' action sweeps every configured forum ... in one pass").
   * For each forum, finds posts missing the 👀 "viewed" reaction, reacts 👀
   * on each immediately (not batched at the end), and returns their text —
   * post plus all replies, no attachments/embeds/images.
   *
   * `includeViewed` (default false) is a recovery option: when true, posts
   * that already carry 👀 are re-pulled (their text/images re-fetched and
   * returned) instead of skipped, without re-reacting to them. Lets a
   * reviewer rebuild the app's pulled-post list from Discord itself if its
   * local persisted copy is ever lost.
   */
  scan(forumChannelIds: string[], options?: ScanOptions): Promise<PulledPost[]>;
  /**
   * Posts `text` into the thread identified by `threadId`, as the bot
   * itself (PRD: "All bot-originated messages ... are posted as the bot
   * itself, not via per-reviewer webhooks"). General-purpose — this is the
   * one capability behind 006's standalone remark, 007's approve/decline
   * remark, and 009's post-issue-creation notification; none of those are
   * hardcoded into this method's name or behavior. Rejects if the thread
   * can't be found or accessed.
   */
  postMessage(threadId: string, text: string): Promise<void>;
  /**
   * Applies the fixed ✅/❌ triage reaction to a post's starter message (PRD
   * user stories 20-21): `postId` identifies the thread, `starterMessageId`
   * the message within it that carries the reaction. Only ever applies the
   * reaction — sending an accompanying remark is a separate postMessage()
   * call, left to the caller (007's approve/decline flow lets the reviewer
   * edit the pre-filled remark before it's sent, so the two aren't coupled
   * into one atomic action here). Rejects if the thread or message can't be
   * found or accessed.
   */
  setStatus(postId: string, starterMessageId: string, status: TriageStatus): Promise<void>;
  /**
   * Resolves a forum channel's real Discord name (e.g. "bug-reports"), so
   * the Forum Config settings page (003) can show it instead of the raw
   * channel ID. Resolves `null` if the forum can't be found or accessed —
   * the caller falls back to displaying the raw ID in that case.
   */
  getForumName(forumChannelId: string): Promise<string | null>;
  /**
   * Sets the bot's Discord presence (PRD user stories 5-9, issue 019): the
   * four selectable statuses (online/idle/dnd/invisible) plus an optional
   * custom status message shown next to the bot's name. Applied immediately
   * to the real Discord connection — the caller (the IPC relay) is
   * responsible for persisting the selection so it's reapplied on the next
   * `start()`/reconnect (see `start()`'s `presence` parameter).
   */
  setPresence(status: PresenceStatus, statusMessage?: string): Promise<void>;
}

/** Fixed "viewed" reaction applied to a post as soon as it's pulled, so it isn't re-pulled on the next scan (PRD user stories 9-10). */
export const VIEWED_EMOJI = '👀';
/** Fixed "approved" reaction applied on approve (PRD user stories 20-21). */
export const APPROVED_EMOJI = '✅';
/** Fixed "declined" reaction applied on decline (PRD user stories 20-21). */
export const DECLINED_EMOJI = '❌';

export function createBotService({
  client,
  log = console.log,
  logError = console.error,
  onStatusChange = () => {}
}: BotServiceOptions): BotService {
  // The presence to reapply once the client is ready (019) — captured from start()'s `presence`
  // argument, since the `once('ready', ...)` listener below is registered here at construction
  // time, before start() (and whatever presence it was called with) is known.
  let presenceToReapply: BotPresence = DEFAULT_BOT_PRESENCE;

  client.once('ready', () => {
    log(`Bot ready — logged in as ${client.user?.tag ?? 'unknown user'}.`);
    onStatusChange({ status: 'connected' });
    // Reapply the last-persisted presence automatically on ready/reconnect (PRD/issue notes:
    // "default: online, no message, if nothing was ever set") — fire-and-forget since nothing
    // downstream awaits the ready handler itself; a failure here shouldn't be treated as a
    // connection error.
    client.setPresence(presenceToReapply.status, presenceToReapply.message).catch((error: unknown) => {
      logError(`Failed to reapply persisted presence: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  client.on('error', (error) => {
    logError(`Discord client error: ${error.message}`);
    onStatusChange({ status: 'error', error: error.message });
  });

  return {
    start: async (token: string, presence: BotPresence = DEFAULT_BOT_PRESENCE): Promise<void> => {
      presenceToReapply = presence;
      onStatusChange({ status: 'connecting' });
      await client.login(token);
    },
    stop: async (): Promise<void> => {
      await client.destroy();
      onStatusChange({ status: 'stopped' });
    },
    scan: async (forumChannelIds: string[], options: ScanOptions = {}): Promise<PulledPost[]> => {
      const includeViewed = options.includeViewed ?? false;
      log(`Scanning ${forumChannelIds.length} forum${forumChannelIds.length === 1 ? '' : 's'}...`);
      const pulled: PulledPost[] = [];

      for (const forumChannelId of forumChannelIds) {
        const forum = await client.fetchForumChannel(forumChannelId);
        if (!forum) {
          logError(`Forum channel ${forumChannelId} could not be found or accessed; skipping.`);
          continue;
        }

        const posts = await forum.fetchPosts();
        for (const post of posts) {
          const starter = await post.fetchStarterMessage();
          const alreadyViewed = starter.hasReaction(VIEWED_EMOJI);
          if (alreadyViewed && !includeViewed) {
            continue;
          }

          if (!alreadyViewed) {
            // Reacted immediately per post as it's pulled, not batched after the whole scan (PRD/acceptance criteria).
            await starter.react(VIEWED_EMOJI);
          }

          const replies = await post.fetchReplies();
          pulled.push({
            postId: post.id,
            starterMessageId: starter.id,
            forumChannelId,
            forumName: forum.name,
            guildId: forum.guildId,
            title: post.title,
            author: { id: starter.authorId, name: starter.authorName },
            content: starter.content,
            imageUrls: starter.imageUrls,
            replies: replies.map((reply) => ({
              author: { id: reply.authorId, name: reply.authorName },
              content: reply.content,
              imageUrls: reply.imageUrls
            })),
            status: 'pending'
          });

          log(`Pulled post "${post.title}" from forum ${forumChannelId} and marked it 👀.`);
        }
      }

      log(`Scan complete — pulled ${pulled.length} new post${pulled.length === 1 ? '' : 's'}.`);
      return pulled;
    },
    postMessage: async (threadId: string, text: string): Promise<void> => {
      const thread = await client.fetchThread(threadId);
      if (!thread) {
        throw new Error(`Thread ${threadId} could not be found or accessed.`);
      }

      await thread.send(text);
      log(`Posted a message to thread ${threadId}.`);
    },
    setStatus: async (postId: string, starterMessageId: string, status: TriageStatus): Promise<void> => {
      const thread = await client.fetchThread(postId);
      if (!thread) {
        throw new Error(`Thread ${postId} could not be found or accessed.`);
      }

      const message = await thread.fetchMessage(starterMessageId);
      if (!message) {
        throw new Error(`Message ${starterMessageId} could not be found in thread ${postId}.`);
      }

      const emoji = status === 'approved' ? APPROVED_EMOJI : DECLINED_EMOJI;
      await message.react(emoji);
      log(`Applied ${emoji} to post ${postId} (status: ${status}).`);
    },
    getForumName: async (forumChannelId: string): Promise<string | null> => {
      const forum = await client.fetchForumChannel(forumChannelId);
      return forum?.name ?? null;
    },
    setPresence: async (status: PresenceStatus, statusMessage = ''): Promise<void> => {
      await client.setPresence(status, statusMessage);
      // Also feeds the next reapply-on-ready (should the client ever reconnect without a fresh
      // start() call) — keeps what's re-applied in sync with the most recently applied presence.
      presenceToReapply = { status, message: statusMessage };
      log(`Set presence to "${status}"${statusMessage ? ` with status message "${statusMessage}"` : ''}.`);
    }
  };
}
