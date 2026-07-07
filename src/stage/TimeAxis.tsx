import { DAY_END_MIN, DAY_START_MIN, fmtHourLabel } from '../lib/time';

export function TimeAxis({ pxPerMin }: { pxPerMin: number }) {
  const labels: number[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) labels.push(m);
  return (
    <div className="time-axis" aria-hidden="true">
      {labels.map((m) => (
        <span key={m} className="hour-label" style={{ top: (m - DAY_START_MIN) * pxPerMin }}>
          {fmtHourLabel(m)}
        </span>
      ))}
    </div>
  );
}

export function HourLines({ pxPerMin }: { pxPerMin: number }) {
  const lines: number[] = [];
  for (let m = DAY_START_MIN + 60; m <= DAY_END_MIN; m += 60) lines.push(m);
  return (
    <>
      {lines.map((m) => (
        <div key={m} className="hour-line" style={{ top: (m - DAY_START_MIN) * pxPerMin }} />
      ))}
    </>
  );
}
