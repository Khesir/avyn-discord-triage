import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { SecretsPayload } from '../../shared/ipcTypes';
import { colors, fonts } from './theme';

const emptyForm: SecretsPayload = { discordBotToken: '', githubPat: '' };

const headingStyle: CSSProperties = {
  fontFamily: fonts.heading,
  color: colors.textPrimary,
  fontSize: '20px',
  fontWeight: 600,
  margin: '0 0 16px'
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontFamily: fonts.body,
  color: colors.textSecondary,
  fontSize: '13px',
  fontWeight: 500,
  marginTop: '14px',
  marginBottom: '6px'
};

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.bgInput,
  border: `1px solid ${colors.borderInput}`,
  borderRadius: '6px',
  padding: '10px 12px',
  color: colors.textPrimary,
  fontFamily: fonts.mono,
  fontSize: '13px',
  outline: 'none'
};

const alertStyle: CSSProperties = {
  fontFamily: fonts.body,
  color: colors.declined,
  fontSize: '13px',
  marginTop: '10px'
};

const statusStyle: CSSProperties = {
  fontFamily: fonts.body,
  color: colors.approved,
  fontSize: '13px',
  marginTop: '10px'
};

export default function Onboarding() {
  const [form, setForm] = useState<SecretsPayload>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.api.secrets.get().then((saved) => {
      if (cancelled) return;
      setForm({
        discordBotToken: saved.discordBotToken ?? '',
        githubPat: saved.githubPat ?? ''
      });
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!form.discordBotToken.trim()) {
      setError('The Discord bot token is required.');
      return;
    }

    setStatus('saving');
    try {
      await window.api.secrets.save(form);
      setStatus('saved');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Failed to save credentials.');
    }
  };

  const saveDisabled = !loaded || status === 'saving';

  return (
    <form onSubmit={handleSubmit} aria-label="Onboarding">
      <h1 style={headingStyle}>Connect Avyn</h1>

      <label htmlFor="discord-bot-token" style={labelStyle}>
        Discord bot token
      </label>
      <input
        id="discord-bot-token"
        type="password"
        autoComplete="off"
        value={form.discordBotToken}
        onChange={(event) => setForm((current) => ({ ...current, discordBotToken: event.target.value }))}
        style={inputStyle}
      />

      <label htmlFor="github-pat" style={labelStyle}>
        GitHub personal access token (optional — needed for GitHub issue creation)
      </label>
      <input
        id="github-pat"
        type="password"
        autoComplete="off"
        value={form.githubPat}
        onChange={(event) => setForm((current) => ({ ...current, githubPat: event.target.value }))}
        style={inputStyle}
      />

      {error && (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      )}
      {status === 'saved' && (
        <p role="status" style={statusStyle}>
          Credentials saved.
        </p>
      )}

      <button
        type="submit"
        disabled={saveDisabled}
        style={{
          marginTop: '16px',
          background: colors.accent,
          color: colors.textPrimary,
          border: 'none',
          borderRadius: '6px',
          padding: '10px 20px',
          fontFamily: fonts.body,
          fontWeight: 600,
          fontSize: '14px',
          cursor: saveDisabled ? 'default' : 'pointer',
          opacity: saveDisabled ? 0.5 : 1
        }}
      >
        Save
      </button>
    </form>
  );
}
