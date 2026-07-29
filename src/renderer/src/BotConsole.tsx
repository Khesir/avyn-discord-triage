import { useEffect, useRef, useState } from 'react';
import type { BotLogLine } from '../../shared/ipcTypes';
import { colors, fonts } from './theme';

const STREAM_COLOR: Record<BotLogLine['stream'], string> = {
  stdout: colors.textBody,
  stderr: colors.declined
};

/**
 * Live log/console panel for the bot's utility process (PRD: "see the bot's
 * console/log output live in the app UI"). Subscribes to window.api.bot.onLog
 * on mount and appends each incoming line; unsubscribes on unmount. Styled
 * as a terminal (dark background, monospace) and auto-scrolls to the latest
 * line so the reviewer doesn't have to manually scroll during a live scan.
 */
export default function BotConsole() {
  const [lines, setLines] = useState<BotLogLine[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribe = window.api.bot.onLog((line) => {
      setLines((current) => [...current, line]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lines]);

  return (
    <section aria-label="Bot console" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1
        style={{
          flex: '0 0 auto',
          fontSize: '13px',
          margin: 0,
          padding: '4px 12px',
          background: colors.bgCard,
          borderBottom: `1px solid ${colors.borderDefault}`,
          color: colors.textSecondary,
          fontFamily: fonts.heading
        }}
      >
        Bot console
      </h1>
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          background: colors.bgInput,
          color: colors.textBody,
          fontFamily: fonts.mono,
          fontSize: '13px',
          lineHeight: 1.5,
          padding: '8px 12px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        <ul aria-label="Bot log lines" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lines.map((line, index) => (
            <li key={index} data-stream={line.stream} style={{ color: STREAM_COLOR[line.stream] }}>
              {line.text}
            </li>
          ))}
        </ul>
        <div ref={endRef} />
      </div>
    </section>
  );
}
