import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createBotService, APPROVED_EMOJI, DECLINED_EMOJI, VIEWED_EMOJI } from './botService';
import type { ForumChannelLike, ForumPostLike, PostMessageLike, ThreadLike } from './botService';

/**
 * Fake standing in for discord.js's Client — this is the boundary the Bot
 * Service is written against (PRD Testing Decisions: "Bot Service ...
 * unit-tested against a faked discord.js client ... without a live Discord
 * connection"). A real EventEmitter lets tests trigger 'ready'/'error' the
 * same way discord.js would. `forums` seeds the channel-fetch boundary used
 * by scan().
 */
function createFakeDiscordClient(forums: Record<string, ForumChannelLike> = {}, threads: Record<string, ThreadLike> = {}) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    user: null as { tag: string } | null,
    login: vi.fn(async (_token: string) => {
      return 'fake-login-token';
    }),
    destroy: vi.fn(async () => {}),
    fetchForumChannel: vi.fn(async (forumChannelId: string) => forums[forumChannelId] ?? null),
    fetchThread: vi.fn(async (threadId: string) => threads[threadId] ?? null),
    setPresence: vi.fn(async (_status: string, _message: string) => {})
  });
}

/**
 * Fake standing in for a thread (a forum post's underlying channel) — the
 * target of postMessage() and, via fetchMessage(), setStatus(). `messages`
 * seeds the message-fetch boundary used by setStatus() to find the starter
 * message to react to.
 */
function createFakeThread(
  id: string,
  messages: Record<string, PostMessageLike> = {}
): ThreadLike & { send: ReturnType<typeof vi.fn>; fetchMessage: ReturnType<typeof vi.fn> } {
  return {
    id,
    send: vi.fn(async (_text: string) => {}),
    fetchMessage: vi.fn(async (messageId: string) => messages[messageId] ?? null)
  };
}

/** Fake standing in for a message (a forum post's starter message, or one of its replies). */
function createFakeMessage(options: {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  reactions?: string[];
  imageUrls?: string[];
}): PostMessageLike & { react: ReturnType<typeof vi.fn> } {
  const reactions = new Set(options.reactions ?? []);
  return {
    id: options.id,
    authorId: options.authorId,
    authorName: options.authorName,
    content: options.content,
    imageUrls: options.imageUrls ?? [],
    hasReaction: (emoji: string) => reactions.has(emoji),
    react: vi.fn(async (emoji: string) => {
      reactions.add(emoji);
    })
  };
}

/** Fake standing in for a forum post (a Discord thread within a forum channel). */
function createFakePost(options: {
  id: string;
  title: string;
  starterMessage: PostMessageLike;
  replies?: PostMessageLike[];
}): ForumPostLike {
  return {
    id: options.id,
    title: options.title,
    fetchStarterMessage: vi.fn(async () => options.starterMessage),
    fetchReplies: vi.fn(async () => options.replies ?? [])
  };
}

/** Fake standing in for a forum channel, holding a fixed set of posts (threads). */
function createFakeForumChannel(options: {
  id: string;
  guildId: string;
  posts: ForumPostLike[];
  name?: string;
}): ForumChannelLike {
  return {
    id: options.id,
    guildId: options.guildId,
    name: options.name ?? 'general',
    fetchPosts: vi.fn(async () => options.posts)
  };
}

describe('createBotService', () => {
  it('start() logs in to Discord with the given token', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.start('bot-token-123');

    expect(client.login).toHaveBeenCalledWith('bot-token-123');
  });

  it('logs a connect/ready line when the client emits "ready"', async () => {
    const client = createFakeDiscordClient();
    client.user = { tag: 'AvynBot#1234' };
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.start('bot-token-123');
    client.emit('ready');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('AvynBot#1234'));
  });

  it('logs connection errors when the client emits "error"', async () => {
    const client = createFakeDiscordClient();
    const logError = vi.fn();
    const botService = createBotService({ client, logError });

    await botService.start('bot-token-123');
    client.emit('error', new Error('connection reset'));

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
  });

  it('stop() destroys the underlying client', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.start('bot-token-123');
    await botService.stop();

    expect(client.destroy).toHaveBeenCalled();
  });
});

