// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PostDetail, {
  APPROVED_DEFAULT_REMARK,
  DECLINED_DEFAULT_REMARK,
  ISSUE_CREATED_NOTIFICATION
} from './PostDetail';
import type { PulledPost } from '../../shared/ipcTypes';

function installFakeApi() {
  const openExternal = vi.fn().mockResolvedValue({ ok: true as const });
  const sendRemark = vi.fn().mockResolvedValue({ ok: true as const });
  const setStatus = vi.fn().mockResolvedValue({ ok: true as const });
  const createIssue = vi.fn().mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' });

  (window as unknown as { api: Window['api'] }).api = {
    secrets: { get: vi.fn().mockResolvedValue({}), save: vi.fn().mockResolvedValue({ ok: true as const }) },
    forumConfig: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ ok: true as const }),
      remove: vi.fn().mockResolvedValue({ ok: true as const })
    },
    bot: {
      onLog: vi.fn(() => vi.fn()),
      scan: vi.fn().mockResolvedValue({ ok: true as const }),
      onPulledPosts: vi.fn(() => vi.fn()),
      sendRemark,
      setStatus,
      getStatus: vi.fn().mockResolvedValue({ status: 'stopped' as const }),
      onStatus: vi.fn(() => vi.fn()),
      getPulledPosts: vi.fn().mockResolvedValue([]),
      getForumNames: vi.fn().mockResolvedValue({}),
      setPresence: vi.fn().mockResolvedValue({ ok: true as const }),
      getPresence: vi.fn().mockResolvedValue({ status: 'online' as const, message: '' })
    },
    shell: { openExternal },
    github: { createIssue },
    windowControls: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
  };

  return { openExternal, sendRemark, setStatus, createIssue };
}

const postOnServerA: PulledPost = {
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

const postOnServerB: PulledPost = {
  postId: 'thread-99',
  starterMessageId: 'msg-99',
  forumChannelId: 'forum-42',
  forumName: 'feature-requests',
  guildId: 'guild-77',
  title: 'Feature request: dark mode',
  author: { id: 'user-9', name: 'Carol' },
  content: 'Please add a dark mode toggle.',
  imageUrls: [],
  replies: [{ author: { id: 'user-3', name: 'Dave' }, content: 'Agreed, would love that.', imageUrls: [] }],
  status: 'pending'
};

const postWithImages: PulledPost = {
  postId: 'thread-5',
  starterMessageId: 'msg-5',
  forumChannelId: 'forum-1',
  forumName: 'general',
  guildId: 'guild-1',
  title: 'Post with a screenshot',
  author: { id: 'user-1', name: 'Alice' },
  content: 'Here is the error I am seeing.',
  imageUrls: ['https://cdn.discordapp.com/attachments/1/2/screenshot.png'],
  replies: [
    {
      author: { id: 'user-2', name: 'Bob' },
      content: 'Here is another angle.',
      imageUrls: ['https://cdn.discordapp.com/attachments/1/3/reaction.gif']
    }
  ],
  status: 'pending'
};

let fakeApi: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  fakeApi = installFakeApi();
});

