import type { CSSProperties } from 'react';
import Onboarding from './Onboarding';
import ForumConfig from './ForumConfig';
import { colors } from './theme';

/**
 * Thin composition of the existing `Onboarding` (credentials) and
 * `ForumConfig` (forum-to-repo mappings) components onto a single Settings
 * page (PRD-ui-layout user stories 9-10, issue 014). Renders them as two
 * visually distinct, stacked cards — Credentials first, then Forum
 * Mappings, matching their real setup dependency (a bot token is needed
 * before mappings are useful).
 *
 * No new business logic: both existing components are used completely
 * as-is, just visually grouped and ordered. Exact card styling (borders,
 * spacing) is a visual concern — see the issue file for the human-QA note.
 */
export default function SettingsPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px', background: colors.bg }}>
      <section style={cardStyle}>
        <Onboarding />
      </section>
      <section style={cardStyle}>
        <ForumConfig />
      </section>
    </div>
  );
}

const cardStyle: CSSProperties = {
  border: `1px solid ${colors.borderDefault}`,
  borderRadius: '12px',
  padding: '24px',
  marginBottom: '20px',
  background: colors.bgCard
};
