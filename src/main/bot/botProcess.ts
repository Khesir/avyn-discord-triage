import { ActivityType, ChannelType, Client, GatewayIntentBits } from 'discord.js';
import type { Message as DiscordMessage, ForumChannel as DiscordForumChannel, ThreadChannel as DiscordThreadChannel } from 'discord.js';
import { createBotService } from './botService';
import type { DiscordClientLike, ForumChannelLike, ForumPostLike, PostMessageLike, ThreadLike } from './botService';
import type { BotPresence, PresenceStatus, PulledPost, TriageStatus } from '../../shared/ipcTypes';

/**
 * Composition root for the Discord bot's utility process (forked via
 * `utilityProcess.fork` in main/index.ts, per PRD: "Discord bot logic runs
 * in an isolated Electron utilityProcess"). Thin by design — like
 * main/index.ts, it wires real dependencies together and is not unit
 * tested directly; the logic it wires (BotService) is covered by
 * botService.test.ts against a faked discord.js client. The
 * discord.js-to-DiscordClientLike adapter functions below exist only to
 * satisfy that structural interface with a real Client — they carry no
 * business logic of their own (that all lives in BotService).
 *
 * This slice starts the connection, streams console output via stdio
 * (piped back to main, then to the renderer), handles scan requests (004),
 * sendRemark requests (006, reusing BotService.postMessage() — the same
 * capability 007/009 will call for approve/decline remarks and
 * post-issue-creation notifications), setStatus requests (007, applying
 * the ✅/❌ triage reaction via BotService.setStatus()), and setPresence
 * requests (019, applying the bot's Discord presence via
 * BotService.setPresence() — also reapplied automatically on `ready`,
 * using whatever presence main forwards in the `start` message).
 */

/**
 * Extracts image CDN URLs from a discord.js Message's attachments and
 * embeds — links only, per PulledPost/PulledReply's imageUrls (no binary
 * data downloaded or stored). Covers directly-uploaded image attachments
 * and image embeds (e.g. a pasted image link Discord auto-embeds).
 */
function extractImageUrls(message: DiscordMessage): string[] {
  const attachmentUrls = [...message.attachments.values()]
    .filter((attachment) => attachment.contentType?.startsWith('image/'))
    .map((attachment) => attachment.url);
  const embedUrls = message.embeds.map((embed) => embed.image?.url).filter((url): url is string => Boolean(url));
  return [...attachmentUrls, ...embedUrls];
}

/** Adapts a discord.js Message to the minimal PostMessageLike shape BotService.scan() depends on. */
function toPostMessageLike(message: DiscordMessage): PostMessageLike {
  return {
    id: message.id,
    authorId: message.author.id,
    authorName: message.author.tag,
    content: message.content,
    imageUrls: extractImageUrls(message),
    hasReaction: (emoji: string) => message.reactions.cache.get(emoji)?.me ?? false,
    react: async (emoji: string): Promise<void> => {
      await message.react(emoji);
    }
  };
}

/** Adapts a discord.js ThreadChannel (a forum post) to the minimal ForumPostLike shape BotService.scan() depends on. */
function toForumPostLike(thread: DiscordThreadChannel): ForumPostLike {
  return {
    id: thread.id,
    title: thread.name,
    fetchStarterMessage: async (): Promise<PostMessageLike> => {
      const starter = await thread.fetchStarterMessage();
      if (!starter) {
        throw new Error(`Forum post ${thread.id} ("${thread.name}") has no starter message; it may have been deleted.`);
      }
      return toPostMessageLike(starter);
    },
    fetchReplies: async (): Promise<PostMessageLike[]> => {
      const messages = await thread.messages.fetch();
      return [...messages.values()]
        .filter((message) => message.id !== thread.id)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(toPostMessageLike);
    }
  };
}

/** Adapts a discord.js ForumChannel to the minimal ForumChannelLike shape BotService.scan() depends on. */
function toForumChannelLike(forum: DiscordForumChannel): ForumChannelLike {
  return {
    id: forum.id,
    guildId: forum.guildId,
    name: forum.name,
    fetchPosts: async (): Promise<ForumPostLike[]> => {
      const [active, archived] = await Promise.all([forum.threads.fetchActive(), forum.threads.fetchArchived()]);
      return [...active.threads.values(), ...archived.threads.values()].map(toForumPostLike);
    }
  };
}