describe('PostDetail', () => {
  it('renders the full post title and content', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.getByText('Bug: something broken')).toBeInTheDocument();
    expect(screen.getByText('Something is broken when I click the button.')).toBeInTheDocument();
  });

  it('shows "No replies" and renders no thread list when the post has no replies', () => {
    render(<PostDetail post={{ ...postOnServerA, replies: [] }} />);

    expect(screen.getByText('No replies')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /replies/i })).not.toBeInTheDocument();
  });

  it('labels the reply list "Thread (N)" once replies exist', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.getByText('Thread (2)')).toBeInTheDocument();
  });

  it('renders all reply text in reading order', () => {
    render(<PostDetail post={postOnServerA} />);

    const replyList = screen.getByRole('list', { name: /replies/i });
    const items = within(replyList).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Can you share a screenshot?'),
      expect.stringContaining('Sure, attached.')
    ]);
  });

  it('renders no images when the post and its replies have none', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the post\'s image and each reply\'s image using the Discord CDN URL directly', () => {
    render(<PostDetail post={postWithImages} />);

    const images = screen.getAllByRole('img');
    const srcs = images.map((img) => img.getAttribute('src'));

    expect(srcs).toContain('https://cdn.discordapp.com/attachments/1/2/screenshot.png');
    expect(srcs).toContain('https://cdn.discordapp.com/attachments/1/3/reaction.gif');
  });

  it('renders a "View on Discord" action', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.getByRole('button', { name: /view on discord/i })).toBeInTheDocument();
  });

  it('clicking "View on Discord" opens the link built from this post\'s guildId and postId', async () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /view on discord/i }));

    expect(fakeApi.openExternal).toHaveBeenCalledWith('https://discord.com/channels/guild-1/thread-1');
  });

  it('a post from a different server builds a different Discord link (not hardcoded)', async () => {
    render(<PostDetail post={postOnServerB} />);

    fireEvent.click(screen.getByRole('button', { name: /view on discord/i }));

    expect(fakeApi.openExternal).toHaveBeenCalledWith('https://discord.com/channels/guild-77/thread-99');
  });
});

describe('PostDetail — status pill', () => {
  it('shows a "Pending" status pill for a pending post', () => {
    render(<PostDetail post={{ ...postOnServerA, status: 'pending' }} />);

    expect(screen.getByLabelText(/status/i)).toHaveTextContent(/pending/i);
  });

  it('shows an "Approved" status pill for an approved post', () => {
    render(<PostDetail post={{ ...postOnServerA, status: 'approved' }} />);

    expect(screen.getByLabelText(/status/i)).toHaveTextContent(/approved/i);
  });

  it('shows a "Declined" status pill for a declined post', () => {
    render(<PostDetail post={{ ...postOnServerA, status: 'declined' }} />);

    expect(screen.getByLabelText(/status/i)).toHaveTextContent(/declined/i);
  });
});

describe('PostDetail — standalone remark', () => {
  function openRemarkForm() {
    fireEvent.click(screen.getByRole('button', { name: /^remark$/i }));
  }

  it('does not render the remark textarea until the Remark button is clicked', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.queryByRole('textbox', { name: /remark/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
  });

  it('clicking Remark reveals an empty remark textarea and a Send button', () => {
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();

    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('typing a remark and clicking Send dispatches sendRemark with this post\'s thread ID and the entered text', async () => {
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), {
      target: { value: 'Can you share your OS version?' }
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(fakeApi.sendRemark).toHaveBeenCalledWith('thread-1', 'Can you share your OS version?');
  });

  it('a remark for a different post uses that post\'s own thread ID', async () => {
    render(<PostDetail post={postOnServerB} />);

    openRemarkForm();
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(fakeApi.sendRemark).toHaveBeenCalledWith('thread-99', 'Thanks!');
  });

  it('the Send button is disabled while the remark textarea is empty', () => {
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('the Send button is enabled once remark text is entered', () => {
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), { target: { value: 'Hi there' } });

    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('closes the remark panel after a successful send', async () => {
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), {
      target: { value: 'Can you share your OS version?' }
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.queryByRole('textbox', { name: /remark/i })).not.toBeInTheDocument());
  });

  it('re-opening the remark panel after a successful send starts with an empty textarea', async () => {
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), {
      target: { value: 'Can you share your OS version?' }
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /remark/i })).not.toBeInTheDocument());

    openRemarkForm();

    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe('');
  });

  it('sending a remark does not add anything to the visible replies list (one-way, no synced chat)', async () => {
    render(<PostDetail post={postOnServerA} />);

    const repliesBefore = within(screen.getByRole('list', { name: /replies/i })).getAllByRole('listitem').length;

    openRemarkForm();
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), { target: { value: 'Any update?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(fakeApi.sendRemark).toHaveBeenCalled());

    const repliesAfter = within(screen.getByRole('list', { name: /replies/i })).getAllByRole('listitem').length;
    expect(repliesAfter).toBe(repliesBefore);
  });

  it('shows an error and keeps the entered text when sending fails', async () => {
    fakeApi.sendRemark.mockResolvedValue({ ok: false, error: 'Thread not found.' });
    render(<PostDetail post={postOnServerA} />);

    openRemarkForm();
    const textarea = screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Any update?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Thread not found.');
    expect(textarea.value).toBe('Any update?');
  });
});

