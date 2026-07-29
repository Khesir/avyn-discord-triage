// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Onboarding from './Onboarding';

function installFakeApi(overrides: Partial<Window['api']['secrets']> = {}) {
  const secrets = {
    get: vi.fn().mockResolvedValue({}),
    save: vi.fn().mockResolvedValue({ ok: true as const }),
    ...overrides
  };
  const forumConfig = {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({ ok: true as const }),
    remove: vi.fn().mockResolvedValue({ ok: true as const })
  };
  const bot = {
    onLog: vi.fn(() => vi.fn()),
    scan: vi.fn().mockResolvedValue({ ok: true as const }),
    onPulledPosts: vi.fn(() => vi.fn()),
    sendRemark: vi.fn().mockResolvedValue({ ok: true as const }),
    setStatus: vi.fn().mockResolvedValue({ ok: true as const }),
    getStatus: vi.fn().mockResolvedValue({ status: 'stopped' as const }),
    onStatus: vi.fn(() => vi.fn()),
    getPulledPosts: vi.fn().mockResolvedValue([]),
    getForumNames: vi.fn().mockResolvedValue({}),
    setPresence: vi.fn().mockResolvedValue({ ok: true as const }),
    getPresence: vi.fn().mockResolvedValue({ status: 'online' as const, message: '' })
  };
  const shell = { openExternal: vi.fn().mockResolvedValue({ ok: true as const }) };
  const github = { createIssue: vi.fn().mockResolvedValue({ ok: true as const, number: 1, htmlUrl: 'https://github.com/acme/widgets/issues/1' }) };
  const windowControls = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
  (window as unknown as { api: Window['api'] }).api = { secrets, forumConfig, bot, shell, github, windowControls };
  return secrets;
}

beforeEach(() => {
  installFakeApi();
});

describe('Onboarding', () => {
  it('renders a Discord bot token field and a GitHub PAT field', async () => {
    render(<Onboarding />);

    expect(await screen.findByLabelText(/discord bot token/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/github.*token|github pat/i)).toBeInTheDocument();
  });

  it('pre-fills both fields, masked, from previously saved secrets without the user re-entering them', async () => {
    installFakeApi({
      get: vi.fn().mockResolvedValue({
        discordBotToken: 'already-saved-discord-token',
        githubPat: 'already-saved-github-pat'
      })
    });

    render(<Onboarding />);

    const discordField = (await screen.findByLabelText(/discord bot token/i)) as HTMLInputElement;
    const githubField = (await screen.findByLabelText(/github.*token|github pat/i)) as HTMLInputElement;

    await waitFor(() => expect(discordField.value).toBe('already-saved-discord-token'));
    expect(githubField.value).toBe('already-saved-github-pat');

    expect(discordField.type).toBe('password');
    expect(githubField.type).toBe('password');
  });

  it('shows a validation message and does not call save when the Discord bot token is left empty', async () => {
    const secrets = installFakeApi();
    render(<Onboarding />);

    const saveButton = await screen.findByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i);
    expect(secrets.save).not.toHaveBeenCalled();
  });

  it('saves with just the Discord bot token when the GitHub PAT is left blank', async () => {
    const secrets = installFakeApi();
    render(<Onboarding />);

    fireEvent.change(await screen.findByLabelText(/discord bot token/i), {
      target: { value: 'new-discord-token' }
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(secrets.save).toHaveBeenCalledWith({
        discordBotToken: 'new-discord-token',
        githubPat: ''
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
  });

  it('saves both entered values when the form is submitted with both fields filled', async () => {
    const secrets = installFakeApi();
    render(<Onboarding />);

    const discordField = await screen.findByLabelText(/discord bot token/i);
    const githubField = await screen.findByLabelText(/github.*token|github pat/i);

    fireEvent.change(discordField, { target: { value: 'new-discord-token' } });
    fireEvent.change(githubField, { target: { value: 'new-github-pat' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(secrets.save).toHaveBeenCalledWith({
        discordBotToken: 'new-discord-token',
        githubPat: 'new-github-pat'
      })
    );
  });

  it('confirms the save succeeded', async () => {
    const secrets = installFakeApi();
    render(<Onboarding />);

    fireEvent.change(await screen.findByLabelText(/discord bot token/i), {
      target: { value: 'new-discord-token' }
    });
    fireEvent.change(screen.getByLabelText(/github.*token|github pat/i), {
      target: { value: 'new-github-pat' }
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(secrets.save).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
  });

  it('never logs entered token values to the console', async () => {
    installFakeApi();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Onboarding />);

    fireEvent.change(await screen.findByLabelText(/discord bot token/i), {
      target: { value: 'super-secret-discord-token' }
    });
    fireEvent.change(screen.getByLabelText(/github.*token|github pat/i), {
      target: { value: 'super-secret-github-pat' }
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(window.api.secrets.save).toHaveBeenCalled());

    const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => JSON.stringify(arg))
      .join('\n');

    expect(allLoggedText).not.toContain('super-secret-discord-token');
    expect(allLoggedText).not.toContain('super-secret-github-pat');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
