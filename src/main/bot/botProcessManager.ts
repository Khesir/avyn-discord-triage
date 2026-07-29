import type {
  BotLogLine,
  BotPresence,
  BotStatusEvent,
  PresenceStatus,
  PulledPost,
  SendRemarkResult,
  SetPresenceResult,
  SetStatusResult,
  TriageStatus
} from '../../shared/ipcTypes';

/** Minimal structural subset of a Node Readable stream — just enough to listen for 'data' chunks. */
export interface ReadableLike {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
}

/**
 * Structural subset of Electron's `UtilityProcess` (as returned by
 * `utilityProcess.fork(modulePath, args, { stdio: 'pipe' })`) that
 * BotProcessManager depends on. Kept minimal and Electron-import-free so
 * this module — and its tests — don't need a live Electron runtime; the
 * real UtilityProcess satisfies this shape structurally. `on('message', ...)`
 * is how the child (botProcess.ts) sends structured data back to main via
 * `process.parentPort.postMessage()` — used here for scan results.
 */
export interface ForkedBotProcess {
  readonly stdout: ReadableLike | null;
  readonly stderr: ReadableLike | null;
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  kill(): boolean;
}

export interface BotProcessManagerOptions {
  /** Forks the bot's utility process. Injected so tests can supply a fake process without a live Electron runtime. */
  fork: () => ForkedBotProcess;
  /** Called for each stdout/stderr chunk from the bot process, to forward into the renderer's live log console. */
  onLog: (line: BotLogLine) => void;
  /** Called with the pulled posts from a completed scan, to forward into the renderer's post list. */
  onPulledPosts?: (posts: PulledPost[]) => void;
  /** Called whenever the bot's Discord connection status changes, to forward into the renderer's status indicator. */
  onStatus?: (event: BotStatusEvent) => void;
}

/** A scan-result message the child process posts back once a scan() completes (see botProcess.ts). */
type ScanResultMessage = { type: 'scanResult'; posts: PulledPost[] };

function isScanResultMessage(message: unknown): message is ScanResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'scanResult' &&
    Array.isArray((message as { posts?: unknown }).posts)
  );
}

/** A remark-result message the child process posts back once a sendRemark() request completes (see botProcess.ts). */
type RemarkResultMessage = { type: 'remarkResult'; requestId: string; ok: boolean; error?: string };

function isRemarkResultMessage(message: unknown): message is RemarkResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'remarkResult' &&
    typeof (message as { requestId?: unknown }).requestId === 'string' &&
    typeof (message as { ok?: unknown }).ok === 'boolean'
  );
}

/** A status-result message the child process posts back once a setStatus() request completes (see botProcess.ts). */
type StatusResultMessage = { type: 'statusResult'; requestId: string; ok: boolean; error?: string };

function isStatusResultMessage(message: unknown): message is StatusResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'statusResult' &&
    typeof (message as { requestId?: unknown }).requestId === 'string' &&
    typeof (message as { ok?: unknown }).ok === 'boolean'
  );
}

/** A presence-result message the child process posts back once a setPresence() request completes (019, see botProcess.ts). */
type PresenceResultMessage = { type: 'presenceResult'; requestId: string; ok: boolean; error?: string };

function isPresenceResultMessage(message: unknown): message is PresenceResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'presenceResult' &&
    typeof (message as { requestId?: unknown }).requestId === 'string' &&
    typeof (message as { ok?: unknown }).ok === 'boolean'
  );
}

/** A connection-status message the child process posts back as the Bot Service's Discord connection state changes (see botProcess.ts / botService.ts's onStatusChange). */
type BotStatusMessage = { type: 'status' } & BotStatusEvent;

function isBotStatusMessage(message: unknown): message is BotStatusMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'status' &&
    typeof (message as { status?: unknown }).status === 'string'
  );
}

/** A forum-names-result message the child process posts back once a getForumNames() request completes (see botProcess.ts). */
type ForumNamesResultMessage = { type: 'forumNamesResult'; requestId: string; names: Record<string, string> };

function isForumNamesResultMessage(message: unknown): message is ForumNamesResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'forumNamesResult' &&
    typeof (message as { requestId?: unknown }).requestId === 'string' &&
    typeof (message as { names?: unknown }).names === 'object'
  );
}

/**
 * Owns the lifecycle of the Discord bot's utility process: forking it with
 * the bot token, piping its stdout/stderr into onLog, and terminating it on
 * stop() (bound to app quit in main/index.ts — PRD: "bot only runs while
 * the app runs").
 */
export class BotProcessManager {
  private child: ForkedBotProcess | null = null;
  private nextRequestId = 1;
  private readonly pendingRemarks = new Map<string, (result: SendRemarkResult) => void>();
  private readonly pendingStatusChanges = new Map<string, (result: SetStatusResult) => void>();
  private readonly pendingForumNames = new Map<string, (names: Record<string, string>) => void>();
  private readonly pendingPresenceChanges = new Map<string, (result: SetPresenceResult) => void>();
  private connectionStatus: BotStatusEvent = { status: 'stopped' };

  constructor(private readonly options: BotProcessManagerOptions) {}

  private setConnectionStatus(event: BotStatusEvent): void {
    this.connectionStatus = event;
    this.options.onStatus?.(event);
  }

