/**
 * Shared IPC contract between the preload bridge, the main process handlers,
 * and the renderer UI. Kept dependency-free so it can be imported from all
 * three worlds without pulling in Electron or DOM types.
 */

export type SecretsPayload = {
  discordBotToken: string;
  githubPat: string;
};

export type SecretsGetResult = Partial<SecretsPayload>;

export interface SecretsApi {
  /** Reads back previously saved secrets (if any) from secure storage. */
  get(): Promise<SecretsGetResult>;
  /** Validates and persists both secrets to OS-level secure storage. */
  save(payload: SecretsPayload): Promise<{ ok: true }>;
}

/**
 * Opens a URL in the OS default browser (or, for `discord.com` links, the
 * user's Discord client) — used by the post detail view's "View on Discord"
 * action (PRD user story 13) since attachments/images aren't mirrored into
 * the app (004).
 */
export interface ShellApi {
  openExternal(url: string): Promise<{ ok: true }>;
}

/**
 * One GitHub repo per forum channel (PRD: "One GitHub repo per forum
 * channel, configured as a flat list of `{ forumChannelId, repo }`
 * entries"). `repo` is `owner/name`. Persisted in the non-secret config
 * file, never in secure/secret storage.
 */
export type ForumRepoMapping = {
  forumChannelId: string;
  repo: string;
};

export interface ForumConfigApi {
  /** Lists all configured forum-to-repo mappings. */
  list(): Promise<ForumRepoMapping[]>;
  /** Adds a new mapping. Rejects if forumChannelId already has one. */
  add(mapping: ForumRepoMapping): Promise<{ ok: true }>;
  /** Removes the mapping for the given forumChannelId, if any. */
  remove(forumChannelId: string): Promise<{ ok: true }>;
}

/**
 * One line of stdout/stderr output from the bot's utility process, forwarded
 * from main to the renderer for the live log/console panel (PRD: "Main
 * forwards each chunk to the renderer over IPC for display in a live
 * log/console panel"). `text` may contain multiple newline-separated lines
 * or a partial line — chunk boundaries are not guaranteed to align with
 * line boundaries.
 */
export type BotLogLine = {
  stream: 'stdout' | 'stderr';
  text: string;
};

/** Channel name shared by main (sender) and preload (receiver) so both sides of the contract stay in lockstep. */
export const BOT_LOG_CHANNEL = 'bot:log';

/**
 * A forum post's author or reply author (PRD user story 11: "see the
 * original forum post plus all reply text"). `id` is the Discord user ID —
 * kept even though v1 only displays `name`, since later issues may need it
 * for attribution.
 */
export type PulledPostAuthor = {
  id: string;
  name: string;
};

/**
 * One reply in a pulled post's thread, in the order it was posted. Text
 * plus any image URLs (`imageUrls`) — Discord image attachments/embeds are
 * just CDN links, so the renderer can display them directly with an
 * `<img>` tag; nothing is downloaded or stored locally. Non-image
 * attachments/embeds are still not carried over.
 */
export type PulledReply = {
  author: PulledPostAuthor;
  content: string;
  imageUrls: string[];
};

/**
 * A forum post pulled during a scan (PRD user stories 7-12): the bot found it
 * missing the 👀 "viewed" reaction, reacted immediately, and is handing back
 * the original post text plus every reply's text, and any image URLs found
 * on the post/replies (CDN links only — no binary data downloaded or
 * stored). Carries enough identifying info for later issues (005-009) to
 * link back to the original Discord post and react/reply on the same
 * thread: `postId` is the forum thread's channel ID (the same channel a
 * remark/reaction would be sent to), `starterMessageId` is the ID of the
 * message that started the thread (the post itself, which is what actually
 * carries the 👀/✅/❌ reactions), and `guildId` + `forumChannelId` identify
 * which server/forum it came from.
 */
/**
 * A post's local triage status, tracked entirely client-side (not read back
 * from Discord's actual reaction state): `pending` until the reviewer acts
 * on it, `approved`/`declined` once they do — set the moment `setStatus`
 * succeeds (see botHandlers.ts), independent of whether anyone else's own
 * reaction shows up on the real Discord message. Powers the Triage list's
 * status filter.
 */
export type PulledPostStatus = 'pending' | TriageStatus;

export type PulledPost = {
  postId: string;
  starterMessageId: string;
  forumChannelId: string;
  /** The forum channel's real Discord name at scan time (e.g. "bug-reports") — shown in the UI instead of the raw channel ID. */
  forumName: string;
  guildId: string;
  title: string;
  author: PulledPostAuthor;
  content: string;
  imageUrls: string[];
  replies: PulledReply[];
  /** Local triage status — see `PulledPostStatus`. Always `pending` on a fresh scan; updated in place once the reviewer approves/declines. */
  status: PulledPostStatus;
};

