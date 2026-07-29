import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { ForumRepoMapping } from '../../shared/ipcTypes';
import { colors, fonts } from './theme';

const emptyForm: ForumRepoMapping = { forumChannelId: '', repo: '' };

const headingStyle: CSSProperties = {
  fontFamily: fonts.heading,
  color: colors.textPrimary,
  fontSize: '20px',
  fontWeight: 600,
  margin: '0 0 16px'
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: '0 0 20px',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const listItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '4px',
  background: colors.bgInput,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: '8px',
  padding: '10px 12px',
  color: colors.textBody,
  fontFamily: fonts.body,
  fontSize: '14px'
};

const rawIdStyle: CSSProperties = {
  color: colors.textTertiary,
  fontFamily: fonts.mono,
  fontSize: '12px'
};

const noRepoStyle: CSSProperties = {
  color: colors.textTertiary,
  fontFamily: fonts.body
};

const removeButtonStyle: CSSProperties = {
  marginLeft: 'auto',
  flexShrink: 0,
  background: 'transparent',
  color: colors.declined,
  border: `1px solid ${colors.borderInput}`,
  borderRadius: '6px',
  padding: '4px 10px',
  fontFamily: fonts.body,
  fontSize: '12px',
  cursor: 'pointer'
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

const monoInputStyle: CSSProperties = {
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

const bodyInputStyle: CSSProperties = {
  ...monoInputStyle,
  fontFamily: fonts.body,
  fontSize: '14px'
};

const alertStyle: CSSProperties = {
  fontFamily: fonts.body,
  color: colors.declined,
  fontSize: '13px',
  marginTop: '10px'
};

export default function ForumConfig() {
  const [mappings, setMappings] = useState<ForumRepoMapping[]>([]);
  const [form, setForm] = useState<ForumRepoMapping>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [forumNames, setForumNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    window.api.forumConfig.list().then((saved) => {
      if (cancelled) return;
      setMappings(saved);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Resolves each mapping's real Discord forum name (shown instead of the raw channel ID) — re-runs
  // whenever the mapping list changes, so a newly added mapping gets its name resolved too. Silently
  // falls back to the raw ID for any forum that can't be resolved (bot not connected, forum not
  // found) — window.api.bot.getForumNames already omits those from its result, never rejects.
  useEffect(() => {
    if (mappings.length === 0) return;
    let cancelled = false;

    window.api.bot.getForumNames(mappings.map((mapping) => mapping.forumChannelId)).then((names) => {
      if (!cancelled) setForumNames(names);
    });

    return () => {
      cancelled = true;
    };
  }, [mappings]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const forumChannelId = form.forumChannelId.trim();
    const repo = form.repo.trim();

    if (!forumChannelId) {
      setError('A forum channel ID is required.');
      return;
    }

    try {
      await window.api.forumConfig.add({ forumChannelId, repo });
      setMappings((current) => [...current, { forumChannelId, repo }]);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping.');
    }
  };

  const handleRemove = async (forumChannelId: string) => {
    setError(null);
    try {
      await window.api.forumConfig.remove(forumChannelId);
      setMappings((current) => current.filter((m) => m.forumChannelId !== forumChannelId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove mapping.');
    }
  };

  return (
    <section aria-label="Forum-to-repo configuration">
      <h1 style={headingStyle}>Forum-to-repo mappings</h1>

      <ul aria-label="Configured mappings" style={listStyle}>
        {mappings.map((mapping) => (
          <li key={mapping.forumChannelId} style={listItemStyle}>
            {forumNames[mapping.forumChannelId] ? (
              <>
                <span>{forumNames[mapping.forumChannelId]}</span>{' '}
                <span style={rawIdStyle}>({mapping.forumChannelId})</span>
              </>
            ) : (
              <span style={rawIdStyle}>{mapping.forumChannelId}</span>
            )}{' '}
            {mapping.repo ? (
              <>
                → <span>{mapping.repo}</span>
              </>
            ) : (
              <em style={noRepoStyle}>(no repo mapped yet)</em>
            )}
            <button type="button" onClick={() => handleRemove(mapping.forumChannelId)} style={removeButtonStyle}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} aria-label="Add forum-to-repo mapping">
        <label htmlFor="forum-channel-id" style={labelStyle}>
          Forum channel ID
        </label>
        <input
          id="forum-channel-id"
          type="text"
          value={form.forumChannelId}
          onChange={(event) => setForm((current) => ({ ...current, forumChannelId: event.target.value }))}
          style={monoInputStyle}
        />

        <label htmlFor="repo" style={labelStyle}>
          Repo (owner/name) — optional, needed for GitHub issue creation
        </label>
        <input
          id="repo"
          type="text"
          value={form.repo}
          onChange={(event) => setForm((current) => ({ ...current, repo: event.target.value }))}
          style={bodyInputStyle}
        />

        {error && (
          <p role="alert" style={alertStyle}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!loaded}
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
            cursor: !loaded ? 'default' : 'pointer',
            opacity: !loaded ? 0.5 : 1
          }}
        >
          Add mapping
        </button>
      </form>
    </section>
  );
}