describe('PostDetail — approve/decline', () => {
  it('renders Approve and Decline actions', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('clicking Approve pre-fills the remark textarea with the hardcoded approved default message', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe(
      APPROVED_DEFAULT_REMARK
    );
  });

  it('clicking Decline pre-fills the remark textarea with the hardcoded declined default message', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));

    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe(
      DECLINED_DEFAULT_REMARK
    );
  });

  it('the two default messages are different from each other', () => {
    expect(APPROVED_DEFAULT_REMARK).not.toBe(DECLINED_DEFAULT_REMARK);
  });

  it('the approved default remark matches the design\'s wording', () => {
    expect(APPROVED_DEFAULT_REMARK).toBe(
      "Thanks for flagging this — approved, and it's on the list."
    );
  });

  it('the declined default remark matches the design\'s wording', () => {
    expect(DECLINED_DEFAULT_REMARK).toBe(
      "Thanks for the report — after review, we won't be addressing this one."
    );
  });

  it('clicking Approve applies the ✅ status via setStatus, targeting this post\'s postId and starterMessageId', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(fakeApi.setStatus).toHaveBeenCalledWith('thread-1', 'msg-1', 'approved');
  });

  it('clicking Approve calls onStatusChange with this post\'s ID and "approved", so the list can update immediately', () => {
    const onStatusChange = vi.fn();
    render(<PostDetail post={postOnServerA} onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(onStatusChange).toHaveBeenCalledWith('thread-1', 'approved');
  });

  it('clicking Decline calls onStatusChange with this post\'s ID and "declined"', () => {
    const onStatusChange = vi.fn();
    render(<PostDetail post={postOnServerA} onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));

    expect(onStatusChange).toHaveBeenCalledWith('thread-1', 'declined');
  });

  it('does not throw when onStatusChange is omitted', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(() => fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))).not.toThrow();
  });

  it('clicking Decline applies the ❌ status via setStatus, targeting this post\'s postId and starterMessageId', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));

    expect(fakeApi.setStatus).toHaveBeenCalledWith('thread-1', 'msg-1', 'declined');
  });

  it('approve/decline for a different post targets that post\'s own postId and starterMessageId', () => {
    render(<PostDetail post={postOnServerB} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(fakeApi.setStatus).toHaveBeenCalledWith('thread-99', 'msg-99', 'approved');
  });

  it('the pre-filled remark text is editable before sending', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    const textarea = screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'A personalized thank you!' } });

    expect(textarea.value).toBe('A personalized thank you!');
  });

  it('sending after Approve reuses the same sendRemark IPC call path as a standalone remark', async () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(fakeApi.sendRemark).toHaveBeenCalledWith('thread-1', APPROVED_DEFAULT_REMARK);
  });

  it('sending after Decline posts the edited text, not the original default', async () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /remark/i }), {
      target: { value: 'Edited decline message' }
    });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(fakeApi.sendRemark).toHaveBeenCalledWith('thread-1', 'Edited decline message');
  });

  it('shows an error when applying the status fails, without blocking the pre-filled remark', async () => {
    fakeApi.setStatus.mockResolvedValue({ ok: false, error: 'Message not found.' });
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Message not found.');
    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe(
      APPROVED_DEFAULT_REMARK
    );
  });
});

