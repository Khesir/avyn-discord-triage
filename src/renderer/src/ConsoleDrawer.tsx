import { useEffect, useRef, useState } from 'react';
import BotConsole from './BotConsole';
import { colors } from './theme';

const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

interface ConsoleDrawerProps {
  open: boolean;
}

function clampHeight(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height));
}

/**
 * Bottom-docked, resizable drawer (013) wrapping the existing `BotConsole`
 * component unchanged. Open/closed state is fully controlled by the parent
 * (`AppShell`) so it survives navigation between Triage and Settings; this
 * component only owns its own resize height, which is presentational and
 * doesn't need to survive a close/reopen.
 *
 * Matches the codebase's existing "hidden until triggered" convention (see
 * `PostDetail`'s `showRemarkForm`/`showIssueForm`): when closed, nothing is
 * rendered at all rather than being rendered-but-CSS-hidden, so `BotConsole`
 * (and its log subscription) only mounts while the drawer is actually open.
 */
export default function ConsoleDrawer({ open }: ConsoleDrawerProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ y: 0, height: DEFAULT_HEIGHT });

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    dragStartRef.current = { y: event.clientY, height };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      // Dragging the handle up (smaller clientY) grows the drawer, matching
      // a bottom-docked panel — mirrors VS Code's terminal resize direction.
      const delta = dragStartRef.current.y - event.clientY;
      setHeight(clampHeight(dragStartRef.current.height + delta));
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!open) return null;

  return (
    <section
      aria-label="Console drawer"
      style={{
        flex: '0 0 auto',
        height: `${height}px`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: colors.bgPanel,
        borderTop: `1px solid ${colors.borderDefault}`
      }}
    >
      <div
        role="separator"
        aria-label="Resize console drawer"
        aria-orientation="horizontal"
        onMouseDown={handleResizeStart}
        style={{ flex: '0 0 auto', cursor: 'row-resize', height: '4px', background: colors.borderInput }}
      />
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <BotConsole />
      </div>
    </section>
  );
}
