import { useEffect, useState, type CSSProperties } from 'react';
import type { PulledPost, PulledPostStatus, PulledReply, TriageStatus } from '../../shared/ipcTypes';
import { buildDiscordPostUrl } from './discordLink';
import { colors, fonts } from './theme';

/**
 * Label + dot color for the status pill next to the author name in the
 * detail pane header (022 / PRD user story 13). Detail-pane-only display of
 * the post's existing local `status` field — introduces no new state.
 */
const STATUS_PILL: Record<PulledPostStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: colors.pending },
  approved: { label: 'Approved', color: colors.approved },
  declined: { label: 'Declined', color: colors.declined }
};

/**
 * Hardcoded default remark text pre-filled when the reviewer clicks Approve
 * (PRD user story 22: "positive tone for approved, e.g. thanking the
 * poster"). Not configurable in v1 (see issues/future-scope.md) — the
 * reviewer can still edit it before sending, or send as-is.
 */
export const APPROVED_DEFAULT_REMARK = "Thanks for flagging this — approved, and it's on the list.";

/**
 * Hardcoded default remark text pre-filled when the reviewer clicks Decline
 * (PRD user story 22). Not configurable in v1.
 */
export const DECLINED_DEFAULT_REMARK =
  "Thanks for the report — after review, we won't be addressing this one.";

/**
 * Hardcoded generic notice auto-sent into a post's thread once a GitHub
 * issue is successfully created from it (issue 009 / PRD user stories 16-17).
 * Deliberately contains no issue number or link — some repos/tickets may be
 * private, and the reviewer may not want that exposed to the community
 * poster. Not configurable in v1 (see issues/future-scope.md).
 */
export const ISSUE_CREATED_NOTIFICATION = "We're working on it!";

/**
 * Author attributed to the optimistically-injected reply below (022 / PRD:
 * "attributed to the bot"). Matches the "all bot messages post as the bot
 * itself" identity model (see issues/future-scope.md) — there's no
 * per-reviewer identity to attribute it to instead.
 */
const BOT_REPLY_AUTHOR = { id: 'bot', name: 'Avyn' };

/**
 * Detail view for a single pulled post (issue 005 / PRD user stories 11, 13):
 * shows the full original post text and all reply text in reading order,
 * rendering any image URLs (`imageUrls`) directly via `<img>` — these are
 * just Discord CDN links, so nothing is downloaded or stored locally — plus
 * a "View on Discord" action that opens the real post/thread
 * (`https://discord.com/channels/{guildId}/{postId}`) in the user's default
 * browser/Discord client — the link is built per-post from that post's own
 * `guildId`/`postId`, not hardcoded, so it works across servers/forums.
 *
 * The `<section aria-label="Post actions">` block is the extension point
 * later issues hang off: 006 added the standalone remark textarea + Send
 * button alongside "View on Discord"; issue 007 adds Approve/Decline buttons
 * that hang off that same textarea; issue 008 adds the "Generate GitHub
 * issue" compose UI below.
 *
 * The remark action (PRD user stories 18-19, 24) posts free-text into the
 * post's own Discord thread (`post.postId`) as the bot itself, independent
 * of triage status, via `window.api.bot.sendRemark`. It's one-way only: on
 * success the textarea just clears — there is no reply list, polling, or
 * live-updating thread view for it here (that would be a synced chat, which
 * the PRD explicitly rules out; see "View on Discord" for continuing the
 * conversation natively).
 *
 * Approve/Decline (PRD user stories 20-23) apply the fixed ✅/❌ reaction to
 * the post's starter message (`post.starterMessageId`) via
 * `window.api.bot.setStatus`, and pre-fill the same remark textarea above
 * with a hardcoded default message per status — reusing 006's existing
 * remark-send mechanism rather than a second parallel send path. The
 * reaction is applied immediately on click; the remark is only actually
 * posted once the reviewer presses Send (same as a standalone remark), so
 * they can edit or clear the pre-filled text first.
 *
 * "Generate GitHub issue" (008 / PRD user stories 14-15) reveals a compose
 * form (title/body/labels) that starts entirely blank — nothing is
 * auto-generated or pre-filled from the pulled post/thread text shown above
 * it, even though that text is visible alongside for the reviewer to draw
 * from manually. Submitting calls `window.api.github.createIssue` with the
 * post's own `forumChannelId` (resolved to a repo in main via 003's
 * forum-to-repo mapping) plus the entered title/body/labels (labels split
 * from a comma-separated input). A successful create shows the new issue
 * number and clears the form; a failed create (bad token, repo not found,
 * rate limit, etc.) surfaces the error inline and leaves the entered fields
 * untouched so the reviewer doesn't lose their draft.
 *
 * On a successful create only, 009 (PRD user stories 16-17) automatically
 * fires a fire-and-forget `window.api.bot.sendRemark(post.postId, ...)` with
 * the hardcoded `ISSUE_CREATED_NOTIFICATION` text — reusing 006's remark-send
 * path rather than a third parallel one. The notification deliberately never
 * includes the created issue's number/htmlUrl (some repos/tickets may be
 * private), and a failed create never triggers it at all.
 *
 * 016 (PRD user stories 20-24) restructures this component's layout into a
 * persistent action bar (`<section aria-label="Post actions">` — View on
 * Discord, Approve, Decline, Remark, Generate GitHub issue) and a scrolling
 * content area below it (`<div aria-label="Post content">` — title, content,
 * images, replies, unchanged). The remark textarea, previously
 * always-rendered, is now hidden-until-triggered via `showRemarkForm`,
 * matching 008's existing `showIssueForm` pattern for the GitHub issue form.
 * The two forms are mutually exclusive — opening either one closes the other
 * — so Approve/Decline (which open the remark form, as before) also close
 * the GitHub issue form if it was open, and vice versa. None of the
 * underlying IPC-calling logic above changed, only when/whether these forms
 * are visible.
 *
 * 022 (PRD user stories 13-17) moves the Remark and Generate GitHub issue
 * forms from being inline children of the action bar's flex column to an
 * absolutely-positioned floating panel anchored below it (the `<section>` is
 * `position: relative`; the panel is `position: absolute; top: 100%` plus a
 * `marginTop` gap — not `calc(100% + Npx)`, which triggers a jsdom
 * `getComputedStyle` crash in `@testing-library`'s accessibility-tree walk,
 * see PostDetail.test.tsx),
 * so the two forms visually read as "acting on" the post rather than being
 * stacked into the bar itself — layout only, the `showRemarkForm`/
 * `showIssueForm` mutual-exclusion logic above is untouched. The scrolling
 * content area's top padding grows while either form is open so the
 * floating panel never covers unread content. It also adds a status pill
 * (colored dot + label, from `post.status`) next to the author name, and
 * optimistically appends `ISSUE_CREATED_NOTIFICATION` to a local
 * session-only `extraReplies` list (merged with `post.replies` at render
 * time) immediately on a successful issue creation — reflecting the
 * `sendRemark` call already fired above without waiting for a re-scan; a
 * failed creation never reaches this code path, so nothing is appended.
 *
 * The action bar sits above the scrolling content area (rather than pinned
 * to the bottom) and, because it's a non-scrolling flex sibling of the
 * scroll region rather than being inside it, it stays visible the whole
 * time the reviewer scrolls through a long post/thread.
 */
