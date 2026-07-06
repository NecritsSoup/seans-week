import { minutesOfDay } from '../lib/time';
import type { CalendarEvent } from '../state/types';

export interface PositionedEvent {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  /** Column within an overlap cluster. */
  lane: number;
  /** Total columns in the cluster. */
  lanes: number;
}

/**
 * Assign overlapping events to side-by-side lanes within a single day.
 */
export function layoutDayEvents(events: CalendarEvent[]): PositionedEvent[] {
  const items = events
    .map((event) => ({
      event,
      startMin: minutesOfDay(new Date(event.start)),
      endMin: Math.max(
        minutesOfDay(new Date(event.end)),
        minutesOfDay(new Date(event.start)) + 15
      ),
      lane: 0,
      lanes: 1,
    }))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster: PositionedEvent[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];

  const closeCluster = () => {
    for (const item of cluster) item.lanes = laneEnds.length;
    cluster = [];
    laneEnds.length = 0;
  };

  for (const item of items) {
    if (item.startMin >= clusterEnd && cluster.length > 0) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  closeCluster();

  return items;
}
