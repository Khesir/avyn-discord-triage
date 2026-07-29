import { describe, expect, it, vi } from 'vitest';
import { createBotHandlers } from './botHandlers';
import type { ConfigStore, ForumRepoMapping } from '../store/configStore';
import type { BotProcessManager } from '../bot/botProcessManager';
import type { PulledPost } from '../../shared/ipcTypes';

/** Fake standing in for ConfigStore — see configHandlers.test.ts for the same pattern. */
function createFakeConfigStore(mappings: ForumRepoMapping[], pulledPosts: PulledPost[] = []) {
  return {
    getForumRepoMappings: vi.fn(() => mappings),
    getPulledPosts: vi.fn(() => pulledPosts),
    updatePulledPostStatus: vi.fn(),
    getBotPresence: vi.fn(() => ({ status: 'online', message: '' })),
    setBotPresence: vi.fn()
  } as unknown as ConfigStore;
}

/** Fake standing in for BotProcessManager — scan() is fire-and-forget, so we only need to observe the call. */
function createFakeBotProcessManager(isRunning = true) {
  return {
    scan: vi.fn(),
    sendRemark: vi.fn(),
    setStatus: vi.fn(),
    getStatus: vi.fn(() => ({ status: 'stopped' })),
    isRunning: vi.fn(() => isRunning),
    getForumNames: vi.fn(),
    setPresence: vi.fn()
  } as unknown as BotProcessManager;
}

const samplePulledPost: PulledPost = {
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

describe('createBotHandlers', () => {
  it('scan() triggers a bot process scan with every configured forum channel ID', async () => {
    const configStore = createFakeConfigStore([
      { forumChannelId: 'forum-1', repo: 'org/repo-a' },
      { forumChannelId: 'forum-2', repo: 'org/repo-b' }
    ]);
    const botProcessManager = createFakeBotProcessManager();
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.scan();

    expect(botProcessManager.scan).toHaveBeenCalledWith(['forum-1', 'forum-2'], false);
  });

  it('scan() resolves { ok: true } once the request is dispatched', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.scan()).resolves.toEqual({ ok: true });
  });

  it('scan() with no configured forums still dispatches a scan with an empty list', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.scan();

    expect(botProcessManager.scan).toHaveBeenCalledWith([], false);
  });

  it('scan() forwards includeViewed: true through to botProcessManager.scan', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: 'org/repo-a' }]);
    const botProcessManager = createFakeBotProcessManager();
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.scan({ includeViewed: true });

    expect(botProcessManager.scan).toHaveBeenCalledWith(['forum-1'], true);
  });

  it('scan() resolves { ok: false, error } and does not dispatch when the bot process is not running', async () => {
    const configStore = createFakeConfigStore([{ forumChannelId: 'forum-1', repo: 'org/repo-a' }]);
    const botProcessManager = createFakeBotProcessManager(false);
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.scan()).resolves.toEqual({ ok: false, error: expect.any(String) });
    expect(botProcessManager.scan).not.toHaveBeenCalled();
  });

  it('sendRemark() delegates to botProcessManager.sendRemark with the given thread ID and text', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.sendRemark as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.sendRemark('thread-1', 'Thanks for the report!');

    expect(botProcessManager.sendRemark).toHaveBeenCalledWith('thread-1', 'Thanks for the report!');
  });

  it('sendRemark() resolves with whatever botProcessManager.sendRemark resolves', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.sendRemark as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Thread not found.' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.sendRemark('thread-1', 'hello')).resolves.toEqual({ ok: false, error: 'Thread not found.' });
  });

  it('setStatus() delegates to botProcessManager.setStatus with the given post ID, starter message ID, and status', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setStatus('thread-1', 'msg-1', 'approved');

    expect(botProcessManager.setStatus).toHaveBeenCalledWith('thread-1', 'msg-1', 'approved');
  });

  it('setStatus() resolves with whatever botProcessManager.setStatus resolves', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Thread not found.' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.setStatus('thread-1', 'msg-1', 'declined')).resolves.toEqual({
      ok: false,
      error: 'Thread not found.'
    });
  });

  it("setStatus() persists the new status locally via ConfigStore once the Discord reaction succeeds, so it survives a refresh and powers the Triage list's filter", async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setStatus('thread-1', 'msg-1', 'approved');

    expect(configStore.updatePulledPostStatus).toHaveBeenCalledWith('thread-1', 'approved');
  });

  it('setStatus() does not persist locally when the Discord reaction fails', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Thread not found.' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setStatus('thread-1', 'msg-1', 'declined');

    expect(configStore.updatePulledPostStatus).not.toHaveBeenCalled();
  });

  it('getPulledPosts() returns whatever the ConfigStore has persisted', async () => {
    const configStore = createFakeConfigStore([], [samplePulledPost]);
    const botProcessManager = createFakeBotProcessManager();
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.getPulledPosts()).resolves.toEqual([samplePulledPost]);
  });

  it('getStatus() delegates to botProcessManager.getStatus', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'connected' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.getStatus()).resolves.toEqual({ status: 'connected' });
  });

  it('getForumNames() delegates to botProcessManager.getForumNames with the given forum channel IDs', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.getForumNames as ReturnType<typeof vi.fn>).mockResolvedValue({ 'forum-1': 'bug-reports' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.getForumNames(['forum-1'])).resolves.toEqual({ 'forum-1': 'bug-reports' });
    expect(botProcessManager.getForumNames).toHaveBeenCalledWith(['forum-1']);
  });

  it('setPresence() delegates to botProcessManager.setPresence with the given status and message', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setPresence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setPresence('idle', 'Away for a bit');

    expect(botProcessManager.setPresence).toHaveBeenCalledWith('idle', 'Away for a bit');
  });

  it('setPresence() resolves with whatever botProcessManager.setPresence resolves', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setPresence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Bot process is not running.' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.setPresence('online')).resolves.toEqual({ ok: false, error: 'Bot process is not running.' });
  });

  it('setPresence() persists the new presence via ConfigStore once the Discord update succeeds', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setPresence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setPresence('dnd', 'In review mode');

    expect(configStore.setBotPresence).toHaveBeenCalledWith({ status: 'dnd', message: 'In review mode' });
  });

  it('setPresence() persists an empty message when none is given', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setPresence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setPresence('online');

    expect(configStore.setBotPresence).toHaveBeenCalledWith({ status: 'online', message: '' });
  });

  it('setPresence() does not persist locally when the Discord update fails', async () => {
    const configStore = createFakeConfigStore([]);
    const botProcessManager = createFakeBotProcessManager();
    (botProcessManager.setPresence as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Bot process is not running.' });
    const handlers = createBotHandlers(botProcessManager, configStore);

    await handlers.setPresence('dnd', 'busy');

    expect(configStore.setBotPresence).not.toHaveBeenCalled();
  });

  it('getPresence() returns whatever ConfigStore has persisted', async () => {
    const configStore = createFakeConfigStore([]);
    (configStore.getBotPresence as ReturnType<typeof vi.fn>).mockReturnValue({ status: 'idle', message: 'brb' });
    const botProcessManager = createFakeBotProcessManager();
    const handlers = createBotHandlers(botProcessManager, configStore);

    await expect(handlers.getPresence()).resolves.toEqual({ status: 'idle', message: 'brb' });
  });
});