interface PostDetailProps {
  post: PulledPost;
  /** Called immediately when Approve/Decline is clicked, with this post's ID and the new status — lets the list owning `posts` state (ScanPanel) update its own copy and status filter without waiting for a re-scan. */
  onStatusChange?: (postId: string, status: TriageStatus) => void;
}

export default function PostDetail({ post, onStatusChange }: PostDetailProps) {
  const [remarkText, setRemarkText] = useState('');
  const [remarkError, setRemarkError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showRemarkForm, setShowRemarkForm] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [issueLabels, setIssueLabels] = useState('');
  const [issueError, setIssueError] = useState<string | null>(null);
  const [createdIssueNumber, setCreatedIssueNumber] = useState<number | null>(null);

  // Optimistic local-only replies appended this session (022 / PRD: "not a
  // live re-fetch" — this never becomes canonical data; the next real scan's
  // `post.replies` from main fully replaces it). Reset whenever the detail
  // pane switches to a different post so replies don't bleed across posts.
  const [extraReplies, setExtraReplies] = useState<PulledReply[]>([]);
  useEffect(() => {
    setExtraReplies([]);
  }, [post.postId]);
  const displayedReplies = [...post.replies, ...extraReplies];

  const handleViewOnDiscord = () => {
    void window.api.shell.openExternal(buildDiscordPostUrl(post));
  };

  const handleOpenRemarkForm = () => {
    setShowRemarkForm(true);
    setShowIssueForm(false);
  };

  const handleOpenIssueForm = () => {
    setShowIssueForm(true);
    setShowRemarkForm(false);
  };

  const handleSendRemark = async () => {
    setRemarkError(null);
    const result = await window.api.bot.sendRemark(post.postId, remarkText);
    if (result.ok) {
      setRemarkText('');
      setShowRemarkForm(false);
    } else {
      setRemarkError(result.error);
    }
  };

  const handleSetStatus = (status: TriageStatus) => {
    setStatusError(null);
    setRemarkText(status === 'approved' ? APPROVED_DEFAULT_REMARK : DECLINED_DEFAULT_REMARK);
    setShowRemarkForm(true);
    setShowIssueForm(false);
    onStatusChange?.(post.postId, status);
    void window.api.bot.setStatus(post.postId, post.starterMessageId, status).then((result) => {
      if (!result.ok) {
        setStatusError(result.error);
      }
    });
  };

  const handleCreateIssue = async () => {
    setIssueError(null);
    setCreatedIssueNumber(null);

    const labels = issueLabels
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label.length > 0);

    const result = await window.api.github.createIssue({
      forumChannelId: post.forumChannelId,
      title: issueTitle,
      body: issueBody,
      labels
    });

    if (result.ok) {
      setCreatedIssueNumber(result.number);
      setIssueTitle('');
      setIssueBody('');
      setIssueLabels('');

      // Auto-notification (009 / PRD user stories 16-17): fire-and-forget —
      // reuses the same sendRemark path as the standalone/approve-decline
      // remarks, deliberately without the issue number/link. Doesn't block
      // or affect the issue-creation success feedback above.
      void window.api.bot.sendRemark(post.postId, ISSUE_CREATED_NOTIFICATION);

      // Optimistic reply injection (022): reflect the notification locally
      // right away, attributed to the bot, without waiting for a re-scan.
      setExtraReplies((current) => [
        ...current,
        { author: BOT_REPLY_AUTHOR, content: ISSUE_CREATED_NOTIFICATION, imageUrls: [] }
      ]);
    } else {
      setIssueError(result.error);
    }
  };

  const isOverlayOpen = showRemarkForm || showIssueForm;

  return (
    <article
      aria-label="Post detail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: colors.bg,
        color: colors.textBody,
        fontFamily: fonts.body
      }}
    >
      <section
        aria-label="Post actions"
        style={{
          flex: '0 0 auto',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '12px 24px',
          background: colors.bgPanel,
          borderBottom: `1px solid ${colors.borderDefault}`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => handleSetStatus('approved')}
            style={approveButtonStyle}
            aria-label="Approve"
            title="Approve"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => handleSetStatus('declined')}
            style={declineButtonStyle}
            aria-label="Decline"
            title="Decline"
          >
            ✕
          </button>
          {statusError && (
            <p role="alert" style={{ color: colors.declined, margin: 0, fontSize: '13px' }}>
              {statusError}
            </p>
          )}

          <button type="button" onClick={handleOpenRemarkForm} style={secondaryButtonStyle}>
            Remark
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="button" onClick={handleViewOnDiscord} style={secondaryButtonStyle}>
            View on Discord
          </button>

          <button type="button" onClick={handleOpenIssueForm} style={secondaryButtonStyle}>
            Generate GitHub issue
          </button>
        </div>

        {/*
          Floating overlay panel (022): anchored below the action bar via
          `position: absolute; top: 100%` on this ancestor `<section>` being
          `position: relative`, rather than being inline flex children of the
          bar. Purely a positioning wrapper — the Remark/Generate GitHub
          issue forms below are otherwise unchanged.
        */}
        {isOverlayOpen && (
          <div
            style={{
              position: 'absolute',
              left: '24px',
              right: '24px',
              top: '100%',
              marginTop: '12px',
              background: colors.bgPanel,
              border: `1px solid ${colors.borderDefault}`,
              borderRadius: '10px',
              padding: '16px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)'
            }}
          >
            {showRemarkForm && (
              <div aria-label="Remark">
                <label htmlFor="remark-text" style={labelStyle}>
                  Remark
                </label>
                <textarea
                  id="remark-text"
                  value={remarkText}
                  onChange={(event) => setRemarkText(event.target.value)}
                  style={textareaStyle}
                />
                <button
                  type="button"
                  onClick={handleSendRemark}
                  disabled={remarkText.trim().length === 0}
                  style={primaryButtonStyle}
                >
                  Send
                </button>
                {remarkError && (
                  <p role="alert" style={{ color: colors.declined, fontSize: '13px' }}>
                    {remarkError}
                  </p>
                )}
              </div>
            )}

            {showIssueForm && (
              <div aria-label="Generate GitHub issue">
                <label htmlFor="issue-title" style={labelStyle}>
                  Title
                </label>
                <input
                  id="issue-title"
                  type="text"
                  value={issueTitle}
                  onChange={(event) => setIssueTitle(event.target.value)}
                  style={inputStyle}
                />

                <label htmlFor="issue-body" style={labelStyle}>
                  Body
                </label>
                <textarea
                  id="issue-body"
                  value={issueBody}
                  onChange={(event) => setIssueBody(event.target.value)}
                  style={textareaStyle}
                />

                <label htmlFor="issue-labels" style={labelStyle}>
                  Labels
                </label>
                <input
                  id="issue-labels"
                  type="text"
                  value={issueLabels}
                  onChange={(event) => setIssueLabels(event.target.value)}
                  placeholder="comma-separated"
                  style={inputStyle}
                />

                <button
                  type="button"
                  onClick={handleCreateIssue}
                  disabled={issueTitle.trim().length === 0}
                  style={primaryButtonStyle}
                >
                  Create issue
                </button>
                {issueError && (
                  <p role="alert" style={{ color: colors.declined, fontSize: '13px' }}>
                    {issueError}
                  </p>
                )}
                {createdIssueNumber !== null && (
                  <p role="status" style={{ color: colors.approved, fontSize: '13px' }}>
                    Issue #{createdIssueNumber} created.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div
        aria-label="Post content"
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          minHeight: 0,
          padding: '20px 24px',
          paddingTop: isOverlayOpen ? '320px' : '20px',
          transition: 'padding-top 150ms ease'
        }}
      >
        <div
          style={{
            background: colors.bgCard,
            border: `1px solid ${colors.borderDefault}`,
            borderRadius: '10px',
            padding: '18px 20px'
          }}
        >
          <h2
            style={{
              fontFamily: fonts.heading,
              color: colors.textPrimary,
              margin: '0 0 8px'
            }}
          >
            {post.title}
          </h2>
          <p style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 16px' }}>
            <strong style={{ color: colors.textPrimary }}>{post.author.name}</strong>
            <span
              aria-label="Status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: STATUS_PILL[post.status].color,
                fontSize: '13px',
                fontFamily: fonts.body
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: STATUS_PILL[post.status].color
                }}
              />
              {STATUS_PILL[post.status].label}
            </span>
          </p>
          <p
            style={{
              color: colors.textBody,
              lineHeight: 1.5,
              margin: 0,
              whiteSpace: 'pre-wrap'
            }}
          >
            {post.content}
          </p>
          {post.imageUrls.map((url) => (
            <img
              key={url}
              src={url}
              alt="Attached image"
              style={{ maxWidth: '100%', borderRadius: '8px', border: `1px solid ${colors.borderDefault}`, marginTop: '12px' }}
            />
          ))}
        </div>

        <p
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: colors.textTertiary,
            fontFamily: fonts.body,
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: '24px 0 10px'
          }}
        >
          {displayedReplies.length === 0 ? 'No replies' : `Thread (${displayedReplies.length})`}
        </p>

        {displayedReplies.length > 0 && (
        <ul
          aria-label="Replies"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            paddingLeft: '16px',
            borderLeft: `2px solid ${colors.borderSubtle}`
          }}
        >
          {displayedReplies.map((reply, index) => (
            <li
              key={index}
              style={{
                background: colors.bgInput,
                border: `1px solid ${colors.borderSubtle}`,
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '10px'
              }}
            >
              <p style={{ margin: '0 0 4px' }}>
                <strong style={{ color: colors.textSecondary, fontSize: '13px' }}>{reply.author.name}</strong>
              </p>
              <p
                style={{
                  margin: 0,
                  color: colors.textBody,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word'
                }}
              >
                {reply.content}
              </p>
              {reply.imageUrls.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt="Attached image"
                  style={{ maxWidth: '100%', borderRadius: '8px', border: `1px solid ${colors.borderDefault}`, marginTop: '8px' }}
                />
              ))}
            </li>
          ))}
        </ul>
        )}
      </div>
    </article>
  );
}

