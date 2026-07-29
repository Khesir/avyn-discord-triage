import { useEffect, useState } from 'react';
import type { PulledPost, PulledPostStatus, TriageStatus } from '../../shared/ipcTypes';
import PostDetail from './PostDetail';
import { colors, fonts } from './theme';

const ALL_STATUSES: PulledPostStatus[] = ['pending', 'approved', 'declined'];

/**
 * Groups posts by forumChannelId, preserving the order each forum was first
 * seen in. Carries `forumName` (the real Discord forum name at scan time,
 * shown in the UI instead of the raw channel ID) from the group's first
 * post — falling back to the channel ID for posts persisted before this
 * field existed.
 */
function groupPostsByForum(posts: PulledPost[]): { forumChannelId: string; forumName: string; posts: PulledPost[] }[] {
  const order: string[] = [];
  const byForum = new Map<string, PulledPost[]>();

  for (const post of posts) {
    if (!byForum.has(post.forumChannelId)) {
      byForum.set(post.forumChannelId, []);
      order.push(post.forumChannelId);
    }
    byForum.get(post.forumChannelId)!.push(post);
  }

  return order.map((forumChannelId) => {
    const groupPosts = byForum.get(forumChannelId)!;
    return { forumChannelId, forumName: groupPosts[0].forumName || forumChannelId, posts: groupPosts };
  });
}

/**
 * Builds the forum-tab strip's data: one entry per forum that has *any*
 * pulled posts (regardless of the status filter, so a tab never disappears
 * just because its posts are all currently filtered out), each carrying a
 * live count of posts in that forum that match `statusFilter` (issue 021 —
 * PRD user story 11). Order matches `groupPostsByForum`'s (first-seen order).
 */
function buildForumTabs(
  posts: PulledPost[],
  statusFilter: Set<PulledPostStatus>
): { forumChannelId: string; forumName: string; count: number }[] {
  return groupPostsByForum(posts).map((group) => ({
    forumChannelId: group.forumChannelId,
    forumName: group.forumName,
    count: group.posts.filter((post) => statusFilter.has(post.status ?? 'pending')).length
  }));
}

/**
 * Scan action + pulled-post list (PRD user stories 7-12: a manual "Scan"
 * button that sweeps every configured forum in one pass, and a list of
 * pulled posts). Subscribes to window.api.bot.onPulledPosts on mount and
 * appends each incoming batch, so results from multiple scans accumulate
 * rather than replacing each other; unsubscribes on unmount.
 *
 * The list itself only shows each post's title and author — clicking a post
 * opens its full text and all reply text in a
 * `PostDetail` view (issue 005), which is also where later actions (006
 * remark, 007 approve/decline, 008 generate issue) get surfaced.
 *
 * Layout (issue 015): a toolbar (Scan button, "include already-viewed"
 * checkbox, summary/error text) spans the full width above a master-detail
 * split — the post list in a left column, the selected post's detail pane
 * in a right column. Selecting a post only swaps the detail column's
 * content; the list column itself is a sibling, so its scroll
 * position/content is untouched by selection. Each column shows its own
 * placeholder when it has nothing to display (no posts pulled yet / no post
 * selected) instead of rendering blank.
 *
 * Pulled posts only ever lived in this component's React state, so a
 * renderer refresh or app restart silently lost the whole list even though
 * the underlying posts were already marked 👀 on Discord. On mount this now
 * hydrates from `window.api.bot.getPulledPosts()` — main persists every
 * scan's results to disk (see ConfigStore.appendPulledPosts) — merged with
 * anything already live in state so neither source loses data. The
 * "include already-viewed posts" checkbox is a recovery option for when
 * that persisted copy itself is gone (e.g. the config file was deleted): it
 * asks the bot to re-pull posts that already carry 👀 instead of skipping
 * them, rebuilding the list straight from Discord.
 *
 * Status filter: each post carries a local `status` (`pending` until acted
 * on, `approved`/`declined` once the reviewer does — tracked entirely
 * client-side, not read back from Discord's actual reaction state; see
 * `PulledPostStatus`). Three checkboxes (all checked by default) let the
 * reviewer narrow the list to just the statuses they care about. Approving
 * or declining the selected post via `PostDetail`'s `onStatusChange`
 * callback updates that post's status here immediately — main has already
 * persisted the same change (see botHandlers.ts's `setStatus` handler) — so
 * the list/filter reflect it right away without waiting for a re-scan.
 *
 * Forum tabs (issue 021): the post-list column is split into a narrow tab
 * strip (one entry per forum with any pulled posts, each showing a live
 * count of that forum's posts matching the active status filter) and the
 * list itself, filtered to whichever forum tab is active. `activeForumTab`
 * is local UI state only — it never touches `posts`, persistence, or the
 * status filter, both of which continue to apply exactly as before, merely
 * narrowed to the active forum. When the stored tab selection doesn't (or
 * no longer) match any forum with posts, the first forum tab in pulled
 * order is used instead — so a fresh list of posts always lands on a
 * sensible default tab without requiring an explicit click.
 */
