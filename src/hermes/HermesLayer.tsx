import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, isSameDay, startOfDay } from '../lib/time';
import { useEvents } from '../state/EventsContext';
import type { CalendarEvent } from '../state/types';
import type { ViewMode } from '../stage/Stage';
import { BriefCard } from './BriefCard';
import {
  dueBrief,
  eveningBriefText,
  morningBriefText,
  stampBrief,
  type BriefKind,
} from './briefs';
import { Card } from './Card';
import { appendLedger } from './ledgerStore';
import { Palette } from './Palette';
import { Ledger } from './Ledger';
import { isQuietToday } from './quiet';
import { useHermesShortcuts } from './useHermesShortcuts';
import { useStreaks, type StreakInfo } from './streaks';

interface HermesLayerProps {
  /** Moves the Stage: a day to anchor on and/or a view to switch to. */
  onNavigate: (day: Date | null, view: ViewMode | null) => void;
}

interface ActiveBrief {
  kind: BriefKind;
  text: string;
}

/**
 * Everything Hermes: the palette (Cmd+K, `/`), his card ('hermes:summon'
 * from the medallion), the Ledger panel (L) and the daily briefs.
 */
export function HermesLayer({ onNavigate }: HermesLayerProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [brief, setBrief] = useState<ActiveBrief | null>(null);

  const [todayStart] = useState(() => startOfDay(new Date()));
  const [briefRangeEnd] = useState(() => addDays(startOfDay(new Date()), 2));
  const briefEvents = useEvents(todayStart, briefRangeEnd);
  const streaks = useStreaks();

  // Latest data for the delayed brief computation below.
  const briefDataRef = useRef<{ events: CalendarEvent[]; streaks: StreakInfo[] }>({
    events: [],
    streaks: [],
  });
  briefDataRef.current = { events: briefEvents, streaks };

  const openPalette = useCallback(() => {
    setCardOpen(false);
    setPaletteOpen((open) => !open);
  }, []);

  const openLedger = useCallback(() => {
    setCardOpen(false);
    setLedgerOpen((open) => !open);
  }, []);

  // The medallion click summons the Card.
  useEffect(() => {
    function onSummon() {
      setPaletteOpen(false);
      setCardOpen((open) => !open);
    }
    window.addEventListener('hermes:summon', onSummon);
    return () => window.removeEventListener('hermes:summon', onSummon);
  }, []);

  useHermesShortcuts({ onPalette: openPalette, onLedger: openLedger });

  // Morning brief before noon, evening review after 8pm — once per day,
  // never when quieted. Delayed a moment so the store has loaded.
  useEffect(() => {
    const timer = setTimeout(() => {
      const now = new Date();
      const kind = dueBrief(now);
      if (!kind || isQuietToday(now)) return;
      const { events, streaks: currentStreaks } = briefDataRef.current;
      const todays = events.filter((ev) => isSameDay(new Date(ev.start), now));
      const text =
        kind === 'morning'
          ? morningBriefText(todays, now)
          : eveningBriefText(
              todays,
              events.filter((ev) => isSameDay(new Date(ev.start), addDays(now, 1))),
              currentStreaks,
              now
            );
      stampBrief(kind, now);
      appendLedger('brief', `${kind === 'morning' ? 'Morning brief' : 'Evening review'}: ${text}`);
      setBrief({ kind, text });
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={onNavigate} />
      <Card
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        onOpenPalette={() => {
          setCardOpen(false);
          setPaletteOpen(true);
        }}
        onOpenLedger={() => {
          setCardOpen(false);
          setLedgerOpen(true);
        }}
      />
      <Ledger open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
      {brief && (
        <BriefCard kind={brief.kind} text={brief.text} onDismiss={() => setBrief(null)} />
      )}
    </>
  );
}