/** Adapts a discord.js ThreadChannel to the minimal ThreadLike shape BotService.postMessage()/setStatus() depend on. */
function toThreadLike(thread: DiscordThreadChannel): ThreadLike {
  return {
    id: thread.id,
    send: async (text: string): Promise<void> => {
      await thread.send(text);
    },
    fetchMessage: async (messageId: string): Promise<PostMessageLike | null> => {
      const message = await thread.messages.fetch(messageId).catch(() => null);
      return message ? toPostMessageLike(message) : null;
    }
  };
}

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions]
});

const client: DiscordClientLike = {
  get user() {
    return discordClient.user;
  },
  once: (event, listener) => discordClient.once(event, listener),
  on: (event, listener) => discordClient.on(event, listener),
  login: (token) => discordClient.login(token),
  destroy: () => discordClient.destroy(),
  fetchForumChannel: async (forumChannelId: string): Promise<ForumChannelLike | null> => {
    const channel = await discordClient.channels.fetch(forumChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      return null;
    }
    return toForumChannelLike(channel);
  },
  fetchThread: async (threadId: string): Promise<ThreadLike | null> => {
    const channel = await discordClient.channels.fetch(threadId).catch(() => null);
    if (!channel || !channel.isThread()) {
      return null;
    }
    return toThreadLike(channel);
  },
  // 019: `status` maps 1:1 onto discord.js's PresenceStatusData strings, so no translation table is
  // needed. A non-empty `message` is set via a Custom-type activity — `state` carries the display
  // text (the emoji/`name` slot is required by the Discord API but not shown next to a Custom
  // activity in the client UI). No-ops if `client.user` isn't populated yet (login not finished) —
  // the renderer already gates this behind "bot status is connected", so that shouldn't happen in
  // practice, but this keeps the adapter itself safe either way.
  setPresence: async (status: PresenceStatus, message: string): Promise<void> => {
    discordClient.user?.setPresence({
      status,
      activities: message ? [{ name: 'Custom Status', state: message, type: ActivityType.Custom }] : []
    });
  }
};

const botService = createBotService({
  client,
  onStatusChange: (event) => {
    process.parentPort.postMessage({ type: 'status', ...event });
  }
});

type StartMessage = { type: 'start'; token: string; presence?: BotPresence };
type ScanMessage = { type: 'scan'; forumChannelIds: string[]; includeViewed: boolean };
type SendRemarkMessage = { type: 'sendRemark'; requestId: string; threadId: string; text: string };
type SetStatusMessage = { type: 'setStatus'; requestId: string; postId: string; starterMessageId: string; status: TriageStatus };
type GetForumNamesMessage = { type: 'getForumNames'; requestId: string; forumChannelIds: string[] };
type SetPresenceMessage = { type: 'setPresence'; requestId: string; status: PresenceStatus; statusMessage?: string };

/** Loosely validates the optional `presence` field of a start message — absent is fine (BotService.start() defaults it), but a present value must at least look right. */
function isValidOptionalPresence(value: unknown): value is BotPresence | undefined {
  return (
    value === undefined ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { status?: unknown }).status === 'string' &&
      typeof (value as { message?: unknown }).message === 'string')
  );
}

function isStartMessage(data: unknown): data is StartMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'start' &&
    typeof (data as { token?: unknown }).token === 'string' &&
    isValidOptionalPresence((data as { presence?: unknown }).presence)
  );
}

function isScanMessage(data: unknown): data is ScanMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'scan' &&
    Array.isArray((data as { forumChannelIds?: unknown }).forumChannelIds) &&
    typeof (data as { includeViewed?: unknown }).includeViewed === 'boolean'
  );
}

function isSendRemarkMessage(data: unknown): data is SendRemarkMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'sendRemark' &&
    typeof (data as { requestId?: unknown }).requestId === 'string' &&
    typeof (data as { threadId?: unknown }).threadId === 'string' &&
    typeof (data as { text?: unknown }).text === 'string'
  );
}

function isSetStatusMessage(data: unknown): data is SetStatusMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'setStatus' &&
    typeof (data as { requestId?: unknown }).requestId === 'string' &&
    typeof (data as { postId?: unknown }).postId === 'string' &&
    typeof (data as { starterMessageId?: unknown }).starterMessageId === 'string' &&
    ((data as { status?: unknown }).status === 'approved' || (data as { status?: unknown }).status === 'declined')
  );
}

function isGetForumNamesMessage(data: unknown): data is GetForumNamesMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'getForumNames' &&
    typeof (data as { requestId?: unknown }).requestId === 'string' &&
    Array.isArray((data as { forumChannelIds?: unknown }).forumChannelIds)
  );
}

