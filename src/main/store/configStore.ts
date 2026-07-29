import fs from 'node:fs';
import path from 'node:path';
import type { BotPresence, PulledPost, PulledPostStatus } from '../../shared/ipcTypes';
import { DEFAULT_BOT_PRESENCE } from '../../shared/ipcTypes';

const PULLED_POST_STATUSES: PulledPostStatus[] = ['pending', 'approved', 'declined'];

/**
 * Non-secret application configuration (forum-to-repo mappings, tracked
 * channel IDs). The generic index signature keeps `read`/`write` usable for
 * any future non-secret config key without changing this store's shape;
 * typed accessors like `getForumRepoMappings` sit on top of it. Kept as
 * plain, human-inspectable JSON per the PRD ("config can be
 * inspected/backed up without exposing credentials"), and fully separate
 * from SecretStore's encrypted file.
 */
export interface NonSecretConfig {
  [key: string]: unknown;
}

/**
 * One GitHub repo per forum channel (PRD: "One GitHub repo per forum
 * channel, configured as a flat list of `{ forumChannelId, repo }`
 * entries"). `repo` is `owner/name`.
 */
export interface ForumRepoMapping {
  forumChannelId: string;
  repo: string;
}

const FORUM_REPO_MAPPINGS_KEY = 'forumRepoMappings';
const PULLED_POSTS_KEY = 'pulledPosts';
const BOT_PRESENCE_KEY = 'botPresence';

/** Loosely validates a raw config value looks like a `BotPresence` before trusting it (a hand-edited config.json could contain anything). */
function isBotPresence(value: unknown): value is BotPresence {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export class ConfigStore {
  constructor(private readonly filePath: string) {}

  read(): NonSecretConfig {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    if (raw.trim().length === 0) {
      return {};
    }

    try {
      return JSON.parse(raw) as NonSecretConfig;
    } catch {
      return {};
    }
  }

  write(config: NonSecretConfig): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  getForumRepoMappings(): ForumRepoMapping[] {
    const raw = this.read()[FORUM_REPO_MAPPINGS_KEY];
    return Array.isArray(raw) ? (raw as ForumRepoMapping[]) : [];
  }

  addForumRepoMapping(mapping: ForumRepoMapping): void {
    const forumChannelId = mapping.forumChannelId?.trim();
    // repo is optional — a reviewer may want to just mark a forum as "watched" for scanning and write
    // GitHub issues by hand, without wiring up automated issue creation yet.
    const repo = mapping.repo?.trim() ?? '';

    if (!forumChannelId) {
      throw new Error('A forum channel ID is required.');
    }

    const existing = this.getForumRepoMappings();
    if (existing.some((m) => m.forumChannelId === forumChannelId)) {
      throw new Error(`A repo mapping already exists for forum channel "${forumChannelId}".`);
    }

    this.setForumRepoMappings([...existing, { forumChannelId, repo }]);
  }

  removeForumRepoMapping(forumChannelId: string): void {
    this.setForumRepoMappings(this.getForumRepoMappings().filter((m) => m.forumChannelId !== forumChannelId));
  }

  private setForumRepoMappings(mappings: ForumRepoMapping[]): void {
    this.write({ ...this.read(), [FORUM_REPO_MAPPINGS_KEY]: mappings });
  }

  /**
   * Reads back every pulled post persisted so far — the fix for the app
   * losing its whole post list on a renderer refresh or restart, since
   * previously pulled posts only ever lived in the renderer's in-memory
   * React state and were never written anywhere.
   */
  getPulledPosts(): PulledPost[] {
    const raw = this.read()[PULLED_POSTS_KEY];
    if (!Array.isArray(raw)) return [];

    // Posts persisted before `status` existed on disk (or a hand-edited config.json) may be
    // missing/invalid here — default those to 'pending' rather than trusting raw JSON, since
    // downstream UI (the status pill) indexes a lookup table keyed by this value directly.
    return (raw as PulledPost[]).map((post) =>
      PULLED_POST_STATUSES.includes(post.status) ? post : { ...post, status: 'pending' }
    );
  }

  /**
   * Persists newly pulled posts, upserting by `postId` so a recovery
   * re-scan (BotService.scan's `includeViewed` option) refreshes an
   * already-known post's text/images in place rather than duplicating it.
   * New posts are appended after existing ones, preserving discovery order.
   *
   * A recovery re-scan always hands back freshly-scanned posts with
   * `status: 'pending'` (BotService has no knowledge of local triage
   * state) — so an already-known post's *existing* status is preserved
   * here rather than overwritten, otherwise recovering an already
   * approved/declined post from Discord would silently reset it back to
   * pending.
   */
  appendPulledPosts(posts: PulledPost[]): void {
    const existing = this.getPulledPosts();
    const byId = new Map(existing.map((post) => [post.postId, post] as const));
    for (const post of posts) {
      const previous = byId.get(post.postId);
      byId.set(post.postId, previous ? { ...post, status: previous.status } : post);
    }

    this.write({ ...this.read(), [PULLED_POSTS_KEY]: [...byId.values()] });
  }

  /** Updates a single persisted post's local triage status in place, leaving everything else about it (and every other post) untouched. A postId that isn't found is a no-op. */
  updatePulledPostStatus(postId: string, status: PulledPostStatus): void {
    const posts = this.getPulledPosts().map((post) => (post.postId === postId ? { ...post, status } : post));
    this.write({ ...this.read(), [PULLED_POSTS_KEY]: posts });
  }

  /**
   * Reads back the last-selected bot presence + status message (019),
   * defaulting to `DEFAULT_BOT_PRESENCE` (online, no message) if nothing has
   * ever been saved — so BotService's reapply-on-ready always has something
   * sensible to apply, even on a completely fresh install.
   */
  getBotPresence(): BotPresence {
    const raw = this.read()[BOT_PRESENCE_KEY];
    return isBotPresence(raw) ? raw : DEFAULT_BOT_PRESENCE;
  }

  /** Persists the reviewer's last-selected bot presence + status message, so it can be reapplied on the next connect/reconnect. */
  setBotPresence(presence: BotPresence): void {
    this.write({ ...this.read(), [BOT_PRESENCE_KEY]: presence });
  }
}
