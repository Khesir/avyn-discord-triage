import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BotProcessManager } from './botProcessManager';
import type { ForkedBotProcess } from './botProcessManager';

/**
 * Fake standing in for the Electron `UtilityProcess` returned by
 * `utilityProcess.fork(..., { stdio: 'pipe' })`. Real stdout/stderr are
 * Node Readable streams; a plain EventEmitter is enough to simulate 'data'
 * chunks for these tests.
 */
function createFakeForkedProcess(): ForkedBotProcess & { stdout: EventEmitter; stderr: EventEmitter; emit: EventEmitter['emit'] } {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    postMessage: vi.fn(),
    kill: vi.fn(() => true)
  });
}

describe('BotProcessManager', () => {
  it('start() forks the bot process using the injected fork function', () => {
    const child = createFakeForkedProcess();
    const fork = vi.fn(() => child);
    const manager = new BotProcessManager({ fork, onLog: vi.fn() });

    manager.start('bot-token-123');

    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('start() sends the bot token to the forked process via postMessage', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');

    expect(child.postMessage).toHaveBeenCalledWith({ type: 'start', token: 'bot-token-123' });
  });

  it('start() is idempotent — calling it again while already running does not fork a second process', () => {
    const child = createFakeForkedProcess();
    const fork = vi.fn(() => child);
    const manager = new BotProcessManager({ fork, onLog: vi.fn() });

    manager.start('bot-token-123');
    manager.start('bot-token-123');

    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('forwards stdout chunks to onLog as { stream: "stdout", text }', () => {
    const child = createFakeForkedProcess();
    const onLog = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog });

    manager.start('bot-token-123');
    child.stdout.emit('data', Buffer.from('Bot ready — logged in as AvynBot#1234.\n'));

    expect(onLog).toHaveBeenCalledWith({ stream: 'stdout', text: 'Bot ready — logged in as AvynBot#1234.\n' });
  });

  it('forwards stderr chunks to onLog as { stream: "stderr", text }', () => {
    const child = createFakeForkedProcess();
    const onLog = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog });

    manager.start('bot-token-123');
    child.stderr.emit('data', Buffer.from('Discord client error: connection reset\n'));

    expect(onLog).toHaveBeenCalledWith({
      stream: 'stderr',
      text: 'Discord client error: connection reset\n'
    });
  });

  it('stop() kills the forked process', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    manager.stop();

    expect(child.kill).toHaveBeenCalled();
  });

  it('stop() when never started is a no-op and does not throw', () => {
    const manager = new BotProcessManager({ fork: vi.fn(), onLog: vi.fn() });

    expect(() => manager.stop()).not.toThrow();
  });

  it('isRunning() reflects whether the process has been started/stopped', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    expect(manager.isRunning()).toBe(false);

    manager.start('bot-token-123');
    expect(manager.isRunning()).toBe(true);

    manager.stop();
    expect(manager.isRunning()).toBe(false);
  });

  it('scan() posts a scan request with the given forum channel IDs to the forked process', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    manager.scan(['forum-1', 'forum-2']);

    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'scan',
      forumChannelIds: ['forum-1', 'forum-2'],
      includeViewed: false
    });
  });

  it('scan() forwards includeViewed: true to the forked process when requested', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    manager.scan(['forum-1'], true);

    expect(child.postMessage).toHaveBeenCalledWith({ type: 'scan', forumChannelIds: ['forum-1'], includeViewed: true });
  });

  it('scan() is a no-op when the process has not been started', () => {
    const fork = vi.fn();
    const manager = new BotProcessManager({ fork, onLog: vi.fn() });

    expect(() => manager.scan(['forum-1'])).not.toThrow();
    expect(fork).not.toHaveBeenCalled();
  });

  it('forwards a scan-result message from the child to onPulledPosts', () => {
    const child = createFakeForkedProcess();
    const onPulledPosts = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn(), onPulledPosts });

    manager.start('bot-token-123');
    const posts = [
      {
        postId: 'thread-1',
        starterMessageId: 'msg-1',
        forumChannelId: 'forum-1',
        guildId: 'guild-1',
        title: 'A post',
        author: { id: 'user-1', name: 'Alice' },
        content: 'Post text',
        imageUrls: [],
        replies: []
      }
    ];
    child.emit('message', { type: 'scanResult', posts });

    expect(onPulledPosts).toHaveBeenCalledWith(posts);
  });

  it('ignores unrecognized messages from the child without calling onPulledPosts', () => {
    const child = createFakeForkedProcess();
    const onPulledPosts = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn(), onPulledPosts });

    manager.start('bot-token-123');
    child.emit('message', { type: 'somethingElse' });

    expect(onPulledPosts).not.toHaveBeenCalled();
  });

  it('sendRemark() posts a sendRemark request with the thread ID and text to the forked process', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    void manager.sendRemark('thread-1', 'Thanks for the report!');

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sendRemark', threadId: 'thread-1', text: 'Thanks for the report!' })
    );
  });

  it('sendRemark() resolves { ok: true } once the child confirms the message was posted', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.sendRemark('thread-1', 'Thanks for the report!');
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', { type: 'remarkResult', requestId: request.requestId, ok: true });

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('sendRemark() resolves { ok: false, error } when the child reports a failure', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.sendRemark('missing-thread', 'hello');
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', { type: 'remarkResult', requestId: request.requestId, ok: false, error: 'Thread missing-thread could not be found or accessed.' });

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: 'Thread missing-thread could not be found or accessed.'
    });
  });

  it('sendRemark() resolves { ok: false } immediately when the process has not been started', async () => {
    const manager = new BotProcessManager({ fork: vi.fn(), onLog: vi.fn() });

    await expect(manager.sendRemark('thread-1', 'hello')).resolves.toEqual({
      ok: false,
      error: expect.any(String)
    });
  });

  it('setStatus() posts a setStatus request with postId, starterMessageId, and status to the forked process', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    void manager.setStatus('thread-1', 'msg-1', 'approved');

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setStatus', postId: 'thread-1', starterMessageId: 'msg-1', status: 'approved' })
    );
  });

  it('setStatus() resolves { ok: true } once the child confirms the reaction was applied', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.setStatus('thread-1', 'msg-1', 'approved');
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', { type: 'statusResult', requestId: request.requestId, ok: true });

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('setStatus() resolves { ok: false, error } when the child reports a failure', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.setStatus('missing-thread', 'msg-1', 'declined');
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', {
      type: 'statusResult',
      requestId: request.requestId,
      ok: false,
      error: 'Thread missing-thread could not be found or accessed.'
    });

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: 'Thread missing-thread could not be found or accessed.'
    });
  });

  it('setStatus() resolves { ok: false } immediately when the process has not been started', async () => {
    const manager = new BotProcessManager({ fork: vi.fn(), onLog: vi.fn() });

    await expect(manager.setStatus('thread-1', 'msg-1', 'approved')).resolves.toEqual({
      ok: false,
      error: expect.any(String)
    });
  });

  it('setStatus() correlates concurrent requests to their own responses, not to each other', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const firstPromise = manager.setStatus('thread-1', 'msg-1', 'approved');
    const secondPromise = manager.setStatus('thread-2', 'msg-2', 'declined');
    const [firstRequest, secondRequest] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.slice(-2).map((call) => call[0]);

    child.emit('message', { type: 'statusResult', requestId: secondRequest.requestId, ok: true });
    child.emit('message', { type: 'statusResult', requestId: firstRequest.requestId, ok: false, error: 'boom' });

    await expect(secondPromise).resolves.toEqual({ ok: true });
    await expect(firstPromise).resolves.toEqual({ ok: false, error: 'boom' });
  });

  it('start() immediately reports a "connecting" status via onStatus', () => {
    const child = createFakeForkedProcess();
    const onStatus = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn(), onStatus });

    manager.start('bot-token-123');

    expect(onStatus).toHaveBeenCalledWith({ status: 'connecting' });
  });

  it('forwards a status message from the child to onStatus', () => {
    const child = createFakeForkedProcess();
    const onStatus = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn(), onStatus });

    manager.start('bot-token-123');
    child.emit('message', { type: 'status', status: 'connected' });

    expect(onStatus).toHaveBeenCalledWith({ status: 'connected' });
  });

  it('forwards an error status with its message from the child to onStatus', () => {
    const child = createFakeForkedProcess();
    const onStatus = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn(), onStatus });

    manager.start('bot-token-123');
    child.emit('message', { type: 'status', status: 'error', error: 'An invalid token was provided.' });

    expect(onStatus).toHaveBeenCalledWith({ status: 'error', error: 'An invalid token was provided.' });
  });

  it('stop() reports a "stopped" status via onStatus', () => {
    const child = createFakeForkedProcess();
    const onStatus = vi.fn();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn(), onStatus });

    manager.start('bot-token-123');
    manager.stop();

    expect(onStatus).toHaveBeenCalledWith({ status: 'stopped' });
  });

  it('getStatus() defaults to "stopped" before start() has ever been called', () => {
    const manager = new BotProcessManager({ fork: vi.fn(), onLog: vi.fn() });

    expect(manager.getStatus()).toEqual({ status: 'stopped' });
  });

  it('getStatus() reflects the most recently reported status', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    expect(manager.getStatus()).toEqual({ status: 'connecting' });

    child.emit('message', { type: 'status', status: 'connected' });
    expect(manager.getStatus()).toEqual({ status: 'connected' });
  });

  it('setStatus() and sendRemark() responses are not cross-correlated with each other', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const remarkPromise = manager.sendRemark('thread-1', 'hello');
    const statusPromise = manager.setStatus('thread-1', 'msg-1', 'approved');
    const calls = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.slice(-2);
    const remarkRequest = calls.find((call) => call[0].type === 'sendRemark')![0];
    const statusRequest = calls.find((call) => call[0].type === 'setStatus')![0];

    child.emit('message', { type: 'statusResult', requestId: statusRequest.requestId, ok: true });
    child.emit('message', { type: 'remarkResult', requestId: remarkRequest.requestId, ok: true });

    await expect(statusPromise).resolves.toEqual({ ok: true });
    await expect(remarkPromise).resolves.toEqual({ ok: true });
  });

  it('sendRemark() correlates concurrent requests to their own responses, not to each other', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const firstPromise = manager.sendRemark('thread-1', 'first');
    const secondPromise = manager.sendRemark('thread-2', 'second');
    const [firstRequest, secondRequest] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.slice(-2).map((call) => call[0]);

    // Resolve out of order — second request's response arrives first.
    child.emit('message', { type: 'remarkResult', requestId: secondRequest.requestId, ok: true });
    child.emit('message', { type: 'remarkResult', requestId: firstRequest.requestId, ok: false, error: 'boom' });

    await expect(secondPromise).resolves.toEqual({ ok: true });
    await expect(firstPromise).resolves.toEqual({ ok: false, error: 'boom' });
  });

  it('getForumNames() posts a getForumNames request with the given forum channel IDs to the forked process', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    void manager.getForumNames(['forum-1', 'forum-2']);

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'getForumNames', forumChannelIds: ['forum-1', 'forum-2'] })
    );
  });

  it('getForumNames() resolves with the name map the child sends back', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.getForumNames(['forum-1']);
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', { type: 'forumNamesResult', requestId: request.requestId, names: { 'forum-1': 'bug-reports' } });

    await expect(resultPromise).resolves.toEqual({ 'forum-1': 'bug-reports' });
  });

  it('getForumNames() resolves with an empty map immediately when the process has not been started', async () => {
    const manager = new BotProcessManager({ fork: vi.fn(), onLog: vi.fn() });

    await expect(manager.getForumNames(['forum-1'])).resolves.toEqual({});
  });

  it('start() forwards the given presence to the forked process alongside the token', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123', { status: 'dnd', message: 'In review mode' });

    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'start',
      token: 'bot-token-123',
      presence: { status: 'dnd', message: 'In review mode' }
    });
  });

  it('start() forwards undefined presence when none is given, leaving the child to default it', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');

    expect(child.postMessage).toHaveBeenCalledWith({ type: 'start', token: 'bot-token-123', presence: undefined });
  });

  it('setPresence() posts a setPresence request with status and statusMessage to the forked process', () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    void manager.setPresence('idle', 'Away for a bit');

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'setPresence', status: 'idle', statusMessage: 'Away for a bit' })
    );
  });

  it('setPresence() resolves { ok: true } once the child confirms the presence was applied', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.setPresence('online');
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', { type: 'presenceResult', requestId: request.requestId, ok: true });

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('setPresence() resolves { ok: false, error } when the child reports a failure', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const resultPromise = manager.setPresence('dnd', 'busy');
    const [request] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    child.emit('message', { type: 'presenceResult', requestId: request.requestId, ok: false, error: 'Bot user is not available yet.' });

    await expect(resultPromise).resolves.toEqual({ ok: false, error: 'Bot user is not available yet.' });
  });

  it('setPresence() resolves { ok: false } immediately when the process has not been started', async () => {
    const manager = new BotProcessManager({ fork: vi.fn(), onLog: vi.fn() });

    await expect(manager.setPresence('online')).resolves.toEqual({ ok: false, error: expect.any(String) });
  });

  it('setPresence() correlates concurrent requests to their own responses, not to each other', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const firstPromise = manager.setPresence('online');
    const secondPromise = manager.setPresence('idle');
    const [firstRequest, secondRequest] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.slice(-2).map((call) => call[0]);

    child.emit('message', { type: 'presenceResult', requestId: secondRequest.requestId, ok: true });
    child.emit('message', { type: 'presenceResult', requestId: firstRequest.requestId, ok: false, error: 'boom' });

    await expect(secondPromise).resolves.toEqual({ ok: true });
    await expect(firstPromise).resolves.toEqual({ ok: false, error: 'boom' });
  });

  it('getForumNames() correlates concurrent requests to their own responses, not to each other', async () => {
    const child = createFakeForkedProcess();
    const manager = new BotProcessManager({ fork: () => child, onLog: vi.fn() });

    manager.start('bot-token-123');
    const firstPromise = manager.getForumNames(['forum-1']);
    const secondPromise = manager.getForumNames(['forum-2']);
    const [firstRequest, secondRequest] = (child.postMessage as ReturnType<typeof vi.fn>).mock.calls.slice(-2).map((call) => call[0]);

    child.emit('message', { type: 'forumNamesResult', requestId: secondRequest.requestId, names: { 'forum-2': 'feature-requests' } });
    child.emit('message', { type: 'forumNamesResult', requestId: firstRequest.requestId, names: { 'forum-1': 'bug-reports' } });

    await expect(secondPromise).resolves.toEqual({ 'forum-2': 'feature-requests' });
    await expect(firstPromise).resolves.toEqual({ 'forum-1': 'bug-reports' });
  });
});
