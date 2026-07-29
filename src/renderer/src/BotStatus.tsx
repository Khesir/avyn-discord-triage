import { useEffect, useState } from 'react';
import type { BotStatusEvent } from '../../shared/ipcTypes';

const STATUS_LABEL: Record<BotStatusEvent['status'], string> = {
  stopped: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection error'
};

/**
 * Live indicator of the bot's Discord connection state — reads the current
 * status on mount, then updates as onStatus events arrive. Lets the reviewer
 * tell whether the bot is actually up before relying on it (e.g. before
 * hitting Scan), rather than inferring it from log console text.
 */
export default function BotStatus() {
  const [event, setEvent] = useState<BotStatusEvent>({ status: 'stopped' });

  useEffect(() => {
    let cancelled = false;

    window.api.bot.getStatus().then((initial) => {
      if (!cancelled) setEvent(initial);
    });

    const unsubscribe = window.api.bot.onStatus((next) => setEvent(next));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <section aria-label="Bot status">
      <span data-status={event.status}>● {STATUS_LABEL[event.status]}</span>
      {event.status === 'error' && event.error && <p role="alert">{event.error}</p>}
    </section>
  );
}