/** Channel name main (sender) and preload (receiver) agree on for pushing pulled-post results to the renderer. */
export const BOT_PULLED_POSTS_CHANNEL = 'bot:pulledPosts';

/** Generic ok/error outcome shape shared by the bot's action round trips (scan, sendRemark, setStatus). */
export type BotActionResult = { ok: true } | { ok: false; error: string };

/**
 * The outcome of a `bot:scan` request (004): whether the sweep was actually
 * dispatched to the bot process, or an error if not (e.g. the bot process
 * isn't running yet — no token saved, or still connecting). `ok: true` here
 * only means the sweep *started*; its results arrive asynchronously via
 * `onPulledPosts` once it finishes.
 */
export type ScanResult = BotActionResult;

/**
 * The outcome of a `sendRemark` request (006): whether the bot successfully
 * posted the message into the target thread, or an error message if not
 * (e.g. the thread couldn't be found, or the bot process isn't running).
 */
export type SendRemarkResult = BotActionResult;

/**
 * Triage status a reviewer can mark a post with (PRD user stories 20-21):
 * "approved" applies the fixed ✅ reaction, "declined" applies ❌. No other
 * statuses exist in v1 — 👀 (viewed) is applied automatically during scan
 * (004) and isn't reviewer-triggered.
 */
export type TriageStatus = 'approved' | 'declined';

/**
 * The outcome of a `setStatus` request (007): whether the bot successfully
 * applied the ✅/❌ reaction to the post's starter message, or an error
 * message if not (e.g. the thread/message couldn't be found, or the bot
 * process isn't running). Same shape as `SendRemarkResult` — both are
 * `BotActionResult` — kept as a distinct name at call sites for clarity.
 */
export type SetStatusResult = BotActionResult;

/**
 * Payload for creating a GitHub issue from a post's detail view (PRD user
 * stories 14-15): `forumChannelId` identifies which post this issue is being
 * filed from, resolved to a target repo via the forum-to-repo mapping (003)
 * in main — the renderer never resolves or sends the repo itself.
 * `title`/`body`/`labels` are entered manually by the reviewer in the
 * compose UI; nothing here is auto-generated from the post content.
 */
export type CreateGitHubIssuePayload = {
  forumChannelId: string;
  title: string;
  body: string;
  labels: string[];
};

/**
 * The outcome of a `github:createIssue` request (008): the created issue's
 * number/URL on success, or a clear error message on failure (bad token,
 * repo not found, rate limit, or no repo mapped/no PAT saved) — never fails
 * silently, per the acceptance criteria. `ok: true` is also what issue 009's
 * auto-notification trigger keys off of.
 */
export type CreateGitHubIssueResult = { ok: true; number: number; htmlUrl: string } | { ok: false; error: string };

export interface GitHubApi {
  /** Creates a GitHub issue via the REST API, using the stored PAT and the repo mapped to the payload's forumChannelId. */
  createIssue(payload: CreateGitHubIssuePayload): Promise<CreateGitHubIssueResult>;
}

/**
 * Window control actions for the custom, app-owned titlebar (010) that
 * replaces the OS-native one once the `BrowserWindow` moves to a frameless
 * configuration (PRD user stories 1-2). `toggleMaximize` doesn't take a
 * target state — main decides whether to maximize or restore based on the
 * window's current state (see windowControlsHandlers.ts), so the renderer
 * never needs to track it itself.
 */
