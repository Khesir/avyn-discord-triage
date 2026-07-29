import { describe, expect, it, vi } from 'vitest';
import { createBotApi } from './botApi';
import { BOT_LOG_CHANNEL, BOT_PULLED_POSTS_CHANNEL, BOT_STATUS_CHANNEL } from '../shared/ipcTypes';
import type { BotLogLine, BotStatusEvent, PulledPost } from '../shared/ipcTypes';

/**
 * Fake standing in for Electron's `ipcRenderer` — this is the boundary the
 * preload-side Bot API contract is written against. Verifies the main ->
 * renderer log-line-forwarding contract: the channel name both sides agree
 * on, and that the payload handed to `on()` is forwarded to the renderer
 * callback unmodified (see also botProcessManager.test.ts, which verifies
 * main constructs payloads in this same shape).
 */
function createFakeIpcRenderer() {
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  return {
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    }),
    removeListener: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(listener);
    }),
    invoke: vi.fn(async (_channel: string, ..._args: unknown[]): Promise<unknown> => ({ ok: true as const })),
    emit(channel: string, ...args: unknown[]) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, ...args);
      }
    },
    listenerCount(channel: string) {
      return listeners.get(channel)?.size ?? 0;
    }
  };
}

describe('createBotApi (preload)', () => {
  it('onLog() subscribes to the shared bot log channel', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    botApi.onLog(vi.fn());

    expect(ipcRenderer.on).toHaveBeenCalledWith(BOT_LOG_CHANNEL, expect.any(Function));
  });

  it('forwards the log line payload to the renderer callback unmodified', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);
    const callback = vi.fn();
    botApi.onLog(callback);

    const line: BotLogLine = { stream: 'stdout', text: 'Bot ready.\n' };
    ipcRenderer.emit(BOT_LOG_CHANNEL, line);

    expect(callback).toHaveBeenCalledWith(line);
  });

  it('the returned unsubscribe function stops further callbacks', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);
    const callback = vi.fn();
    const unsubscribe = botApi.onLog(callback);

    unsubscribe();
    ipcRenderer.emit(BOT_LOG_CHANNEL, { stream: 'stdout', text: 'after unsubscribe\n' });

    expect(callback).not.toHaveBeenCalled();
    expect(ipcRenderer.listenerCount(BOT_LOG_CHANNEL)).toBe(0);
  });

  it('scan() invokes the bot:scan channel and resolves its result', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.scan()).resolves.toEqual({ ok: true });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:scan', undefined);
  });

  it('scan() forwards includeViewed through to the bot:scan channel', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    await botApi.scan({ includeViewed: true });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:scan', { includeViewed: true });
  });

  it('getPulledPosts() invokes the bot:getPulledPosts channel and resolves its result', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const post: PulledPost = {
      postId: 'thread-1',
      starterMessageId: 'msg-1',
      forumChannelId: 'forum-1',
      forumName: 'general',
      guildId: 'guild-1',
      title: 'A post',
      author: { id: 'user-1', name: 'Alice' },
      content: 'Post text',
      imageUrls: [],
      replies: [],
      status: 'pending'
    };
    ipcRenderer.invoke.mockResolvedValueOnce([post]);
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.getPulledPosts()).resolves.toEqual([post]);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:getPulledPosts');
  });

  it('scan() resolves with an error result returned over IPC (e.g. bot process not running)', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ ok: false, error: 'Bot process is not running.' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.scan()).resolves.toEqual({ ok: false, error: 'Bot process is not running.' });
  });

  it('onPulledPosts() subscribes to the shared pulled-posts channel', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    botApi.onPulledPosts(vi.fn());

    expect(ipcRenderer.on).toHaveBeenCalledWith(BOT_PULLED_POSTS_CHANNEL, expect.any(Function));
  });

  it('forwards the pulled-posts payload to the renderer callback unmodified', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);
    const callback = vi.fn();
    botApi.onPulledPosts(callback);

    const posts: PulledPost[] = [
      {
        postId: 'thread-1',
        starterMessageId: 'msg-1',
        forumChannelId: 'forum-1',
        forumName: 'general',
        guildId: 'guild-1',
        title: 'A post',
        author: { id: 'user-1', name: 'Alice' },
        content: 'Post text',
        imageUrls: [],
        replies: [],
        status: 'pending'
      }
    ];
    ipcRenderer.emit(BOT_PULLED_POSTS_CHANNEL, posts);

    expect(callback).toHaveBeenCalledWith(posts);
  });

  it('the returned unsubscribe function from onPulledPosts stops further callbacks', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);
    const callback = vi.fn();
    const unsubscribe = botApi.onPulledPosts(callback);

    unsubscribe();
    ipcRenderer.emit(BOT_PULLED_POSTS_CHANNEL, []);

    expect(callback).not.toHaveBeenCalled();
    expect(ipcRenderer.listenerCount(BOT_PULLED_POSTS_CHANNEL)).toBe(0);
  });

  it('sendRemark() invokes the bot:sendRemark channel with the thread ID and text', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    await botApi.sendRemark('thread-1', 'Thanks for the report!');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:sendRemark', 'thread-1', 'Thanks for the report!');
  });

  it('sendRemark() resolves with the result returned over IPC', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ ok: false, error: 'Thread not found.' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.sendRemark('thread-1', 'hello')).resolves.toEqual({ ok: false, error: 'Thread not found.' });
  });

  it('setStatus() invokes the bot:setStatus channel with the post ID, starter message ID, and status', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    await botApi.setStatus('thread-1', 'msg-1', 'approved');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:setStatus', 'thread-1', 'msg-1', 'approved');
  });

  it('setStatus() resolves with the result returned over IPC', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ ok: false, error: 'Thread not found.' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.setStatus('thread-1', 'msg-1', 'declined')).resolves.toEqual({
      ok: false,
      error: 'Thread not found.'
    });
  });

  it('getStatus() invokes the bot:getStatus channel and resolves its result', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ status: 'connected' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.getStatus()).resolves.toEqual({ status: 'connected' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:getStatus');
  });

  it('onStatus() subscribes to the shared bot status channel', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    botApi.onStatus(vi.fn());

    expect(ipcRenderer.on).toHaveBeenCalledWith(BOT_STATUS_CHANNEL, expect.any(Function));
  });

  it('forwards the status event payload to the renderer callback unmodified', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);
    const callback = vi.fn();
    botApi.onStatus(callback);

    const event: BotStatusEvent = { status: 'error', error: 'An invalid token was provided.' };
    ipcRenderer.emit(BOT_STATUS_CHANNEL, event);

    expect(callback).toHaveBeenCalledWith(event);
  });

  it('the returned unsubscribe function from onStatus stops further callbacks', () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);
    const callback = vi.fn();
    const unsubscribe = botApi.onStatus(callback);

    unsubscribe();
    ipcRenderer.emit(BOT_STATUS_CHANNEL, { status: 'connected' });

    expect(callback).not.toHaveBeenCalled();
    expect(ipcRenderer.listenerCount(BOT_STATUS_CHANNEL)).toBe(0);
  });

  it('getForumNames() invokes the bot:getForumNames channel with the given IDs and resolves its result', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ 'forum-1': 'bug-reports' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.getForumNames(['forum-1'])).resolves.toEqual({ 'forum-1': 'bug-reports' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:getForumNames', ['forum-1']);
  });

  it('setPresence() invokes the bot:setPresence channel with the status and status message', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    const botApi = createBotApi(ipcRenderer);

    await botApi.setPresence('idle', 'Away for a bit');

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:setPresence', 'idle', 'Away for a bit');
  });

  it('setPresence() resolves with the result returned over IPC', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ ok: false, error: 'Bot process is not running.' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.setPresence('online')).resolves.toEqual({ ok: false, error: 'Bot process is not running.' });
  });

  it('getPresence() invokes the bot:getPresence channel and resolves its result', async () => {
    const ipcRenderer = createFakeIpcRenderer();
    ipcRenderer.invoke.mockResolvedValueOnce({ status: 'dnd', message: 'In review mode' });
    const botApi = createBotApi(ipcRenderer);

    await expect(botApi.getPresence()).resolves.toEqual({ status: 'dnd', message: 'In review mode' });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('bot:getPresence');
  });
});
