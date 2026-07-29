import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import BotStatus from './BotStatus';
import { colors, fonts } from './theme';
import type { BotPresence, PresenceStatus } from '../../shared/ipcTypes';
import { DEFAULT_BOT_PRESENCE } from '../../shared/ipcTypes';

/**
 * `-webkit-app-region` is an Electron-only CSS extension that makes an
 * element draggable-as-titlebar (or exempts it from a draggable ancestor).
 * It isn't part of csstype's `CSSProperties` yet, so it's narrowly extended
 * here rather than reaching for an `as` cast at every call site.
 */
interface AppRegionStyle extends CSSProperties {
  WebkitAppRegion?: 'drag' | 'no-drag';
}

const dragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'drag' };
const noDragRegionStyle: AppRegionStyle = { WebkitAppRegion: 'no-drag' };

const titlebarButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '24px',
  padding: 0,
  border: 'none',
  borderRadius: '4px',
  background: 'transparent',
  color: colors.textSecondary,
  fontFamily: fonts.mono,
  fontSize: '13px',
  lineHeight: 1,
  cursor: 'pointer'
};

/** The four selectable Discord presence options (019) — order matches the reference mockup. */
const PRESENCE_OPTIONS: { value: PresenceStatus; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'dnd', label: 'Do Not Disturb' },
  { value: 'invisible', label: 'Invisible' }
];

/**
 * `BotStatus` (012) renders its own status text as `<span data-status="…">`
 * — that attribute exists precisely so a wrapping component can theme it
 * without reaching into `BotStatus`'s own styling. This scoped `<style>`
 * tag (allowed under the app's `style-src 'self' 'unsafe-inline'` CSP)
 * targets it via a descendant selector rather than editing `BotStatus.tsx`,
 * which is out of scope for this re-skin. Button hover/active treatment
 * lives here too since inline `style={{}}` objects can't express `:hover`.
 */
const titlebarStyleTag = `
  .avyn-titlebar-btn:hover {
    background: ${colors.bgCard};
    color: ${colors.textPrimary};
  }
  .avyn-titlebar-btn:active {
    background: ${colors.borderDefault};
  }
  .avyn-titlebar-status [data-status] {
    font-family: ${fonts.body};
  }
  .avyn-titlebar-status [data-status='stopped'] {
    color: ${colors.notConnected};
  }
  .avyn-titlebar-status [data-status='connecting'] {
    color: ${colors.connecting};
  }
  .avyn-titlebar-status [data-status='connected'] {
    color: ${colors.connected};
  }
  .avyn-titlebar-status [data-status='error'] {
    color: ${colors.connError};
  }
  .avyn-titlebar-status [role='alert'] {
    color: ${colors.connError};
    font-family: ${fonts.body};
  }
  .avyn-presence-option:hover {
    background: ${colors.bgCard};
  }
  .avyn-presence-update-btn:hover {
    background: ${colors.accentHover};
  }
`;

/**
 * Custom, app-owned titlebar (010) replacing the OS-native one now that the
 * `BrowserWindow` is frameless. The container is a drag region so the
 * window can be moved the way an OS titlebar would be; the button group
 * inside it is carved out as a no-drag region so the buttons stay
 * clickable rather than being swallowed by the drag handler.
 *
 * Layout: the app title sits alone on the left (conventional titlebar
 * placement, and the drag region is otherwise empty there — no interactive
 * elements should live in that empty space). The bot connection-status
 * indicator (012) — now also the presence menu's trigger (019) — the
 * console-drawer toggle (013), and the three window-control buttons are
 * grouped together on the right, in that order, immediately adjacent to
 * each other.
 *
 * The console-drawer toggle button (013) doesn't own any state itself — it
 * just calls the `onToggleConsole` callback passed down from `AppShell`,
 * which owns `consoleOpen` so the drawer's state survives section
 * navigation. The same callback is also wired to a global `` Ctrl+` ``
 * shortcut at the `AppShell` level.
 *
 * Bot presence menu (019): clicking the connection-status indicator opens a
 * menu of the bot's Discord presence options, but only while the bot is
 * actually connected — clicking while disconnected/connecting/errored does
 * nothing (acceptance criteria). Rather than tracking connection status as
 * its own piece of component state (which would drift from `BotStatus`'s
 * own subscription), the click handler re-reads the current status fresh
 * from `window.api.bot.getStatus()` on every click — the single source of
 * truth for "is the bot connected right now" already lives in main
 * (BotProcessManager.getStatus()), so this avoids a second, potentially
 * stale local copy. Selecting a presence option applies it immediately;
 * the custom status-message field only applies on explicit "Update" click,
 * never on keystroke — per the acceptance criteria.
 */
interface TitlebarProps {
  onToggleConsole: () => void;
}