const secondaryButtonStyle: CSSProperties = {
  background: colors.bgCard,
  color: colors.textPrimary,
  border: `1px solid ${colors.borderDefault}`,
  borderRadius: '6px',
  padding: '8px 14px',
  fontFamily: fonts.body,
  fontSize: '13px',
  cursor: 'pointer'
};

const primaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  background: colors.accent,
  color: colors.textPrimary,
  border: `1px solid ${colors.accent}`,
  marginTop: '8px'
};

const statusIconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  padding: 0,
  borderRadius: '6px',
  background: colors.bgCard,
  fontFamily: fonts.body,
  fontSize: '15px',
  lineHeight: 1,
  cursor: 'pointer'
};

const approveButtonStyle: CSSProperties = {
  ...statusIconButtonStyle,
  color: colors.approved,
  border: `1px solid ${colors.approved}`
};

const declineButtonStyle: CSSProperties = {
  ...statusIconButtonStyle,
  color: colors.declined,
  border: `1px solid ${colors.declined}`
};

const labelStyle: CSSProperties = {
  display: 'block',
  color: colors.textSecondary,
  fontSize: '12px',
  margin: '10px 0 4px'
};

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.bgInput,
  color: colors.textPrimary,
  border: `1px solid ${colors.borderInput}`,
  borderRadius: '6px',
  padding: '8px 10px',
  fontFamily: fonts.body,
  fontSize: '13px'
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: '72px',
  resize: 'vertical'
};
