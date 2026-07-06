import { addDays, isSameDay, startOfMonth, startOfWeek } from '../lib/time';
import type { ViewMode } from '../stage/Stage';

interface TopBarProps {
  view: ViewMode;
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: ViewMode) => void;
}

const VIEWS: Array<{ id: ViewMode; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function rangeLabel(view: ViewMode, anchor: Date): string {
  if (view === 'day') {
    return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  if (view === 'month') {
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const monday = startOfWeek(anchor);
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString(undefined, opts)} – ${sunday.toLocaleDateString(undefined, opts)}`;
}

function periodIncludesToday(view: ViewMode, anchor: Date): boolean {
  const today = new Date();
  if (view === 'day') return isSameDay(anchor, today);
  if (view === 'month') return startOfMonth(anchor).getTime() === startOfMonth(today).getTime();
  return startOfWeek(anchor).getTime() === startOfWeek(today).getTime();
}

function Medallion() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="13" fill="none" stroke="var(--gold)" strokeWidth="1.4" />
      <line x1="15" y1="8" x2="15" y2="22" stroke="var(--gold)" strokeWidth="1.4" />
      <path
        d="M15 20 C11 18 19 15 15 13 C11 11 19 8 15 7"
        fill="none"
        stroke="var(--cat-gym)"
        strokeWidth="1"
      />
    </svg>
  );
}

export function TopBar({ view, anchor, onPrev, onNext, onToday, onViewChange }: TopBarProps) {
  const onTodayPeriod = periodIncludesToday(view, anchor);
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Medallion />
        <div>
          <h1>Sean&rsquo;s Week</h1>
          <div className="epigraph">Ordo vitae — a well-ordered life</div>
        </div>
      </div>
      <nav className="topbar-nav" aria-label="Calendar navigation">
        <button className="nav-btn" onClick={onPrev} aria-label="Previous period">
          ←
        </button>
        <button
          className={`nav-btn today${onTodayPeriod ? '' : ' elsewhere'}`}
          onClick={onToday}
        >
          Today
        </button>
        <button className="nav-btn" onClick={onNext} aria-label="Next period">
          →
        </button>
        <div className="range-label">{rangeLabel(view, anchor)}</div>
        <div className="view-switch" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? 'active' : ''}
              onClick={() => onViewChange(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </nav>
    </header>
  );
}