export default function Titlebar({ onToggleConsole }: TitlebarProps) {
  const [presenceMenuOpen, setPresenceMenuOpen] = useState(false);
  const [presence, setPresence] = useState<BotPresence>(DEFAULT_BOT_PRESENCE);
  const [statusMessageInput, setStatusMessageInput] = useState('');

  useEffect(() => {
    let cancelled = false;

    window.api.bot.getPresence().then((initial) => {
      if (cancelled) return;
      setPresence(initial);
      setStatusMessageInput(initial.message);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleMinimize = () => {
    void window.api.windowControls.minimize();
  };

  const handleToggleMaximize = () => {
    void window.api.windowControls.toggleMaximize();
  };

  const handleClose = () => {
    void window.api.windowControls.close();
  };

  const handleStatusIndicatorClick = () => {
    void window.api.bot.getStatus().then((current) => {
      if (current.status !== 'connected') return;
      setPresenceMenuOpen((open) => !open);
    });
  };

  const handleSelectPresence = (status: PresenceStatus) => {
    // Applies immediately (no confirm step for a single-choice selection, per acceptance criteria)
    // — keeps whatever status message was last confirmed via "Update", not any unconfirmed text
    // currently sitting in the input.
    setPresence((prev) => ({ ...prev, status }));
    void window.api.bot.setPresence(status, presence.message);
  };

  const handleUpdateStatusMessage = () => {
    setPresence((prev) => ({ ...prev, message: statusMessageInput }));
    void window.api.bot.setPresence(presence.status, statusMessageInput);
  };

  return (
    <header
      role="banner"
      aria-label="Titlebar"
      style={{
        ...dragRegionStyle,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '36px',
        padding: '0 12px',
        background: colors.bgPanel,
        borderBottom: `1px solid ${colors.borderDefault}`,
        color: colors.textBody,
        fontFamily: fonts.body,
        fontSize: '13px'
      }}
    >
      <style>{titlebarStyleTag}</style>
      <div
        style={{
          fontFamily: fonts.heading,
          fontWeight: 600,
          fontSize: '13px',
          color: colors.textPrimary,
          letterSpacing: '0.02em'
        }}
      >
        Avyn
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ ...noDragRegionStyle, position: 'relative' }}>
          {/*
            A `<div role="button">` rather than a real `<button>` — `BotStatus` renders a `<section>`
            (flow content), and the HTML content model for `<button>` only permits phrasing content,
            so nesting it there would be invalid markup. `tabIndex`/`onKeyDown` keep it keyboard
            operable (Enter/Space), matching native button behavior.
          */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Bot presence menu"
            aria-haspopup="menu"
            aria-expanded={presenceMenuOpen}
            onClick={handleStatusIndicatorClick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleStatusIndicatorClick();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer'
            }}
          >
            <div className="avyn-titlebar-status">
              <BotStatus />
            </div>
          </div>
          {presenceMenuOpen && (
            <div
              role="menu"
              aria-label="Bot presence"
              style={{
                position: 'absolute',
                top: '28px',
                right: 0,
                zIndex: 20,
                minWidth: '220px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                background: colors.bgPanel,
                border: `1px solid ${colors.borderMenu}`,
                borderRadius: '8px',
                padding: '8px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                fontFamily: fonts.body,
                fontSize: '13px'
              }}
            >
              {PRESENCE_OPTIONS.map((option) => {
                const selected = presence.status === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => handleSelectPresence(option.value)}
                    className="avyn-presence-option"
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      border: 'none',
                      borderRadius: '4px',
                      background: selected ? colors.bgCard : 'transparent',
                      color: selected ? colors.accent : colors.textPrimary,
                      fontFamily: fonts.body,
                      fontSize: '13px',
                      cursor: 'pointer'
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
              <div style={{ borderTop: `1px solid ${colors.borderDefault}`, margin: '6px 0' }} />
              <label
                htmlFor="avyn-presence-message"
                style={{ color: colors.textSecondary, fontSize: '11px', padding: '0 8px' }}
              >
                Status message
              </label>
              <div style={{ display: 'flex', gap: '6px', padding: '4px 8px 0' }}>
                <input
                  id="avyn-presence-message"
                  type="text"
                  value={statusMessageInput}
                  onChange={(event) => setStatusMessageInput(event.target.value)}
                  placeholder="What's happening?"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: colors.bgInput,
                    border: `1px solid ${colors.borderInput}`,
                    borderRadius: '4px',
                    color: colors.textPrimary,
                    padding: '4px 6px',
                    fontFamily: fonts.body,
                    fontSize: '12px'
                  }}
                />
                <button
                  type="button"
                  onClick={handleUpdateStatusMessage}
                  className="avyn-presence-update-btn"
                  style={{
                    background: colors.accent,
                    color: colors.textPrimary,
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontFamily: fonts.body,
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Update
                </button>
              </div>
            </div>
          )}
        </div>
        <div style={{ ...noDragRegionStyle, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className="avyn-titlebar-btn"
            aria-label="Toggle console drawer"
            onClick={onToggleConsole}
            style={titlebarButtonStyle}
          >
            &#x2318;
          </button>
          <button
            type="button"
            className="avyn-titlebar-btn"
            aria-label="Minimize window"
            onClick={handleMinimize}
            style={titlebarButtonStyle}
          >
            &#x2013;
          </button>
          <button
            type="button"
            className="avyn-titlebar-btn"
            aria-label="Maximize or restore window"
            onClick={handleToggleMaximize}
            style={titlebarButtonStyle}
          >
            &#x25a1;
          </button>
          <button
            type="button"
            className="avyn-titlebar-btn"
            aria-label="Close window"
            onClick={handleClose}
            style={titlebarButtonStyle}
          >
            &#x2715;
          </button>
        </div>
      </div>
    </header>
  );
}
