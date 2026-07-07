import { useEffect, useState } from 'react';
import { DAY_END_MIN, DAY_START_MIN, minutesOfDay } from '../lib/time';

/**
 * The sundial shadow: a current-time line rendered only in today's column,
 * updated every minute.
 */
export function NowLine({ pxPerMin }: { pxPerMin: number }) {
  const [minute, setMinute] = useState(() => minutesOfDay(new Date()));

  useEffect(() => {
    const timer = setInterval(() => setMinute(minutesOfDay(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (minute < DAY_START_MIN || minute > DAY_END_MIN) return null;
  return <div className="now-line" style={{ top: (minute - DAY_START_MIN) * pxPerMin }} />;
}
