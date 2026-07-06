import type { CalendarEvent, EventInput, EventPatch, EventStore } from '../state/types';
import type { LocalEventStore } from '../state/localStore';
import { isSignedIn, subscribeGoogleAuth } from './auth';
import { GoogleCalendarStore, isGoogleId } from './googleStore';

// One store over two truths: local events always, Google events when signed
// in. Reads merge both; writes route by id prefix ('g:' means Google), and
// brand-new events go to Google Calendar while signed in — the server is
// truth — or to this device otherwise. Signed out, this is exactly the
// local store.

export class CompositeEventStore implements EventStore {
  readonly source = 'local' as const;

  constructor(
    private readonly local: LocalEventStore,
    private readonly google: GoogleCalendarStore
  ) {}

  async list(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
    const [localEvents, googleEvents] = await Promise.all([
      this.local.list(rangeStart, rangeEnd),
      this.google.list(rangeStart, rangeEnd), // [] when signed out or unreachable
    ]);
    if (googleEvents.length === 0) return localEvents;
    return [...localEvents, ...googleEvents].sort((a, b) => a.start.localeCompare(b.start));
  }

  create(input: EventInput): Promise<CalendarEvent> {
    if (input.id) {
      // Undo/restore of an existing event: it belongs where it came from.
      return isGoogleId(input.id) ? this.google.create(input) : this.local.create(input);
    }
    return isSignedIn() ? this.google.create(input) : this.local.create(input);
  }

  update(id: string, patch: EventPatch): Promise<CalendarEvent> {
    return isGoogleId(id) ? this.google.update(id, patch) : this.local.update(id, patch);
  }

  remove(id: string): Promise<void> {
    return isGoogleId(id) ? this.google.remove(id) : this.local.remove(id);
  }

  subscribe(listener: () => void): () => void {
    const unsubLocal = this.local.subscribe(listener);
    const unsubGoogle = this.google.subscribe(listener);
    const unsubAuth = subscribeGoogleAuth(listener); // sign-in/out changes what list() returns
    return () => {
      unsubLocal();
      unsubGoogle();
      unsubAuth();
    };
  }
}