describe('PostDetail — generate GitHub issue', () => {
  it('renders a "Generate GitHub issue" action', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.getByRole('button', { name: /generate github issue/i })).toBeInTheDocument();
  });

  it('the compose fields are not shown until "Generate GitHub issue" is clicked', () => {
    render(<PostDetail post={postOnServerA} />);

    expect(screen.queryByRole('textbox', { name: /^title$/i })).not.toBeInTheDocument();
  });

  it('clicking "Generate GitHub issue" opens blank title/body/labels fields', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));

    expect((screen.getByRole('textbox', { name: /^title$/i }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: /^body$/i }) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: /^labels$/i }) as HTMLInputElement).value).toBe('');
  });

  it('the fields are not pre-filled with any of the pulled post/thread content', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));

    expect((screen.getByRole('textbox', { name: /^title$/i }) as HTMLInputElement).value).not.toContain(
      postOnServerA.title
    );
    expect((screen.getByRole('textbox', { name: /^body$/i }) as HTMLTextAreaElement).value).not.toContain(
      postOnServerA.content
    );
  });
});

describe('PostDetail — generate GitHub issue — submit', () => {
  function openAndFillIssueForm(title: string, body: string, labels: string) {
    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /^title$/i }), { target: { value: title } });
    fireEvent.change(screen.getByRole('textbox', { name: /^body$/i }), { target: { value: body } });
    fireEvent.change(screen.getByRole('textbox', { name: /^labels$/i }), { target: { value: labels } });
  }

  it('the "Create issue" button is disabled while the title is empty', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));

    expect(screen.getByRole('button', { name: /^create issue$/i })).toBeDisabled();
  });

  it('submitting sends the post\'s forumChannelId plus the entered title/body/labels via IPC', async () => {
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps to reproduce', 'bug, urgent');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    expect(fakeApi.createIssue).toHaveBeenCalledWith({
      forumChannelId: 'forum-1',
      title: 'Something broke',
      body: 'Steps to reproduce',
      labels: ['bug', 'urgent']
    });
  });

  it('a blank labels field submits an empty labels array', async () => {
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', '');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    expect(fakeApi.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [] })
    );
  });

  it('shows a success confirmation with the created issue number after a successful submit', async () => {
    fakeApi.createIssue.mockResolvedValue({ ok: true, number: 55, htmlUrl: 'https://github.com/acme/widgets/issues/55' });
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    expect(await screen.findByText(/55/)).toBeInTheDocument();
  });

  it('clears the compose fields after a successful submit', async () => {
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: /^title$/i }) as HTMLInputElement).value).toBe('')
    );
  });

  it('shows a clear error and keeps the entered fields when the GitHub API call fails (e.g. bad token)', async () => {
    fakeApi.createIssue.mockResolvedValue({ ok: false, error: 'GitHub rejected the request: invalid or expired token.' });
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired token');
    expect((screen.getByRole('textbox', { name: /^title$/i }) as HTMLInputElement).value).toBe('Something broke');
  });

  it('shows a clear error when the repo is not found', async () => {
    fakeApi.createIssue.mockResolvedValue({ ok: false, error: 'GitHub repo not found.' });
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('repo not found');
  });

  it('an issue for a different post uses that post\'s own forumChannelId', async () => {
    render(<PostDetail post={postOnServerB} />);

    openAndFillIssueForm('Dark mode request', 'Please add it', '');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    expect(fakeApi.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ forumChannelId: 'forum-42' })
    );
  });
});