export default function ScanPanel() {
  const [posts, setPosts] = useState<PulledPost[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScanCount, setLastScanCount] = useState<number | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [includeViewed, setIncludeViewed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<PulledPostStatus>>(new Set(ALL_STATUSES));
  const [activeForumTab, setActiveForumTab] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    window.api.bot.getPulledPosts().then((persisted) => {
      if (cancelled) return;
      setPosts((current) => {
        const merged = new Map(persisted.map((post) => [post.postId, post] as const));
        for (const post of current) {
          if (!merged.has(post.postId)) merged.set(post.postId, post);
        }
        return [...merged.values()];
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The only source of "pulled posts" events is a completed scan (see botProcessManager.ts) — so
    // every event here also marks the in-flight scan (if any) as finished, regardless of how long the
    // actual Discord sweep took (scan() itself only resolves once the request is *dispatched*).
    const unsubscribe = window.api.bot.onPulledPosts((newPosts) => {
      // Upsert by postId rather than appending (a recovery re-scan with `includeViewed` re-pulls
      // posts already in `current` too) — freshly-scanned content/replies/images replace the old
      // copy in place, same as ConfigStore.appendPulledPosts on the main side. The post's local
      // triage status is preserved rather than overwritten, since a fresh pull always reports
      // 'pending' (BotService has no knowledge of local triage state) — otherwise recovering an
      // already approved/declined post from Discord would silently reset it back to pending.
      setPosts((current) => {
        const byId = new Map(current.map((post) => [post.postId, post] as const));
        for (const post of newPosts) {
          const previous = byId.get(post.postId);
          byId.set(post.postId, previous ? { ...post, status: previous.status } : post);
        }
        return [...byId.values()];
      });
      setLastScanCount(newPosts.length);
      setScanning(false);
    });

    return unsubscribe;
  }, []);

  const handleScan = async () => {
    setError(null);
    setLastScanCount(null);
    setScanning(true);

    const result = await window.api.bot.scan({ includeViewed });
    if (!result.ok) {
      setError(result.error);
      setScanning(false);
    }
    // On success, scanning stays true until onPulledPosts fires with the actual results.
  };

  const handlePostStatusChange = (postId: string, status: TriageStatus) => {
    setPosts((current) => current.map((post) => (post.postId === postId ? { ...post, status } : post)));
  };

  const toggleStatusFilter = (status: PulledPostStatus) => {
    setStatusFilter((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const selectedPost = posts.find((post) => post.postId === selectedPostId) ?? null;
  const forumTabs = buildForumTabs(posts, statusFilter);
  const activeForumId =
    activeForumTab !== null && forumTabs.some((tab) => tab.forumChannelId === activeForumTab)
      ? activeForumTab
      : (forumTabs[0]?.forumChannelId ?? null);
  const activeTabPosts = posts.filter(
    (post) => post.forumChannelId === activeForumId && statusFilter.has(post.status ?? 'pending')
  );

  return (
    <section aria-label="Scan" style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: fonts.body }}>
      <div
        aria-label="Scan toolbar"
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.borderDefault}`,
          background: colors.bgPanel,
          flexWrap: 'wrap'
        }}
      >
        <h1 style={{ fontSize: '16px', margin: 0, fontFamily: fonts.heading, fontWeight: 600, color: colors.textPrimary }}>
          Scan
        </h1>
        <label
          htmlFor="include-viewed"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: colors.textSecondary }}
        >
          <input
            id="include-viewed"
            type="checkbox"
            checked={includeViewed}
            onChange={(event) => setIncludeViewed(event.target.checked)}
          />
          Include already-viewed posts (recovery — re-pulls posts that already have 👀, in case the local copy was
          lost)
        </label>
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          style={{
            fontFamily: fonts.body,
            fontWeight: 600,
            color: '#ffffff',
            background: colors.accent,
            border: 'none',
            borderRadius: '6px',
            padding: '8px 16px',
            cursor: scanning ? 'default' : 'pointer',
            opacity: scanning ? 0.7 : 1
          }}
        >
          {scanning ? 'Scanning…' : 'Scan'}
        </button>

        <div role="group" aria-label="Status filter" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
          {ALL_STATUSES.map((status) => (
            <label
              key={status}
              htmlFor={`status-filter-${status}`}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', color: colors.textSecondary }}
            >
              <input
                id={`status-filter-${status}`}
                type="checkbox"
                checked={statusFilter.has(status)}
                onChange={() => toggleStatusFilter(status)}
              />
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </label>
          ))}
        </div>

        {error && (
          <p role="alert" style={{ margin: 0, color: colors.declined }}>
            {error}
          </p>
        )}
        {!scanning && lastScanCount !== null && (
          <p role="status" style={{ margin: 0, color: colors.textSecondary }}>
            {lastScanCount === 0
              ? 'Scan complete — no new posts found.'
              : `Scan complete — found ${lastScanCount} new post${lastScanCount === 1 ? '' : 's'}.`}
          </p>
        )}
      </div>

      <div aria-label="Triage split" style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <div aria-label="Post list column" style={{ flex: '0 0 320px', display: 'flex', minHeight: 0, borderRight: `1px solid ${colors.borderDefault}` }}>
          {posts.length === 0 ? (
            <p style={{ textAlign: 'center', color: colors.textTertiary, marginTop: '32px', width: '100%' }}>
              No posts pulled yet. Run a scan to get started.
            </p>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="Forum tabs"
                style={{
                  flex: '0 0 96px',
                  overflowY: 'auto',
                  borderRight: `1px solid ${colors.borderSubtle}`,
                  background: colors.bgPanel,
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                {forumTabs.map((tab) => {
                  const isActive = tab.forumChannelId === activeForumId;
                  return (
                    <button
                      key={tab.forumChannelId}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveForumTab(tab.forumChannelId)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '4px',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 8px',
                        border: 'none',
                        borderLeft: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                        background: isActive ? colors.bgCard : 'transparent',
                        color: isActive ? colors.textPrimary : colors.textSecondary,
                        fontFamily: fonts.body,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ wordBreak: 'break-word' }}>{tab.forumName}</span>
                      <span
                        aria-hidden="true"
                        style={{
                          fontFamily: fonts.mono,
                          fontSize: '11px',
                          color: colors.textTertiary,
                          background: colors.bgInput,
                          borderRadius: '999px',
                          padding: '0 6px'
                        }}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '8px', background: colors.bgPanel }}>
                {activeTabPosts.length === 0 ? (
                  <p style={{ textAlign: 'center', color: colors.textTertiary, marginTop: '32px' }}>
                    No posts match the selected status filters.
                  </p>
                ) : (
                  <ul aria-label="Pulled posts" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {activeTabPosts.map((post) => (
                      <li key={post.postId} style={{ marginBottom: '4px' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedPostId(post.postId)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px',
                            border: 'none',
                            borderRadius: '6px',
                            background: post.postId === selectedPostId ? colors.bgCard : 'transparent',
                            color: colors.textPrimary,
                            fontFamily: fonts.body,
                            cursor: 'pointer'
                          }}
                        >
                          {post.title}
                        </button>
                        <p style={{ margin: '0 0 0 8px', fontSize: '12px', color: colors.textSecondary }}>
                          <strong>{post.author.name}</strong>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div aria-label="Post detail column" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
          {selectedPost ? (
            <PostDetail post={selectedPost} onStatusChange={handlePostStatusChange} />
          ) : (
            <p style={{ textAlign: 'center', color: colors.textTertiary, marginTop: '32px' }}>
              Select a post to see its details.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