function isSetPresenceMessage(data: unknown): data is SetPresenceMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'setPresence' &&
    typeof (data as { requestId?: unknown }).requestId === 'string' &&
    typeof (data as { status?: unknown }).status === 'string'
  );
}

process.parentPort.once('message', (event) => {
  if (!isStartMessage(event.data)) {
    console.error('Bot process received an unrecognized startup message; ignoring.');
    return;
  }

  botService.start(event.data.token, event.data.presence).catch((error: unknown) => {
    console.error(`Failed to start bot: ${error instanceof Error ? error.message : String(error)}`);
  });
});

// Handles scan requests dispatched from main (see BotProcessManager.scan()), reacting VIEWED_EMOJI
// on each newly pulled post as it's found and posting the results back to main once done.
process.parentPort.on('message', (event) => {
  if (!isScanMessage(event.data)) {
    return;
  }

  botService
    .scan(event.data.forumChannelIds, { includeViewed: event.data.includeViewed })
    .then((posts: PulledPost[]) => {
      process.parentPort.postMessage({ type: 'scanResult', posts });
    })
    .catch((error: unknown) => {
      console.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
      process.parentPort.postMessage({ type: 'scanResult', posts: [] });
    });
});

// Handles sendRemark requests dispatched from main (see BotProcessManager.sendRemark()), posting the
// given text into the given thread via BotService.postMessage() — the same general capability 007
// (approve/decline) and 009 (post-issue notification) will call — and replying with a correlated result.
process.parentPort.on('message', (event) => {
  if (!isSendRemarkMessage(event.data)) {
    return;
  }

  const { requestId, threadId, text } = event.data;

  botService
    .postMessage(threadId, text)
    .then(() => {
      process.parentPort.postMessage({ type: 'remarkResult', requestId, ok: true });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to post message to thread ${threadId}: ${message}`);
      process.parentPort.postMessage({ type: 'remarkResult', requestId, ok: false, error: message });
    });
});

// Handles setStatus requests dispatched from main (see BotProcessManager.setStatus()), applying the
// ✅/❌ triage reaction via BotService.setStatus() (007) and replying with a correlated result. Does
// not itself send a remark — the renderer sends that separately via the sendRemark path above, after
// the reviewer has had a chance to edit the pre-filled text.
process.parentPort.on('message', (event) => {
  if (!isSetStatusMessage(event.data)) {
    return;
  }

  const { requestId, postId, starterMessageId, status } = event.data;

  botService
    .setStatus(postId, starterMessageId, status)
    .then(() => {
      process.parentPort.postMessage({ type: 'statusResult', requestId, ok: true });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to set status on post ${postId}: ${message}`);
      process.parentPort.postMessage({ type: 'statusResult', requestId, ok: false, error: message });
    });
});

// Handles getForumNames requests dispatched from main (see BotProcessManager.getForumNames()), used
// by the Forum Config settings page (003) to show real Discord forum names instead of raw channel
// IDs. Resolves each requested ID independently via BotService.getForumName() and omits any that
// can't be found/accessed from the returned map, rather than failing the whole batch.
process.parentPort.on('message', (event) => {
  if (!isGetForumNamesMessage(event.data)) {
    return;
  }

  const { requestId, forumChannelIds } = event.data;

  Promise.all(
    forumChannelIds.map(async (forumChannelId) => [forumChannelId, await botService.getForumName(forumChannelId)] as const)
  ).then((entries) => {
    const names: Record<string, string> = {};
    for (const [forumChannelId, name] of entries) {
      if (name) names[forumChannelId] = name;
    }
    process.parentPort.postMessage({ type: 'forumNamesResult', requestId, names });
  });
});

// Handles setPresence requests dispatched from main (see BotProcessManager.setPresence()), applying
// the reviewer's selected Discord presence (019) via BotService.setPresence() and replying with a
// correlated result. Independent of the automatic reapply-on-ready in botService.ts's `ready`
// handler — this path is only for reviewer-triggered, in-session changes.
process.parentPort.on('message', (event) => {
  if (!isSetPresenceMessage(event.data)) {
    return;
  }

  const { requestId, status, statusMessage } = event.data;

  botService
    .setPresence(status, statusMessage)
    .then(() => {
      process.parentPort.postMessage({ type: 'presenceResult', requestId, ok: true });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to set presence to "${status}": ${message}`);
      process.parentPort.postMessage({ type: 'presenceResult', requestId, ok: false, error: message });
    });
});