describe('createBotService — connection status', () => {
  it('reports "connecting" as soon as start() is called, before login resolves', () => {
    const client = createFakeDiscordClient();
    const onStatusChange = vi.fn();
    const botService = createBotService({ client, onStatusChange });

    void botService.start('bot-token-123');

    expect(onStatusChange).toHaveBeenCalledWith({ status: 'connecting' });
  });

  it('reports "connected" when the client emits "ready"', async () => {
    const client = createFakeDiscordClient();
    const onStatusChange = vi.fn();
    const botService = createBotService({ client, onStatusChange });

    await botService.start('bot-token-123');
    client.emit('ready');

    expect(onStatusChange).toHaveBeenCalledWith({ status: 'connected' });
  });

  it('reports "error" with the error message when the client emits "error"', async () => {
    const client = createFakeDiscordClient();
    const onStatusChange = vi.fn();
    const botService = createBotService({ client, onStatusChange });

    await botService.start('bot-token-123');
    client.emit('error', new Error('An invalid token was provided.'));

    expect(onStatusChange).toHaveBeenCalledWith({ status: 'error', error: 'An invalid token was provided.' });
  });

  it('reports "stopped" when stop() is called', async () => {
    const client = createFakeDiscordClient();
    const onStatusChange = vi.fn();
    const botService = createBotService({ client, onStatusChange });

    await botService.start('bot-token-123');
    await botService.stop();

    expect(onStatusChange).toHaveBeenCalledWith({ status: 'stopped' });
  });
});

