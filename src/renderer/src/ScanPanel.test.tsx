// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ScanPanel from './ScanPanel';
import type { PulledPost, ScanResult } from '../../shared/ipcTypes';

function installFakeApi(
  overrides: { scan?: () => Promise<ScanResult>; getPulledPosts?: () => Promise<PulledPost[]> } = {}
) {
  let capturedCallback: ((posts: PulledPost[]) => void) | undefined;
  const unsubscribe = vi.fn();
  const onPulledPosts = vi.fn((callback: (posts: PulledPost[]) => void) => {
    capturedCallback = callback;
    return unsubscribe;
  });
  const scan = vi.fn(overrides.scan ?? (() => Promise.resolve({ ok: true as const })));
  const getPulledPosts = vi.fn(overrides.getPulledPosts ?? (() => Promise.resolve([])));

  (window as unknown as { api: Window['api'] }).api = {
    secrets: { get: vi.fn().mockResolvedValue({}), save: vi.fn().mockResolvedValue({ ok: true as const }) },
    forumConfig: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ ok: true as const }),
      remove: vi.fn().mockResolvedValue({ ok: true as const })
    },
    bot: {
      onLog: vi.fn(() => vi.fn()),
      scan,
      onPulledPosts,
      sendRemark: vi.fn().mockResolvedValue({ ok: true as const }),
      setStatus: vi.fn().mockResolvedValue({ ok: true as const }),
      getStatus: vi.fn().mockResolvedValue({ status: 'stopped' as const }),
      onStatus: vi.fn(() => vi.fn()),
      getPulledPosts,
      getForumNames: vi.fn().mockResolvedValue({}),
      setPresence: vi.fn().mockResolvedValue({ ok: true as const }),
      getPresence: vi.fn().mockResolvedValue({ status: 'online' as const, message: '' })
    },
    shell: { openExternal: vi.fn().mockResolvedValue({ ok: true as const }) },
    github: { createIssue: vi.fn().mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' }) },
    windowControls: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
  };

  return {
    scan,
    onPulledPosts,
    getPulledPosts,
    unsubscribe,
    emit: (posts: PulledPost[]) => capturedCallback?.(posts)
  };
}

const samplePost: PulledPost = {
  postId: 'thread-1',
  starterMessageId: 'msg-1',
  forumChannelId: 'forum-1',
  forumName: 'general',
  guildId: 'guild-1',
  title: 'Bug: something broken',
  author: { id: 'user-1', name: 'Alice' },
  content: 'Something is broken when I click the button.',
  imageUrls: [],
  replies: [
    { author: { id: 'user-2', name: 'Bob' }, content: 'Can you share a screenshot?', imageUrls: [] },
    { author: { id: 'user-1', name: 'Alice' }, content: 'Sure, attached.', imageUrls: [] }
  ],
  status: 'pending'
};

let fakeApi: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  fakeApi = installFakeApi();
});

