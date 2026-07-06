# Sean's Week — Redesign Brief
### From prototype to a real product: a non-linear, Hermes-centered calendar

---

## 1. The idea, restated in full

**Sean's Week** is a personal life-operating-system disguised as a weekly calendar. Its guiding motto — *Ordo vitae*, "a well-ordered life" — is not decoration; it is the product thesis. The app treats a week not as a spreadsheet of time slots but as a small classical world: work, gym, reading, family dinners, evening walks and watering, and UPenn obligations each have their own color, their own rhythm, and their own place in the composition.

At the center of that world lives **Hermes** — messenger of the gods, patron of travelers, boundaries, and swiftness — reimagined as the app's resident intelligence. Hermes is not a chatbot bolted onto a calendar. He is the interface. You tell him things in plain English ("move Friday's gym to 8am", "cancel dinner with Mom", "add a reading block Sunday afternoon") and he carries the message: parsing intent, confirming before acting, writing to your real Google Calendar, watching your Penn inbox for new obligations, tracking your habit streaks, and offering a daily word of stoic encouragement — *festina lente* — in one of three classical art styles (black-figure vase, fresco, amphora).

The current build proves the concept. The redesign's job is to make it feel like a **real, designed website**: coherent, tactile, fast, and navigable from anywhere — not a vertical stack of prototype panels.

---

## 2. What "non-linear UI" means here

The prototype is linear: topbar → legend → status → quick-add → grid → three cards, in one fixed scroll order. Every feature has exactly one home and one path to it. The redesign inverts that: **the week is the stage, and everything else is summoned, not stacked.**

### 2.1 The Agora (the hub)
The default screen is a single full-viewport composition — call it the **Agora**:

- **The week grid fills the stage.** No legend bar, no status line, no card row pushing it down. Time is the hero.
- **Hermes stands at a fixed anchor** (bottom-right), alive: his pose reflects the day's state (triumphant when streaks are intact, contemplative in an empty morning, hurrying when you're behind).
- **Everything else is a summonable surface**: inbox, to-dos, search, habits, settings, and the activity ledger live in panels that slide over or dock beside the stage when called — from Hermes, from a keyboard shortcut, from a click on the thing itself — and vanish when dismissed. No panel has a "position on the page"; each has a *trigger* and a *purpose*.

### 2.2 Many doors to every room
Non-linear means every task is reachable from wherever you already are:

- **Cmd+K / "Speak to Hermes" palette** — one input that does everything: natural-language event commands, search ("find dentist"), navigation ("go to next month", "show my streaks"), and to-do capture ("todo: email advisor"). This is the app's spine.
- **Direct manipulation on the grid** — drag on empty space to create an event; drag an event to move it; drag its edge to resize; click to open its card; type over it to rename. The grid is an editor, not a rendering.
- **Click-through everywhere** — a Penn email in the inbox panel offers "make this an event" (Hermes drafts it); a to-do can be dragged onto the grid to become a time block; a habit chip on a day column opens that habit's history.
- **Zoomable time** — pinch/scroll between Day ↔ Week ↔ Month. Day view is a generous single column with the inbox and to-dos docked beside it; Month is a mosaic of miniature days colored by category density; the transition animates so you never lose your place. "Today" is always one keystroke (T) away.

### 2.3 Nothing blocks, everything layers
Confirmations, event details, and Hermes's replies appear as **anchored popovers and toasts**, never full-page states. The "Checking inbox… / Loading events…" statuses become skeleton shimmer inside the panels they belong to. You should never see a loading message for a feature you aren't looking at.

---

## 3. Visual language: "an actual website"

Keep the classical soul; raise the craft.

- **Typography.** A real display serif for headings (Fraunces, Cormorant, or GT Sectra vibe) paired with a clean humanist sans for UI text and a tabular numeral font for times. The Latin epigraphs stay — set small, letterspaced, like museum wall labels.
- **Palette.** Keep the existing earthenware palette (terracotta `#E27A50`, olive `#90A468`, gold `#E3B94E`, clay `#C97B54`, aegean `#5FA0AC`, wine-purple `#9B7FB8`) but formalize it into design tokens with tints for backgrounds, borders, and hover states — so category color appears as a wash and an edge, not a solid block.
- **Texture and depth.** Paper-warm background with the faintest fresco grain; cards with soft, single-source shadows; a hairline gold rule (the caduceus line) as the recurring divider motif. One border radius, one shadow scale, one spacing scale — everywhere.
- **Motion.** 150–250ms ease-out for everything. Panels slide, don't pop. Events settle into place when created. Hermes's pose changes cross-fade. Today's column has a subtle living indicator — the current-time line drifts down the day like a sundial shadow.
- **The three styles become full themes.** Vase / Fresco / Amphora currently swap Hermes's artwork; in the redesign each is a complete theme — background tone, accent metals, header treatment — chosen from a small theme picker in Hermes's card. Add a proper dark mode ("Nyx") where the vase style genuinely shines: gold and terracotta on black-figure ground.
- **Responsive for real.** Phone: Day view is primary, week becomes a horizontal swipe, panels become bottom sheets, Hermes shrinks to a corner medallion. The Cmd+K palette becomes a persistent "Tell Hermes" bar above the keyboard.