describe('createBotService — scan', () => {
  it('pulls a post missing the 👀 reaction, including its post text', async () => {
    const starter = createFakeMessage({
      id: 'msg-1',
      authorId: 'user-1',
      authorName: 'Alice',
      content: 'Something is broken'
    });
    const post = createFakePost({ id: 'thread-1', title: 'Bug: something broken', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const pulled = await botService.scan(['forum-1']);

    expect(pulled).toEqual([
      {
        postId: 'thread-1',
        starterMessageId: 'msg-1',
        forumChannelId: 'forum-1',
        forumName: 'general',
        guildId: 'guild-1',
        title: 'Bug: something broken',
        author: { id: 'user-1', name: 'Alice' },
        content: 'Something is broken',
        imageUrls: [],
        replies: [],
        status: 'pending'
      }
    ]);
  });

  it('includes the forum channel\'s real Discord name, distinct from its ID', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const post = createFakePost({ id: 'thread-1', title: 'Post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post], name: 'bug-reports' });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const [pulled] = await botService.scan(['forum-1']);

    expect(pulled.forumChannelId).toBe('forum-1');
    expect(pulled.forumName).toBe('bug-reports');
  });

  it('includes image URLs from the starter message and each reply', async () => {
    const starter = createFakeMessage({
      id: 'msg-1',
      authorId: 'user-1',
      authorName: 'Alice',
      content: 'Check this out',
      imageUrls: ['https://cdn.discordapp.com/attachments/1/2/screenshot.png']
    });
    const reply = createFakeMessage({
      id: 'msg-2',
      authorId: 'user-2',
      authorName: 'Bob',
      content: 'Nice',
      imageUrls: ['https://cdn.discordapp.com/attachments/1/3/reaction.gif']
    });
    const post = createFakePost({ id: 'thread-1', title: 'Post with images', starterMessage: starter, replies: [reply] });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const [pulled] = await botService.scan(['forum-1']);

    expect(pulled.imageUrls).toEqual(['https://cdn.discordapp.com/attachments/1/2/screenshot.png']);
    expect(pulled.replies).toEqual([
      {
        author: { id: 'user-2', name: 'Bob' },
        content: 'Nice',
        imageUrls: ['https://cdn.discordapp.com/attachments/1/3/reaction.gif']
      }
    ]);
  });

  it('reacts 👀 on a pulled post immediately, before it is returned', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Help' });
    const post = createFakePost({ id: 'thread-1', title: 'Help post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    await botService.scan(['forum-1']);

    expect(starter.react).toHaveBeenCalledWith(VIEWED_EMOJI);
    expect(starter.hasReaction(VIEWED_EMOJI)).toBe(true);
  });

  it('skips posts already reacted 👀, and does not re-react or fetch their replies', async () => {
    const starter = createFakeMessage({
      id: 'msg-1',
      authorId: 'user-1',
      authorName: 'Alice',
      content: 'Already looked at this',
      reactions: [VIEWED_EMOJI]
    });
    const post = createFakePost({ id: 'thread-1', title: 'Already viewed', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const pulled = await botService.scan(['forum-1']);

    expect(pulled).toEqual([]);
    expect(starter.react).not.toHaveBeenCalled();
    expect(post.fetchReplies).not.toHaveBeenCalled();
  });

  it('includes all reply text in order, alongside the post', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Original post' });
    const reply1 = createFakeMessage({ id: 'msg-2', authorId: 'user-2', authorName: 'Bob', content: 'First reply' });
    const reply2 = createFakeMessage({ id: 'msg-3', authorId: 'user-3', authorName: 'Carol', content: 'Second reply' });
    const post = createFakePost({
      id: 'thread-1',
      title: 'Post with replies',
      starterMessage: starter,
      replies: [reply1, reply2]
    });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const [pulled] = await botService.scan(['forum-1']);

    expect(pulled.replies).toEqual([
      { author: { id: 'user-2', name: 'Bob' }, content: 'First reply', imageUrls: [] },
      { author: { id: 'user-3', name: 'Carol' }, content: 'Second reply', imageUrls: [] }
    ]);
  });

  it('sweeps every configured forum in one pass', async () => {
    const starterA = createFakeMessage({ id: 'msg-a', authorId: 'user-a', authorName: 'Ann', content: 'Post A' });
    const postA = createFakePost({ id: 'thread-a', title: 'Post A title', starterMessage: starterA });
    const forumA = createFakeForumChannel({ id: 'forum-a', guildId: 'guild-1', posts: [postA] });

    const starterB = createFakeMessage({ id: 'msg-b', authorId: 'user-b', authorName: 'Bo', content: 'Post B' });
    const postB = createFakePost({ id: 'thread-b', title: 'Post B title', starterMessage: starterB });
    const forumB = createFakeForumChannel({ id: 'forum-b', guildId: 'guild-2', posts: [postB] });

    const client = createFakeDiscordClient({ 'forum-a': forumA, 'forum-b': forumB });
    const botService = createBotService({ client });

    const pulled = await botService.scan(['forum-a', 'forum-b']);

    expect(pulled.map((p) => p.postId)).toEqual(['thread-a', 'thread-b']);
  });

  it('reacts to each unviewed post immediately as it is pulled, not batched after the whole scan', async () => {
    const callOrder: string[] = [];

    const starterA = createFakeMessage({ id: 'msg-a', authorId: 'user-a', authorName: 'Ann', content: 'Post A' });
    starterA.react.mockImplementation(async () => {
      callOrder.push('react:a');
    });
    const postA = createFakePost({ id: 'thread-a', title: 'Post A', starterMessage: starterA });
    (postA.fetchReplies as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('fetchReplies:a');
      return [];
    });

    const starterB = createFakeMessage({ id: 'msg-b', authorId: 'user-b', authorName: 'Bo', content: 'Post B' });
    starterB.react.mockImplementation(async () => {
      callOrder.push('react:b');
    });
    const postB = createFakePost({ id: 'thread-b', title: 'Post B', starterMessage: starterB });
    (postB.fetchReplies as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('fetchReplies:b');
      return [];
    });

    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [postA, postB] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    await botService.scan(['forum-1']);

    // Post A is fully reacted-and-pulled before post B's reaction happens — proves reactions
    // aren't collected and fired off together at the end of the scan.
    expect(callOrder).toEqual(['react:a', 'fetchReplies:a', 'react:b', 'fetchReplies:b']);
  });

  it('does not include attachment/embed data in the pulled-post payload — text only', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Check this image' });
    // Simulate a discord.js message that also carries attachment/embed data the fake interface doesn't model.
    Object.assign(starter, { attachments: ['https://cdn.discord.com/image.png'], embeds: [{ title: 'preview' }] });
    const post = createFakePost({ id: 'thread-1', title: 'Post with an image', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const [pulled] = await botService.scan(['forum-1']);

    expect(Object.keys(pulled)).toEqual([
      'postId',
      'starterMessageId',
      'forumChannelId',
      'forumName',
      'guildId',
      'title',
      'author',
      'content',
      'imageUrls',
      'replies',
      'status'
    ]);
    expect(pulled).not.toHaveProperty('attachments');
    expect(pulled).not.toHaveProperty('embeds');
  });

  it('re-scanning does not re-pull an already-viewed post', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const post = createFakePost({ id: 'thread-1', title: 'Post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const firstScan = await botService.scan(['forum-1']);
    const secondScan = await botService.scan(['forum-1']);

    expect(firstScan).toHaveLength(1);
    expect(secondScan).toEqual([]);
  });

  it('with includeViewed: true, re-pulls an already-viewed post instead of skipping it', async () => {
    const starter = createFakeMessage({
      id: 'msg-1',
      authorId: 'user-1',
      authorName: 'Alice',
      content: 'Post',
      reactions: [VIEWED_EMOJI]
    });
    const post = createFakePost({ id: 'thread-1', title: 'Already-viewed post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    const pulled = await botService.scan(['forum-1'], { includeViewed: true });

    expect(pulled.map((p) => p.postId)).toEqual(['thread-1']);
  });

  it('with includeViewed: true, does not re-react to a post that already has 👀', async () => {
    const starter = createFakeMessage({
      id: 'msg-1',
      authorId: 'user-1',
      authorName: 'Alice',
      content: 'Post',
      reactions: [VIEWED_EMOJI]
    });
    const post = createFakePost({ id: 'thread-1', title: 'Already-viewed post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    await botService.scan(['forum-1'], { includeViewed: true });

    expect(starter.react).not.toHaveBeenCalled();
  });

  it('with includeViewed: true, still reacts to a genuinely new post that has no 👀 yet', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const post = createFakePost({ id: 'thread-1', title: 'New post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    await botService.scan(['forum-1'], { includeViewed: true });

    expect(starter.react).toHaveBeenCalledWith(VIEWED_EMOJI);
  });

  it('logs a summary line when the scan starts, naming how many forums it will sweep', async () => {
    const client = createFakeDiscordClient();
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.scan(['forum-1', 'forum-2']);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/scanning 2 forums?/i));
  });

  it('logs a summary line when the scan completes, naming how many posts were pulled', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const post = createFakePost({ id: 'thread-1', title: 'Post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.scan(['forum-1']);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/scan complete.*1 new post/i));
  });

  it('logs a "0 new posts" completion summary when nothing new is found', async () => {
    const client = createFakeDiscordClient();
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.scan([]);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/scan complete.*0 new posts/i));
  });

  it('skips a forum channel that cannot be found and continues scanning others', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const post = createFakePost({ id: 'thread-1', title: 'Post', starterMessage: starter });
    const forum = createFakeForumChannel({ id: 'forum-2', guildId: 'guild-1', posts: [post] });
    const client = createFakeDiscordClient({ 'forum-2': forum });
    const logError = vi.fn();
    const botService = createBotService({ client, logError });

    const pulled = await botService.scan(['missing-forum', 'forum-2']);

    expect(pulled.map((p) => p.postId)).toEqual(['thread-1']);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('missing-forum'));
  });
});

describe('createBotService — postMessage', () => {
  it('sends the given text to the thread with the given ID', async () => {
    const thread = createFakeThread('thread-1');
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const botService = createBotService({ client });

    await botService.postMessage('thread-1', 'Thanks for the report!');

    expect(thread.send).toHaveBeenCalledWith('Thanks for the report!');
  });

  it('rejects when the thread cannot be found or accessed', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await expect(botService.postMessage('missing-thread', 'hello')).rejects.toThrow(/missing-thread/);
  });

  it('logs a confirmation line once the message is posted', async () => {
    const thread = createFakeThread('thread-1');
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.postMessage('thread-1', 'Thanks for the report!');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('thread-1'));
  });
});

describe('createBotService — setStatus', () => {
  it('applies ✅ to the starter message when status is "approved"', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const thread = createFakeThread('thread-1', { 'msg-1': starter });
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const botService = createBotService({ client });

    await botService.setStatus('thread-1', 'msg-1', 'approved');

    expect(starter.react).toHaveBeenCalledWith(APPROVED_EMOJI);
  });

  it('applies ❌ to the starter message when status is "declined"', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const thread = createFakeThread('thread-1', { 'msg-1': starter });
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const botService = createBotService({ client });

    await botService.setStatus('thread-1', 'msg-1', 'declined');

    expect(starter.react).toHaveBeenCalledWith(DECLINED_EMOJI);
  });

  it('targets only the given message ID within the thread, not any other message in it', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const reply = createFakeMessage({ id: 'msg-2', authorId: 'user-2', authorName: 'Bob', content: 'A reply' });
    const thread = createFakeThread('thread-1', { 'msg-1': starter, 'msg-2': reply });
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const botService = createBotService({ client });

    await botService.setStatus('thread-1', 'msg-1', 'approved');

    expect(starter.react).toHaveBeenCalledWith(APPROVED_EMOJI);
    expect(reply.react).not.toHaveBeenCalled();
  });

  it('rejects when the thread cannot be found or accessed', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await expect(botService.setStatus('missing-thread', 'msg-1', 'approved')).rejects.toThrow(/missing-thread/);
  });

  it('rejects when the message cannot be found in the thread', async () => {
    const thread = createFakeThread('thread-1');
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const botService = createBotService({ client });

    await expect(botService.setStatus('thread-1', 'missing-msg', 'approved')).rejects.toThrow(/missing-msg/);
  });

  it('logs a confirmation line once the reaction is applied', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const thread = createFakeThread('thread-1', { 'msg-1': starter });
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.setStatus('thread-1', 'msg-1', 'approved');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('thread-1'));
  });

  it('setStatus and postMessage both reach the same faked client — reaction and remark can both land on approve', async () => {
    const starter = createFakeMessage({ id: 'msg-1', authorId: 'user-1', authorName: 'Alice', content: 'Post' });
    const thread = createFakeThread('thread-1', { 'msg-1': starter });
    const client = createFakeDiscordClient({}, { 'thread-1': thread });
    const botService = createBotService({ client });

    await botService.setStatus('thread-1', 'msg-1', 'approved');
    await botService.postMessage('thread-1', 'Thanks for the report!');

    expect(starter.react).toHaveBeenCalledWith(APPROVED_EMOJI);
    expect(thread.send).toHaveBeenCalledWith('Thanks for the report!');
  });
});