export interface WindowControlsApi {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The bot's Discord connection state, reported by the Bot Service as it
 * moves through its lifecycle: `stopped` (process not running, or not yet
 * started — no bot token saved), `connecting` (process forked and login in
 * flight), `connected` (discord.js emitted "ready"), `error` (discord.js
 * emitted an error — `error` carries its message). Lets the renderer show
 * whether the bot is actually up before the reviewer tries to Scan.
 */
export type BotConnectionStatus = 'stopped' | 'connecting' | 'connected' | 'error';

export type BotStatusEvent = { status: BotConnectionStatus; error?: string };

/** Channel name main (sender) and preload (receiver) agree on for pushing bot connection-status changes. */
export const BOT_STATUS_CHANNEL = 'bot:status';

/**
 * Discord presence status a reviewer can set on the bot (PRD user stories
 * 5-9, issue 019): mirrors discord.js's four selectable presence values.
 * No other rich-presence types (playing/streaming/etc.) are offered.
 */
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

/**
 * The bot's last-selected presence + custom status message (PRD user story
 * 8): persisted non-secretly in ConfigStore and automatically re-applied by
 * BotService on `ready` (including reconnects — see BotService.start()'s
 * `presence` parameter), not just re-applied at app start. `message` is
 * `''` when no custom status has ever been set — never `undefined`, so it
 * round-trips through ConfigStore's plain JSON without special-casing.
 */
export type BotPresence = {
  status: PresenceStatus;
  message: string;
};

/** Presence applied when nothing has ever been persisted (PRD/issue notes: "default: online, no message, if nothing was ever set"). */
export const DEFAULT_BOT_PRESENCE: BotPresence = { status: 'online', message: '' };

/**
 * The outcome of a `bot:setPresence` request (019): whether the bot
 * successfully applied the presence to the real Discord connection, or an
 * error message if not (e.g. the bot process isn't running). Same shape as
 * `SetStatusResult`/`SendRemarkResult` — all are `BotActionResult`.
 */
export type SetPresenceResult = BotActionResult;

export interface BotApi {
  /** Subscribes to live bot process log output. Returns an unsubscribe function. */
  onLog(callback: (line: BotLogLine) => void): () => void;
  /**
   * Triggers a single global scan sweep across every configured forum (PRD:
   * "a single manual, global 'Scan' action"). Resolves once the request has
   * been dispatched to the bot process — scan results arrive asynchronously
   * via `onPulledPosts`, the same fire-and-forget-trigger/streamed-results
   * pattern as the log console.
   */
  /**
   * Triggers a scan. `includeViewed` (default false) is a recovery option:
   * when true, posts that already carry 👀 are re-pulled instead of skipped
   * (without re-reacting), letting a reviewer rebuild the pulled-post list
   * from Discord itself if the app's local persisted copy is ever lost.
   */
  scan(options?: { includeViewed?: boolean }): Promise<ScanResult>;
  /** Reads back all pulled posts persisted so far, so the UI can restore its list after a refresh/restart without losing anything. */
  getPulledPosts(): Promise<PulledPost[]>;
  /** Subscribes to pulled-post results as scans complete. Returns an unsubscribe function. */
  onPulledPosts(callback: (posts: PulledPost[]) => void): () => void;
  /**
   * Sends a standalone remark (free-text message, posted as the bot itself)
   * into the Discord thread identified by `threadId` (PRD user stories
   * 18-19, 24). One-way only — this resolves once the message has been
   * posted (or failed to post); it does not open any ongoing/synced channel
   * for replies. Available regardless of the post's triage status.
   */
  sendRemark(threadId: string, text: string): Promise<SendRemarkResult>;
  /**
   * Marks a pulled post approved or declined (PRD user stories 20-21):
   * applies the corresponding fixed ✅/❌ reaction to the post's starter
   * message. `postId` is the thread/forum-post ID (also the target of
   * `sendRemark`), `starterMessageId` is the ID of the message the reaction
   * lands on (see `PulledPost.starterMessageId`). This only applies the
   * reaction — it does not itself send a remark; the renderer pre-fills the
   * remark textarea and sends it via the existing `sendRemark` call, so the
   * reviewer can edit or skip it before it's posted.
   */
  setStatus(postId: string, starterMessageId: string, status: TriageStatus): Promise<SetStatusResult>;
  /** Reads the bot's current connection status (e.g. for a UI's initial render, before the first onStatus event arrives). */
  getStatus(): Promise<BotStatusEvent>;
  /** Subscribes to bot connection-status changes. Returns an unsubscribe function. */
  onStatus(callback: (event: BotStatusEvent) => void): () => void;
  /**
   * Resolves each given forum channel's real Discord name in one batch, for
   * the Forum Config settings page (003) to show instead of raw channel
   * IDs. A channel ID that can't be resolved (forum not found, bot not
   * connected) is simply omitted from the returned map — the caller falls
   * back to displaying the raw ID for those.
   */
  getForumNames(forumChannelIds: string[]): Promise<Record<string, string>>;
  /**
   * Sets the bot's Discord presence (PRD user stories 5-9, issue 019): one
   * of the four selectable statuses plus an optional custom status message.
   * Applied immediately to the real Discord connection. On success, main
   * also persists the selection (see `getPresence`) so it survives a
   * reconnect without any further renderer involvement.
   */
  setPresence(status: PresenceStatus, statusMessage?: string): Promise<SetPresenceResult>;
  /**
   * Reads the last-selected presence + status message, for the Titlebar
   * presence menu's initial render (defaults to `DEFAULT_BOT_PRESENCE` —
   * online, no message — if nothing was ever set).
   */
  getPresence(): Promise<BotPresence>;
}