---

## 4. The Hermes implementation, deepened

Hermes graduates from mascot-with-a-parser to the app's **agent layer**, with four distinct roles:

### 4.1 Hermes the Scribe (command execution)
- The existing natural-language create / move / cancel flow, made conversational: ambiguous commands get a follow-up question in a chat-like thread inside the palette ("You have two gym events Friday — the 7am or the 6pm?") instead of failing.
- **Preview-then-commit:** every parsed command renders a ghost event on the grid *before* confirmation, so you see exactly what will happen. Confirm writes to Google Calendar; every action gets a one-click **Undo** toast.
- Multi-step commands: "clear my Thursday afternoon and move everything to Friday" becomes a reviewable batch.

### 4.2 Hermes the Messenger (inbox and signals)
- He watches the Penn inbox (existing Gmail integration) and turns emails into **scrolls**: a badge on his medallion, and a panel where each scroll can be dismissed, converted to a to-do, or scheduled onto the grid with one action.
- Meeting/report emails auto-link to their calendar events, so an event card shows its related mail.

### 4.3 Hermes the Keeper (habits and memory)
- Streaks become first-class: a small **laurel meter** per tracked habit (gym, reading, walk/watering) rendered as leaves that accumulate across the week. Breaking a streak wilts a leaf rather than shaming you.
- The activity log becomes **Hermes's Ledger** — a readable narrative timeline ("Tuesday: moved gym to 8am at your request; noticed two new Penn emails") rather than raw ok/err lines. Errors are stated in plain language with a retry action.

### 4.4 Hermes the Oracle (proactive, gentle)
- **Morning brief** (first open of the day): today's shape in one sentence, conflicts flagged, one epigram.
- **Evening review** (after ~8pm): what got done, streak status, tomorrow's first event.
- Conflict and gap awareness: overlapping events get a quiet flag; a free afternoon prompts (softly, dismissibly) a suggestion drawn from your habits.
- Personality guardrails: Hermes speaks in at most two sentences, never nags twice about the same thing, and every proactive surface has a visible "quiet Hermes for today" control. *Festina lente* applies to him too.

---

## 5. Information architecture (summonable surfaces)

| Surface | Trigger | Contents |
|---|---|---|
| **The Stage** | always visible | Day / Week / Month grid, zoomable, directly editable |
| **Hermes Palette** | Cmd+K, click Hermes, `/` key | universal input: commands, search, navigation, capture |
| **Hermes Card** | click medallion | pose, epigram, streak laurels, theme picker, brief/review |
| **Scrolls (Inbox)** | badge on medallion, `I` key | Penn emails → dismiss / to-do / schedule |
| **Tasks** | `D` key, or dock in Day view | UPenn to-dos, draggable onto the grid |
| **Ledger** | link in Hermes Card | narrative activity history, undo points |
| **Event Card** | click any event | details, category, linked mail, edit/move/delete |
| **Settings** | gear | Google account, categories & colors, quiet hours, day bounds |

---

## 6. Technical shape (recommended)

- **Migrate off the single 1,400-line HTML file** to a small Vite + React (or Svelte) app with TypeScript — components per surface above, deployed to the same GitHub Pages URL via Actions.
- **Design tokens** in CSS custom properties (colors, spacing, radii, shadows, motion), consumed by all three themes + dark mode.
- **State:** server truth = Google Calendar/Gmail (existing OAuth flow); local truth = to-dos, habits, ledger, theme (localStorage → optionally Supabase later for cross-device sync).
- **Hermes's brain:** keep the current parse-confirm-execute pipeline but structure it as *intents* (create / move / cancel / query / navigate / capture) with a preview object the UI can render as a ghost event. This also makes Undo and batching straightforward.
- **PWA:** installable, offline-readable week, so it behaves like an app on your phone.

---

## 7. One-paragraph pitch (for the README / landing)

> **Sean's Week** is a weekly calendar built around a single idea: *ordo vitae*, the well-ordered life. Instead of menus and forms, you talk to **Hermes** — a classical messenger rendered in vase, fresco, or amphora style — who schedules, moves, and cancels events on your real Google Calendar, carries word of new UPenn emails, keeps your gym and reading streaks like laurels, and greets each morning with a brief and an epigram. The week itself is the interface: drag to create, zoom from day to month, summon anything from anywhere with a keystroke. Make haste, slowly.