describe('PostDetail — remark form / GitHub issue form mutual exclusion', () => {
  it('opening the GitHub issue form while the remark form is open closes the remark form', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /^remark$/i }));
    expect(screen.getByRole('textbox', { name: /remark/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));

    expect(screen.queryByRole('textbox', { name: /remark/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^title$/i })).toBeInTheDocument();
  });

  it('opening the remark form while the GitHub issue form is open closes the GitHub issue form', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));
    expect(screen.getByRole('textbox', { name: /^title$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^remark$/i }));

    expect(screen.queryByRole('textbox', { name: /^title$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /remark/i })).toBeInTheDocument();
  });

  it('clicking Approve while the GitHub issue form is open closes the GitHub issue form and opens the remark form', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));
    expect(screen.getByRole('textbox', { name: /^title$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    expect(screen.queryByRole('textbox', { name: /^title$/i })).not.toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe(
      APPROVED_DEFAULT_REMARK
    );
  });

  it('clicking Decline while the GitHub issue form is open closes the GitHub issue form and opens the remark form', () => {
    render(<PostDetail post={postOnServerA} />);

    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));
    expect(screen.getByRole('textbox', { name: /^title$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));

    expect(screen.queryByRole('textbox', { name: /^title$/i })).not.toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: /remark/i }) as HTMLTextAreaElement).value).toBe(
      DECLINED_DEFAULT_REMARK
    );
  });
});

describe('PostDetail — post-issue-creation auto-notification', () => {
  function openAndFillIssueForm(title: string, body: string, labels: string) {
    fireEvent.click(screen.getByRole('button', { name: /generate github issue/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /^title$/i }), { target: { value: title } });
    fireEvent.change(screen.getByRole('textbox', { name: /^body$/i }), { target: { value: body } });
    fireEvent.change(screen.getByRole('textbox', { name: /^labels$/i }), { target: { value: labels } });
  }

  it('a successful issue creation automatically sends the hardcoded notification remark to this post\'s thread', async () => {
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    await waitFor(() =>
      expect(fakeApi.sendRemark).toHaveBeenCalledWith('thread-1', ISSUE_CREATED_NOTIFICATION)
    );
  });

  it('the auto-sent notification text never contains the created issue\'s number or URL', async () => {
    fakeApi.createIssue.mockResolvedValue({
      ok: true,
      number: 4242,
      htmlUrl: 'https://github.com/acme/widgets/issues/4242'
    });
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    await waitFor(() => expect(fakeApi.sendRemark).toHaveBeenCalled());

    const [, sentText] = fakeApi.sendRemark.mock.calls[0];
    expect(sentText).not.toContain('4242');
    expect(sentText).not.toContain('https://github.com/acme/widgets/issues/4242');
  });

  it('a failed issue creation does not send any notification remark', async () => {
    fakeApi.createIssue.mockResolvedValue({ ok: false, error: 'GitHub rejected the request.' });
    render(<PostDetail post={postOnServerA} />);

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    await screen.findByRole('alert');
    expect(fakeApi.sendRemark).not.toHaveBeenCalled();
  });

  it('a successful issue creation appends the notification text to the local replies list immediately', async () => {
    render(<PostDetail post={postOnServerA} />);

    const repliesBefore = within(screen.getByRole('list', { name: /replies/i })).getAllByRole('listitem').length;

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    const replyList = screen.getByRole('list', { name: /replies/i });
    await waitFor(() =>
      expect(within(replyList).getAllByRole('listitem').length).toBe(repliesBefore + 1)
    );
    expect(within(replyList).getByText(ISSUE_CREATED_NOTIFICATION)).toBeInTheDocument();
  });

  it('a failed issue creation does not append anything to the local replies list', async () => {
    fakeApi.createIssue.mockResolvedValue({ ok: false, error: 'GitHub rejected the request.' });
    render(<PostDetail post={postOnServerA} />);

    const repliesBefore = within(screen.getByRole('list', { name: /replies/i })).getAllByRole('listitem').length;

    openAndFillIssueForm('Something broke', 'Steps', 'bug');
    fireEvent.click(screen.getByRole('button', { name: /^create issue$/i }));

    await screen.findByRole('alert');
    const repliesAfter = within(screen.getByRole('list', { name: /replies/i })).getAllByRole('listitem').length;
    expect(repliesAfter).toBe(repliesBefore);
  });
});
