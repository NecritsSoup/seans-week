import type { StreakInfo } from './streaks';

const MAX_LEAVES = 7;

interface LeafProps {
  x: number;
  flip: boolean;
  state: 'filled' | 'empty' | 'wilted';
  color: string;
}

/** One laurel leaf on the stem: filled, outlined, or gently wilted. */
function Leaf({ x, flip, state, color }: LeafProps) {
  const droop = state === 'wilted' ? ' rotate(38 0 0)' : '';
  return (
    <g transform={`translate(${x} 11) scale(1 ${flip ? -1 : 1})${droop}`}>
      <path
        d="M0 0 Q 3.5 -7.5 0 -12 Q -3.5 -7.5 0 0"
        fill={state === 'filled' ? color : 'none'}
        stroke={state === 'wilted' ? 'var(--text-soft)' : color}
        strokeWidth="1"
        opacity={state === 'empty' ? 0.4 : state === 'wilted' ? 0.55 : 0.95}
      />
    </g>
  );
}

interface LaurelMeterProps {
  streak: StreakInfo;
}

/**
 * A habit streak as a small laurel: one leaf per kept day (up to seven),
 * a wilted leaf when a recent streak lapsed — never a word of shame.
 */
export function LaurelMeter({ streak }: LaurelMeterProps) {
  const color = `var(--cat-${streak.habit})`;
  const filled = Math.min(streak.count, MAX_LEAVES);
  const caption =
    streak.count > 0
      ? `${streak.count} day${streak.count === 1 ? '' : 's'}`
      : streak.wilted
        ? 'resting'
        : '—';

  return (
    <div className="laurel-row" aria-label={`${streak.label} streak: ${caption}`}>
      <span className="laurel-label">{streak.label}</span>
      <svg width="118" height="22" viewBox="0 0 118 22" aria-hidden="true">
        <line x1="2" y1="11" x2="116" y2="11" stroke={color} strokeWidth="0.8" opacity="0.35" />
        {Array.from({ length: MAX_LEAVES }, (_, i) => {
          const state: LeafProps['state'] =
            i < filled ? 'filled' : i === 0 && streak.wilted ? 'wilted' : 'empty';
          return <Leaf key={i} x={10 + i * 16} flip={i % 2 === 1} state={state} color={color} />;
        })}
      </svg>
      <span className="laurel-count tnum">{caption}</span>
    </div>
  );
}