  /**
   * Forks the bot process and logs in with `token`. `presence` (019) is the
   * last-persisted presence + status message (read from ConfigStore by the
   * caller) — forwarded to the child so BotService can reapply it once the
   * client emits `ready`, without the child needing its own ConfigStore
   * access.
   */
  start(token: string, presence?: BotPresence): void {
    if (this.child) {
      return;
    }

    const child = this.options.fork();
    this.child = child;
    this.setConnectionStatus({ status: 'connecting' });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.options.onLog({ stream: 'stdout', text: chunk.toString() });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.options.onLog({ stream: 'stderr', text: chunk.toString() });
    });
    child.on('message', (message: unknown) => {
      if (isScanResultMessage(message)) {
        this.options.onPulledPosts?.(message.posts);
        return;
      }

      if (isRemarkResultMessage(message)) {
        const resolve = this.pendingRemarks.get(message.requestId);
        if (resolve) {
          this.pendingRemarks.delete(message.requestId);
          resolve(message.ok ? { ok: true } : { ok: false, error: message.error ?? 'Unknown error.' });
        }
        return;
      }

      if (isStatusResultMessage(message)) {
        const resolve = this.pendingStatusChanges.get(message.requestId);
        if (resolve) {
          this.pendingStatusChanges.delete(message.requestId);
          resolve(message.ok ? { ok: true } : { ok: false, error: message.error ?? 'Unknown error.' });
        }
        return;
      }

      if (isBotStatusMessage(message)) {
        this.setConnectionStatus(
          message.status === 'error' ? { status: 'error', error: message.error ?? 'Unknown error.' } : { status: message.status }
        );
        return;
      }

      if (isForumNamesResultMessage(message)) {
        const resolve = this.pendingForumNames.get(message.requestId);
        if (resolve) {
          this.pendingForumNames.delete(message.requestId);
          resolve(message.names);
        }
        return;
      }

      if (isPresenceResultMessage(message)) {
        const resolve = this.pendingPresenceChanges.get(message.requestId);
        if (resolve) {
          this.pendingPresenceChanges.delete(message.requestId);
          resolve(message.ok ? { ok: true } : { ok: false, error: message.error ?? 'Unknown error.' });
        }
      }
    });

    child.postMessage({ type: 'start', token, presence });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.setConnectionStatus({ status: 'stopped' });
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  /** Returns the most recently reported Discord connection status (PRD: let the reviewer see whether the bot is actually connected). Defaults to "stopped" before start() is ever called. */
  getStatus(): BotStatusEvent {
    return this.connectionStatus;
  }

  /**
   * Requests a scan sweep across the given forum channels (PRD: "a single
   * manual, global 'Scan' action"). Fire-and-forget — results arrive
   * asynchronously via the `onPulledPosts` callback once the child finishes,
   * the same pattern as log streaming. `includeViewed` (default false) is
   * the recovery option that re-pulls already-👀'd posts (see BotService.scan).
   */
  scan(forumChannelIds: string[], includeViewed = false): void {
    this.child?.postMessage({ type: 'scan', forumChannelIds, includeViewed });
  }

  /**
   * Posts `text` into the thread `threadId` via the bot process, as the bot
   * itself. Unlike scan()'s fire-and-forget-plus-broadcast pattern, this is
   * a request/response round trip correlated by a generated `requestId`,
   * since a caller (006's standalone remark, and later 007/009) needs to
   * know the outcome of *this specific* send — not just observe a global
   * stream of results.
   */
  sendRemark(threadId: string, text: string): Promise<SendRemarkResult> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve({ ok: false, error: 'Bot process is not running.' });
        return;
      }

      const requestId = String(this.nextRequestId++);
      this.pendingRemarks.set(requestId, resolve);
      this.child.postMessage({ type: 'sendRemark', requestId, threadId, text });
    });
  }

  /**
   * Requests the ✅/❌ triage reaction be applied to `postId`'s starter
   * message (`starterMessageId`) via the bot process (007). Same
   * request/response round-trip pattern as sendRemark(), correlated by its
   * own `requestId` sequence/map so status-change and remark responses
   * never cross-resolve each other.
   */
  setStatus(postId: string, starterMessageId: string, status: TriageStatus): Promise<SetStatusResult> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve({ ok: false, error: 'Bot process is not running.' });
        return;
      }

      const requestId = String(this.nextRequestId++);
      this.pendingStatusChanges.set(requestId, resolve);
      this.child.postMessage({ type: 'setStatus', requestId, postId, starterMessageId, status });
    });
  }

  /**
   * Resolves each given forum channel's real Discord name in one batch
   * (Forum Config settings page, 003), so it can show names instead of raw
   * channel IDs. Same request/response round-trip pattern as
   * sendRemark()/setStatus(). Resolves an empty map immediately (not an
   * error) when the process isn't running — the caller just falls back to
   * showing raw IDs, this isn't a failure state worth surfacing.
   */
  getForumNames(forumChannelIds: string[]): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve({});
        return;
      }

      const requestId = String(this.nextRequestId++);
      this.pendingForumNames.set(requestId, resolve);
      this.child.postMessage({ type: 'getForumNames', requestId, forumChannelIds });
    });
  }

  /**
   * Requests the bot's Discord presence be set to `status` (plus an
   * optional `statusMessage`) via the bot process (019). Same
   * request/response round-trip pattern as setStatus()/sendRemark(),
   * correlated by its own `requestId` sequence/map. Resolves
   * `{ ok: false }` immediately when the process isn't running, the same
   * as setStatus()/sendRemark() — the caller (botHandlers) is responsible
   * for not persisting a presence change that never actually applied.
   */
  setPresence(status: PresenceStatus, statusMessage?: string): Promise<SetPresenceResult> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve({ ok: false, error: 'Bot process is not running.' });
        return;
      }

      const requestId = String(this.nextRequestId++);
      this.pendingPresenceChanges.set(requestId, resolve);
      this.child.postMessage({ type: 'setPresence', requestId, status, statusMessage });
    });
  }
}
