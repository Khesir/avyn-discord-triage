import { useEffect, useState } from 'react';
import Titlebar from './Titlebar';
import Sidebar, { type Section } from './Sidebar';
import SettingsPage from './SettingsPage';
import ScanPanel from './ScanPanel';
import ConsoleDrawer from './ConsoleDrawer';

/**
 * Top-level application shell (PRD: application shell + first-run routing,
 * user stories 8, 11-13) replacing the old flat `App.tsx` stack. Renders the
 * custom titlebar (010) above a sidebar + content row; the sidebar (`Sidebar`)
 * is always fully navigable, and this component owns which section is
 * currently showing.
 *
 * First-run routing: on mount, checks `window.api.secrets.get()` for a saved
 * Discord bot token. If none is saved yet, the shell opens to Settings
 * (nothing to triage without a bot connected yet); otherwise it opens to
 * Triage. This is a one-time decision made once at mount — afterward the
 * reviewer can freely switch sections via the sidebar regardless of setup
 * state (no gating; PRD user story 13, out-of-scope note: the existing
 * inline "Bot process is not running" error in `ScanPanel` is the only
 * feedback for scanning before setup is complete).
 *
 * Section content: Settings renders `SettingsPage` (014), which stacks
 * `Onboarding` then `ForumConfig` as two cards; Triage renders the current
 * `ScanPanel` unchanged (its master-detail restructuring is issue 015's
 * job). A later issue that needs to plug new content into a section should
 * do so by editing the two branches below — the routing/sidebar wiring
 * here does not need to change.
 *
 * Console drawer (013): `consoleOpen` is owned here — a sibling to
 * `activeSection` rather than local state inside `ConsoleDrawer` — so the
 * drawer's open/closed state persists as the reviewer navigates between
 * Triage and Settings instead of resetting per section. It's closed by
 * default and toggled two ways that both drive the same `toggleConsole`
 * function: the button rendered by `Titlebar` (via the `onToggleConsole`
 * callback prop) and a global `` Ctrl+` `` keydown listener registered on
 * `window`, matching the VS Code convention, active from anywhere in the
 * app regardless of which section is showing. It's nested inside the
 * content column (a sibling of `main`, not of the sidebar+content row) so
 * it only spans the content area's width — the sidebar stays full-height
 * and unaffected by whether the drawer is open.
 */
export default function AppShell() {
  const [activeSection, setActiveSection] = useState<Section | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.api.secrets.get().then((secrets) => {
      if (cancelled) return;
      setActiveSection(secrets.discordBotToken ? 'triage' : 'settings');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleConsole = () => setConsoleOpen((current) => !current);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === '`') {
        event.preventDefault();
        toggleConsole();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Titlebar onToggleConsole={toggleConsole} />
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <main aria-label="Content" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
            {activeSection === 'settings' && <SettingsPage />}
            {activeSection === 'triage' && <ScanPanel />}
          </main>
          <ConsoleDrawer open={consoleOpen} />
        </div>
      </div>
    </div>
  );
}