describe('ScanPanel', () => {
  it('renders a Scan button', () => {
    render(<ScanPanel />);

    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument();
  });

  it('subscribes to pulled posts on mount', () => {
    render(<ScanPanel />);

    expect(fakeApi.onPulledPosts).toHaveBeenCalledTimes(1);
  });

  it('clicking Scan calls the bot scan API', async () => {
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('button', { name: /scan/i }));

    await waitFor(() => expect(fakeApi.scan).toHaveBeenCalledTimes(1));
  });

  it('stays in a scanning state until results actually arrive, not just until the request is dispatched', async () => {
    let resolveScan!: (value: { ok: true }) => void;
    fakeApi = installFakeApi({ scan: () => new Promise((resolve) => (resolveScan = resolve)) });
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
    expect(await screen.findByRole('button', { name: /scanning/i })).toBeDisabled();

    resolveScan({ ok: true });
    // The dispatch resolved, but no results have arrived yet — still scanning.
    await waitFor(() => expect(fakeApi.scan).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /scanning/i })).toBeInTheDocument();

    fakeApi.emit([samplePost]);

    await waitFor(() => expect(screen.getByRole('button', { name: /^scan$/i })).not.toBeDisabled());
  });

  it('shows a completion summary with the number of new posts found once results arrive', async () => {
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
    fakeApi.emit([samplePost]);

    expect(await screen.findByText(/found 1 new post/i)).toBeInTheDocument();
  });

  it('shows a "no new posts" summary when a scan completes with zero results', async () => {
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));
    fakeApi.emit([]);

    expect(await screen.findByText(/no new posts/i)).toBeInTheDocument();
  });

  it('shows an error and exits the scanning state when the bot process is not running', async () => {
    fakeApi = installFakeApi({ scan: () => Promise.resolve({ ok: false, error: 'Bot process is not running.' }) });
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bot process is not running.');
    expect(screen.getByRole('button', { name: /^scan$/i })).not.toBeDisabled();
  });

  it('lists pulled post titles and authors as they arrive, without showing full text yet', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);

    expect(await screen.findByText('Bug: something broken')).toBeInTheDocument();
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.queryByText('Something is broken when I click the button.')).not.toBeInTheDocument();
    expect(screen.queryByText('Can you share a screenshot?')).not.toBeInTheDocument();
  });

  it('shows the forum name (not the raw channel ID) as a tab label', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);

    await screen.findByText('Bug: something broken');
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /forum-1/i })).not.toBeInTheDocument();
  });

  it('renders a separate tab per forum when posts come from different forums', async () => {
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, otherForumPost]);

    await screen.findByText('Bug: something broken');
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /feature-requests/i })).toBeInTheDocument();
  });

  it('keeps posts from the same forum under one shared tab, not repeated per post', async () => {
    const samePostSecond: PulledPost = { ...samplePost, postId: 'thread-2', title: 'Another forum-1 post' };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, samePostSecond]);

    await screen.findByText('Another forum-1 post');
    expect(screen.getAllByRole('tab', { name: /general/i })).toHaveLength(1);
  });

  it('shows a count on each tab matching the number of posts in that forum currently matching the active status filter', async () => {
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    const samePostSecond: PulledPost = { ...samplePost, postId: 'thread-3', title: 'Another forum-1 post' };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, samePostSecond, otherForumPost]);
    await screen.findByText('Bug: something broken');

    expect(screen.getByRole('tab', { name: /general/i })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /feature-requests/i })).toHaveTextContent('1');
  });

  it('defaults to the first forum tab and shows only that forum\'s posts in the list', async () => {
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, otherForumPost]);

    await screen.findByText('Bug: something broken');
    expect(screen.queryByText('Different forum post')).not.toBeInTheDocument();
  });

  it('selecting a different tab filters the visible post list to that forum only', async () => {
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, otherForumPost]);
    await screen.findByText('Bug: something broken');

    fireEvent.click(screen.getByRole('tab', { name: /feature-requests/i }));

    expect(await screen.findByText('Different forum post')).toBeInTheDocument();
    expect(screen.queryByText('Bug: something broken')).not.toBeInTheDocument();
  });

  it('marks the active tab as selected via aria-selected', async () => {
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, otherForumPost]);
    await screen.findByText('Bug: something broken');

    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /feature-requests/i })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('tab', { name: /feature-requests/i }));

    expect(screen.getByRole('tab', { name: /general/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /feature-requests/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('narrows the visible list within the active tab when the status filter changes, without switching tabs', async () => {
    const approvedPost: PulledPost = { ...samplePost, status: 'approved' };
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    render(<ScanPanel />);

    fakeApi.emit([approvedPost, otherForumPost]);
    await screen.findByText('Bug: something broken');

    fireEvent.click(screen.getByRole('checkbox', { name: /^approved$/i }));

    // Still on the "general" tab, but its only post was approved and is now filtered out.
    expect(screen.queryByText('Bug: something broken')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /general/i })).toHaveTextContent('0');
    // The other forum's tab and count are unaffected by unchecking "approved".
    expect(screen.getByRole('tab', { name: /feature-requests/i })).toHaveTextContent('1');
  });

  it('shows a filter-scoped empty state within the active tab when its posts are all filtered out, while other tabs remain', async () => {
    const approvedPost: PulledPost = { ...samplePost, status: 'approved' };
    const otherForumPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Different forum post',
      forumChannelId: 'forum-2',
      forumName: 'feature-requests'
    };
    render(<ScanPanel />);

    fakeApi.emit([approvedPost, otherForumPost]);
    await screen.findByText('Bug: something broken');

    fireEvent.click(screen.getByRole('checkbox', { name: /^approved$/i }));

    expect(screen.getByText(/no posts match the selected status filters/i)).toBeInTheDocument();
    // The tab strip itself is still there — the reviewer can switch to the other forum.
    expect(screen.getByRole('tab', { name: /feature-requests/i })).toBeInTheDocument();
  });

  it('shows a placeholder in the post list when no posts have been pulled yet', () => {
    render(<ScanPanel />);

    expect(screen.getByText(/no posts/i)).toBeInTheDocument();
  });

  it('does not show the empty-list placeholder once posts have arrived', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);

    await screen.findByText('Bug: something broken');
    expect(screen.queryByText(/no posts/i)).not.toBeInTheDocument();
  });

  it('shows a placeholder in the detail pane when no post is selected', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);
    await screen.findByText('Bug: something broken');

    expect(screen.getByText(/select a post/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Post detail')).not.toBeInTheDocument();
  });

  it('replaces the detail-pane placeholder with the selected post once one is chosen', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bug: something broken' }));

    await screen.findByText('Something is broken when I click the button.');
    expect(screen.queryByText(/select a post/i)).not.toBeInTheDocument();
  });

  it('keeps the full post list intact and unaffected when switching the selected post', async () => {
    const secondPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Second post',
      content: 'Second post content',
      replies: []
    };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, secondPost]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bug: something broken' }));
    await screen.findByText('Something is broken when I click the button.');

    fireEvent.click(screen.getByRole('button', { name: 'Second post' }));
    await screen.findByText('Second post content');

    // The list itself still shows both rows regardless of which is selected.
    expect(screen.getByRole('button', { name: 'Bug: something broken' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second post' })).toBeInTheDocument();
  });

  it('clicking a pulled post in the list opens its detail view with full post text and all reply text', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bug: something broken' }));

    expect(await screen.findByText('Something is broken when I click the button.')).toBeInTheDocument();
    expect(screen.getByText('Can you share a screenshot?')).toBeInTheDocument();
    expect(screen.getByText('Sure, attached.')).toBeInTheDocument();
  });

  it('clicking a different pulled post switches the detail view to that post', async () => {
    const secondPost: PulledPost = {
      ...samplePost,
      postId: 'thread-2',
      title: 'Second post',
      content: 'Second post content',
      replies: []
    };
    render(<ScanPanel />);

    fakeApi.emit([samplePost, secondPost]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bug: something broken' }));
    await screen.findByText('Something is broken when I click the button.');

    fireEvent.click(screen.getByRole('button', { name: 'Second post' }));

    expect(await screen.findByText('Second post content')).toBeInTheDocument();
    expect(screen.queryByText('Something is broken when I click the button.')).not.toBeInTheDocument();
  });

  it('accumulates pulled posts from multiple scans rather than replacing the list', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);
    await screen.findByText('Bug: something broken');

    const secondPost: PulledPost = { ...samplePost, postId: 'thread-2', title: 'Second post', replies: [] };
    fakeApi.emit([secondPost]);

    expect(await screen.findByText('Second post')).toBeInTheDocument();
    expect(screen.getByText('Bug: something broken')).toBeInTheDocument();
  });

  it('replaces an already-known post\'s content in place on a recovery re-scan, rather than duplicating it', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);
    await screen.findByText('Bug: something broken');

    const refreshed: PulledPost = { ...samplePost, title: 'Bug: something broken (edited)', content: 'Updated repro steps.' };
    fakeApi.emit([refreshed]);

    expect(await screen.findByText('Bug: something broken (edited)')).toBeInTheDocument();
    expect(screen.queryByText('Bug: something broken')).not.toBeInTheDocument();
    expect(screen.getAllByText('Bug: something broken (edited)')).toHaveLength(1);
  });

  it('preserves an already-known post\'s local triage status on a recovery re-scan, even though the fresh pull reports pending', async () => {
    render(<ScanPanel />);

    const approvedPost: PulledPost = { ...samplePost, status: 'approved' };
    fakeApi.emit([approvedPost]);
    await screen.findByText('Bug: something broken');
    fireEvent.click(screen.getByRole('button', { name: 'Bug: something broken' }));
    const detail = screen.getByRole('article', { name: /post detail/i });
    expect(within(detail).getByText('Approved')).toBeInTheDocument();

    // A fresh scan/pull always reports 'pending' — BotService has no knowledge of local triage state.
    const recovered: PulledPost = { ...samplePost, status: 'pending' };
    fakeApi.emit([recovered]);

    expect(within(detail).getByText('Approved')).toBeInTheDocument();
  });

  it('hydrates the post list from persisted pulled posts on mount, so a refresh does not lose them', async () => {
    fakeApi = installFakeApi({ getPulledPosts: () => Promise.resolve([samplePost]) });
    render(<ScanPanel />);

    expect(await screen.findByText('Bug: something broken')).toBeInTheDocument();
    expect(fakeApi.getPulledPosts).toHaveBeenCalledTimes(1);
  });

  it('merges persisted posts with newly arrived ones rather than losing either', async () => {
    fakeApi = installFakeApi({ getPulledPosts: () => Promise.resolve([samplePost]) });
    render(<ScanPanel />);
    await screen.findByText('Bug: something broken');

    const secondPost: PulledPost = { ...samplePost, postId: 'thread-2', title: 'Second post', replies: [] };
    fakeApi.emit([secondPost]);

    expect(await screen.findByText('Second post')).toBeInTheDocument();
    expect(screen.getByText('Bug: something broken')).toBeInTheDocument();
  });

  it('renders an "include already-viewed posts" checkbox, unchecked by default', () => {
    render(<ScanPanel />);

    const checkbox = screen.getByRole('checkbox', { name: /include already-viewed/i });
    expect(checkbox).not.toBeChecked();
  });

  it('scanning without checking the box requests a normal scan (includeViewed: false)', async () => {
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    await waitFor(() => expect(fakeApi.scan).toHaveBeenCalledWith({ includeViewed: false }));
  });

  it('checking the box and scanning requests a recovery scan (includeViewed: true)', async () => {
    render(<ScanPanel />);

    fireEvent.click(screen.getByRole('checkbox', { name: /include already-viewed/i }));
    fireEvent.click(screen.getByRole('button', { name: /^scan$/i }));

    await waitFor(() => expect(fakeApi.scan).toHaveBeenCalledWith({ includeViewed: true }));
  });

  it('renders status filter checkboxes for pending, approved, and declined, all checked by default', () => {
    render(<ScanPanel />);

    expect(screen.getByRole('checkbox', { name: /^pending$/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^approved$/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^declined$/i })).toBeChecked();
  });

  it('unchecking a status filter hides posts with that status from the list', async () => {
    const approvedPost: PulledPost = { ...samplePost, status: 'approved' };
    render(<ScanPanel />);

    fakeApi.emit([approvedPost]);
    await screen.findByText('Bug: something broken');

    fireEvent.click(screen.getByRole('checkbox', { name: /^approved$/i }));

    expect(screen.queryByText('Bug: something broken')).not.toBeInTheDocument();
  });

  it('re-checking a status filter shows posts with that status again', async () => {
    const declinedPost: PulledPost = { ...samplePost, status: 'declined' };
    render(<ScanPanel />);

    fakeApi.emit([declinedPost]);
    await screen.findByText('Bug: something broken');

    fireEvent.click(screen.getByRole('checkbox', { name: /^declined$/i }));
    expect(screen.queryByText('Bug: something broken')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /^declined$/i }));
    expect(screen.getByText('Bug: something broken')).toBeInTheDocument();
  });

  it('treats a legacy persisted post with no status field as pending', async () => {
    const legacyPost = { ...samplePost, status: undefined } as unknown as PulledPost;
    render(<ScanPanel />);

    fakeApi.emit([legacyPost]);
    await screen.findByText('Bug: something broken');

    fireEvent.click(screen.getByRole('checkbox', { name: /^pending$/i }));

    expect(screen.queryByText('Bug: something broken')).not.toBeInTheDocument();
  });

  it('approving a post via its detail view immediately updates its status, moving it between filter buckets without a re-scan', async () => {
    render(<ScanPanel />);

    fakeApi.emit([samplePost]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bug: something broken' }));
    await screen.findByText('Something is broken when I click the button.');

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    // Now approved — unchecking "pending" should no longer hide it, since its live status moved.
    fireEvent.click(screen.getByRole('checkbox', { name: /^pending$/i }));
    expect(screen.getByRole('button', { name: 'Bug: something broken' })).toBeInTheDocument();

    // But unchecking "approved" now does hide it (from the list — its detail pane content, e.g. the
    // <h2> title, may remain visible since a post can stay selected even after being filtered out).
    fireEvent.click(screen.getByRole('checkbox', { name: /^approved$/i }));
    expect(screen.queryByRole('button', { name: 'Bug: something broken' })).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ScanPanel />);

    unmount();

    expect(fakeApi.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
