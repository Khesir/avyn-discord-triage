/**
 * Fixed, always-expanded top-level navigation (PRD user story 8: "a fixed
 * sidebar with icon+label navigation between Triage and Settings"). Purely
 * presentational — the active section lives in the parent shell
 * (`AppShell`, 011) and is passed in, along with a callback fired when the
 * reviewer clicks a different item. Both items are always enabled: per the
 * PRD, nothing is hard-gated on setup/connection state (user story 13).
 */
import { colors, fonts } from './theme';

export type Section = 'triage' | 'settings';

interface SidebarProps {
  /** Which section is currently showing in the content area, for the active-item indicator. `null` before the shell has decided (e.g. still awaiting the first-run routing check). */
  activeSection: Section | null;
  /** Fired with the clicked item's section id. The shell owns the actual state change. */
  onSectionChange: (section: Section) => void;
}

const NAV_ITEMS: ReadonlyArray<{ id: Section; label: string; icon: string }> = [
  { id: 'triage', label: 'Triage', icon: '\u{1F5C2}' /* card index dividers */ },
  { id: 'settings', label: 'Settings', icon: '⚙' /* gear */ }
];

export default function Sidebar({ activeSection, onSectionChange }: SidebarProps) {
  return (
    <nav
      aria-label="Sidebar"
      style={{
        flex: '0 0 200px',
        width: '200px',
        background: colors.bgPanel,
        borderRight: `1px solid ${colors.borderDefault}`,
        padding: '12px 8px',
        overflowY: 'auto'
      }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {NAV_ITEMS.map((item) => {
          const active = activeSection === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSectionChange(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: active ? 'rgba(124, 92, 255, 0.14)' : 'transparent',
                  color: active ? colors.accent : colors.textBody,
                  fontFamily: fonts.body,
                  fontWeight: active ? 600 : 400,
                  fontSize: '14px',
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
