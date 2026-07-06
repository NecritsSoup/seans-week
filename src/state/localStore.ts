import type { CalendarEvent, EventInput, EventPatch, EventStore } from './types';

const STORAGE_KEY = 'seans-week:events:v1';

function load(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CalendarEvent[]) : [];
  } catch {
    return [];
  }
}

function newId(): string {
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** localStorage-backed store for source 'local'. */
export class LocalEventStore implements EventStore {
  readonly source = 'local' as const;

  private events: CalendarEvent[] = load();
  private listeners = new Set<() => void>();

  async list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    const from = new Date(rangeStart).getTime();
    const to = new Date(rangeEnd).getTime();
    return this.events
      .filter((ev) => new Date(ev.start).getTime() < to && new Date(ev.end).getTime() > from)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async create(input: EventInput): Promise<CalendarEvent> {
    const event: CalendarEvent = {
      id: input.id ?? newId(),
      title: input.title,
      start: input.start,
      end: input.end,
      categoryId: input.categoryId,
      allDay: input.allDay,
      source: this.source,
    };
    this.events = [...this.events, event];
    this.persist();
    return event;
  }

  async update(id: string, patch: EventPatch): Promise<CalendarEvent> {
    const index = this.events.findIndex((ev) => ev.id === id);
    if (index === -1) throw new Error(`Event not found: ${id}`);
    const updated = { ...this.events[index], ...patch };
    this.events = this.events.map((ev) => (ev.id === id ? updated : ev));
    this.persist();
    return updated;
  }

  async remove(id: string): Promise<void> {
    this.events = this.events.filter((ev) => ev.id !== id);
    this.persist();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True when nothing has ever been stored (used by the seed module). */
  isEmpty(): boolean {
    return this.events.length === 0;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
    } catch {
      /* storage full or unavailable — keep the in-memory copy */
    }
    this.listeners.forEach((fn) => fn());
  }
}
