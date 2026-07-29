import { describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from './githubClient';
import type { GitHubFetch } from './githubClient';

/** Fake standing in for the injectable fetch boundary — no real HTTP call is ever made. */
function createFakeFetch(response: { status: number; body: unknown }): GitHubFetch {
  return vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body
  });
}

describe('createGitHubClient — createIssue', () => {
  it('POSTs to the correct repo issues endpoint with an auth header carrying the PAT and a JSON body', async () => {
    const fetchImpl = createFakeFetch({
      status: 201,
      body: { number: 42, html_url: 'https://github.com/acme/widgets/issues/42' }
    });
    const client = createGitHubClient(fetchImpl);

    await client.createIssue('my-pat', {
      repo: 'acme/widgets',
      title: 'Something broke',
      body: 'Details here',
      labels: ['bug']
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/widgets/issues',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-pat'
        }),
        body: JSON.stringify({ title: 'Something broke', body: 'Details here', labels: ['bug'] })
      })
    );
  });

  it('resolves ok:true with the created issue number and URL on success', async () => {
    const fetchImpl = createFakeFetch({
      status: 201,
      body: { number: 42, html_url: 'https://github.com/acme/widgets/issues/42' }
    });
    const client = createGitHubClient(fetchImpl);

    const result = await client.createIssue('my-pat', {
      repo: 'acme/widgets',
      title: 'Something broke',
      body: 'Details here',
      labels: ['bug']
    });

    expect(result).toEqual({ ok: true, number: 42, htmlUrl: 'https://github.com/acme/widgets/issues/42' });
  });

  it('resolves a distinguishable "invalid_token" error on a 401 bad-token response', async () => {
    const fetchImpl = createFakeFetch({ status: 401, body: { message: 'Bad credentials' } });
    const client = createGitHubClient(fetchImpl);

    const result = await client.createIssue('bad-pat', {
      repo: 'acme/widgets',
      title: 'x',
      body: '',
      labels: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('invalid_token');
      expect(result.error).toMatch(/invalid|expired/i);
    }
  });

  it('resolves a distinguishable "not_found" error on a 404 repo-not-found response', async () => {
    const fetchImpl = createFakeFetch({ status: 404, body: { message: 'Not Found' } });
    const client = createGitHubClient(fetchImpl);

    const result = await client.createIssue('my-pat', {
      repo: 'acme/does-not-exist',
      title: 'x',
      body: '',
      labels: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('not_found');
      expect(result.error).toMatch(/not found/i);
    }
  });

  it('resolves a distinguishable "rate_limited" error on a 403 rate-limit response', async () => {
    const fetchImpl = createFakeFetch({
      status: 403,
      body: { message: 'API rate limit exceeded for user.' }
    });
    const client = createGitHubClient(fetchImpl);

    const result = await client.createIssue('my-pat', {
      repo: 'acme/widgets',
      title: 'x',
      body: '',
      labels: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('rate_limited');
      expect(result.error).toMatch(/rate limit/i);
    }
  });

  it('resolves a distinguishable "rate_limited" error on a 429 response', async () => {
    const fetchImpl = createFakeFetch({ status: 429, body: { message: 'Too Many Requests' } });
    const client = createGitHubClient(fetchImpl);

    const result = await client.createIssue('my-pat', {
      repo: 'acme/widgets',
      title: 'x',
      body: '',
      labels: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('rate_limited');
    }
  });

  it('a plain 403 (not rate-limit-worded) is treated as a distinct "unknown" error, not silently swallowed', async () => {
    const fetchImpl = createFakeFetch({ status: 403, body: { message: 'Resource not accessible by personal access token' } });
    const client = createGitHubClient(fetchImpl);

    const result = await client.createIssue('my-pat', {
      repo: 'acme/widgets',
      title: 'x',
      body: '',
      labels: []
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('unknown');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
