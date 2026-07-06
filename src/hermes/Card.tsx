import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, startOfDay } from '../lib/time';
import { useEvents } from '../state/EventsContext';
import { THEMES, setTheme, useTheme, type ThemeName } from '../theme/theme';
import { HERMES_ART, type HermesStyle } from './art';
import { LaurelMeter } from './Laurels';
import { pickHermesPose } from './pose';
import { useQuietToday, setQuietToday } from './quiet';
import { epigramOfDay } from './quotes';
import { useStreaks } from './streaks';

const STYLE_FOR_THEME: Record<ThemeName, HermesStyle> = {
  vase: 'vase',
  fresco: 'fresco',
  amphora: 'amphora',
  nyx: 'vase',
};

const THEME_LABELS: Record<ThemeName, string> = {
  vase: 'Vase',
  fresco: 'Fresco',
  amphora: 'Amphora',
  nyx: 'Nyx',
};

interface CardProps {
  open: boolean;
  onClose: () => void;
  onOpenPalette: () => void;
  onOpenLedger: () => void;
}

/**
 * The Hermes Card: an anchored popover above the medallion — pose, epigram,
 * streak laurels, theme picker, ledger link and the quiet-for-today toggle.
 */
export function Card({ open, onClose, onOpenPalette, onOpenLedger }: CardProps) {
  const theme = useTheme();
  const quiet = useQuietToday();
  const streaks = useStreaks();
  const cardRef = useRef<HTMLDivElement>(null);

  const [todayStart] = useState(() => startOfDay(new Date()));
  const [tomorrowStart] = useState(() => addDays(startOfDay(new Date()), 1));
  const todaysEvents = useEvents(todayStart, tomorrowStart);

  const pose = useMemo(() => pickHermesPose(todaysEvents, streaks), [todaysEvents, streaks]);
  const art = HERMES_ART[STYLE_FOR_THEME[theme]];
  const epigram = epigramOfDay();

  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="panel-backdrop"
        style={{ background: 'transparent' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={cardRef}
        className="hermes-card"
        role="dialog"
        aria-label="Hermes"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="meander" />
        <div className="hermes-card-top">
          <img className="hermes-pose" src={art.poses[pose]} alt={`Hermes, ${pose}`} />
          <div className="hermes-card-words">
            <div className="epigraph hermes-epigram">“{epigram.latin}”</div>
            <div className="hermes-epigram-en">{epigram.english}</div>
            <button className="btn primary hermes-speak" onClick={onOpenPalette}>
              Speak to Hermes <kbd>⌘K</kbd>
            </button>
          </div>
        </div>

        <hr className="gold-rule" />

        <div className="hermes-laurels">
          {streaks.map((s) => (
            <LaurelMeter key={s.habit} streak={s} />
          ))}
        </div>

        <hr className="gold-rule" />

        <div className="hermes-card-row">
          <span className="hermes-card-label">Theme</span>
          <div className="theme-swatches" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t}
                className={`theme-swatch theme-swatch-${t}${theme === t ? ' active' : ''}`}
                title={THEME_LABELS[t]}
                aria-label={`${THEME_LABELS[t]} theme`}
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                <span className="theme-swatch-name">{THEME_LABELS[t]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hermes-card-row">
          <button className="hermes-link" onClick={onOpenLedger}>
            Open the Ledger <kbd>L</kbd>
          </button>
          <label className="hermes-quiet">
            <input
              type="checkbox"
              checked={quiet}
              onChange={(e) => setQuietToday(e.target.checked)}
            />
            Quiet Hermes for today
          </label>
        </div>
      </div>
    </>,
    document.body
  );
}
