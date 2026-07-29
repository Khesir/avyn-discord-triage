/**
 * GitHub Client — the REST API wrapper that creates GitHub issues, running
 * directly in the main process (not the bot's utility process; PRD: "GitHub
 * Client (the REST API wrapper running in main)"). Written against a minimal
 * injectable HTTP boundary (`GitHubFetch`) rather than importing a concrete
 * HTTP library, so it can be unit-tested against a faked HTTP layer per the
 * PRD's Testing Decisions, without hitting the real GitHub API.
 *
 * Issue creation is authored manually by the reviewer (008) — this module
 * only constructs the request and interprets the response; it does no
 * drafting, no forum-tag-to-label mapping, and does not shell out to `gh`
 * (all explicitly rejected per the PRD).
 */

/** Minimal shape of a fetch Response this client needs — kept structural so any fetch-like implementation can satisfy it. */
export interface GitHubFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Injectable HTTP boundary. Production wires this to the global `fetch`; tests supply a fake. */
export type GitHubFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<GitHubFetchResponse>;

export interface CreateIssueParams {
  /** `owner/name` — resolved from the post's forumChannelId via the forum-to-repo mapping (003). */
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

/**
 * Distinguishes *why* issue creation failed, so callers (the IPC handler,
 * and eventually 009's auto-notification trigger) can react differently to
 * an invalid token vs. a missing repo vs. a rate limit, per the acceptance
 * criteria ("bad token, repo not found, rate limit ... surface clearly").
 */
export type CreateIssueErrorType = 'invalid_token' | 'not_found' | 'rate_limited' | 'unknown';

export type CreateIssueResult =
  | { ok: true; number: number; htmlUrl: string }
  | { ok: false; error: string; errorType: CreateIssueErrorType };

export interface GitHubClient {
  /** Creates an issue via `POST /repos/{owner}/{repo}/issues`, authenticated with the given PAT. */
  createIssue(pat: string, params: CreateIssueParams): Promise<CreateIssueResult>;
}

function errorTypeForStatus(status: number, message: string): CreateIssueErrorType {
  if (status === 401) {
    return 'invalid_token';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 429 || (status === 403 && /rate limit/i.test(message))) {
    return 'rate_limited';
  }
  return 'unknown';
}

function messageForError(errorType: CreateIssueErrorType, status: number, apiMessage: string): string {
  switch (errorType) {
    case 'invalid_token':
      return 'GitHub rejected the request: the stored personal access token is invalid or expired.';
    case 'not_found':
      return 'GitHub repo not found (check the forum-to-repo mapping and that the token has access to it).';
    case 'rate_limited':
      return 'GitHub API rate limit exceeded. Please wait and try again.';
    default:
      return apiMessage ? `GitHub issue creation failed (${status}): ${apiMessage}` : `GitHub issue creation failed (${status}).`;
  }
}

export function createGitHubClient(fetchImpl: GitHubFetch = fetch): GitHubClient {
  return {
    createIssue: async (pat: string, { repo, title, body, labels }: CreateIssueParams): Promise<CreateIssueResult> => {
      const response = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'avyn-app'
        },
        body: JSON.stringify({ title, body, labels })
      });

      const payload = (await response.json().catch(() => ({}))) as { message?: string; number?: number; html_url?: string };

      if (response.ok) {
        return { ok: true, number: payload.number as number, htmlUrl: payload.html_url as string };
      }

      const apiMessage = payload.message ?? '';
      const errorType = errorTypeForStatus(response.status, apiMessage);
      return { ok: false, error: messageForError(errorType, response.status, apiMessage), errorType };
    }
  };
}
