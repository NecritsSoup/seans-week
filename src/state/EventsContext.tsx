import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LocalEventStore } from './localStore';
import { seedIfNeeded } from './seed';
import type { CalendarEvent, EventInput, EventPatch, EventStore } from './types';

interface EventsContextValue {
  store: EventStore;
  /** Bumped after every mutation; range hooks re-query on change. */
  version: number;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new LocalEventStore(), []);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void seedIfNeeded(store).then(() => {
      if (!cancelled) setVersion((v) => v + 1);
    });
    const unsubscribe = store.subscribe(() => setVersion((v) => v + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store]);

  const value = useMemo(() => ({ store, version }), [store, version]);
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

function useEventsContext(): EventsContextValue {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error('useEvents must be used inside <EventsProvider>');
  return ctx;
}

/** Events overlapping [rangeStart, rangeEnd), kept fresh across mutations. */
export function useEvents(rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  const { store, version } = useEventsContext();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const fromMs = rangeStart.getTime();
  const toMs = rangeEnd.getTime();

  useEffect(() => {
    let cancelled = false;
    void store
      .list(new Date(fromMs).toISOString(), new Date(toMs).toISOString())
      .then((list) => {
        if (!cancelled) setEvents(list);
      });
    return () => {
      cancelled = true;
    };
  }, [store, version, fromMs, toMs]);

  return events;
}

export interface EventActions {
  createEvent: (input: EventInput) => Promise<CalendarEvent>;
  updateEvent: (id: string, patch: EventPatch) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
}

export function useEventActions(): EventActions {
  const { store } = useEventsContext();
  const createEvent = useCallback((input: EventInput) => store.create(input), [store]);
  const updateEvent = useCallback(
    (id: string, patch: EventPatch) => store.update(id, patch),
    [store]
  );
  const deleteEvent = useCallback((id: string) => store.remove(id), [store]);
  return useMemo(
    () => ({ createEvent, updateEvent, deleteEvent }),
    [createEvent, updateEvent, deleteEvent]
  );
}