describe('createBotService — setPresence', () => {
  it('sets the given presence status and message on the underlying client', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.setPresence('idle', 'Away for a bit');

    expect(client.setPresence).toHaveBeenCalledWith('idle', 'Away for a bit');
  });

  it('defaults the status message to an empty string when none is given', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.setPresence('dnd');

    expect(client.setPresence).toHaveBeenCalledWith('dnd', '');
  });

  it('supports all four presence statuses', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.setPresence('online');
    await botService.setPresence('idle');
    await botService.setPresence('dnd');
    await botService.setPresence('invisible');

    expect(client.setPresence).toHaveBeenNthCalledWith(1, 'online', '');
    expect(client.setPresence).toHaveBeenNthCalledWith(2, 'idle', '');
    expect(client.setPresence).toHaveBeenNthCalledWith(3, 'dnd', '');
    expect(client.setPresence).toHaveBeenNthCalledWith(4, 'invisible', '');
  });

  it('logs a confirmation line once the presence is applied', async () => {
    const client = createFakeDiscordClient();
    const log = vi.fn();
    const botService = createBotService({ client, log });

    await botService.setPresence('online', 'Reviewing posts');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('online'));
  });
});

describe('createBotService — presence auto-reapply on ready', () => {
  it('applies the default presence (online, no message) on ready when start() was called without one', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.start('bot-token-123');
    client.emit('ready');

    expect(client.setPresence).toHaveBeenCalledWith('online', '');
  });

  it('applies whatever presence was passed to start() once the client emits ready', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.start('bot-token-123', { status: 'dnd', message: 'In review mode' });
    client.emit('ready');

    expect(client.setPresence).toHaveBeenCalledWith('dnd', 'In review mode');
  });

  it('does not apply any presence before ready fires', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await botService.start('bot-token-123', { status: 'idle', message: 'brb' });

    expect(client.setPresence).not.toHaveBeenCalled();
  });
});

describe('createBotService — getForumName', () => {
  it("resolves the forum channel's real Discord name", async () => {
    const forum = createFakeForumChannel({ id: 'forum-1', guildId: 'guild-1', posts: [], name: 'bug-reports' });
    const client = createFakeDiscordClient({ 'forum-1': forum });
    const botService = createBotService({ client });

    await expect(botService.getForumName('forum-1')).resolves.toBe('bug-reports');
  });

  it('resolves null when the forum channel cannot be found or accessed', async () => {
    const client = createFakeDiscordClient();
    const botService = createBotService({ client });

    await expect(botService.getForumName('missing-forum')).resolves.toBeNull();
  });
});
