# Sean's Week

> **Sean's Week** is a weekly calendar built around a single idea: *ordo vitae*, the well-ordered life. Instead of menus and forms, you talk to **Hermes** — a classical messenger rendered in vase, fresco, or amphora style — who schedules, moves, and cancels events on your real Google Calendar, carries word of new UPenn emails, keeps your gym and reading streaks like laurels, and greets each morning with a brief and an epigram. The week itself is the interface: drag to create, zoom from day to month, summon anything from anywhere with a keystroke. Make haste, slowly.

A Vite + React + TypeScript PWA, installable on a phone, deployed to GitHub Pages. Signed out of Google, it is fully functional with on-device events; signing in merges your real calendar onto the grid and lets Hermes fetch scrolls from Gmail. The previous single-file prototype lives untouched in [`legacy/`](legacy/).

## Development

```sh
npm install
npm run dev        # dev server (Vite)
npm run build      # production build → dist/ (also emits the service worker)
npm run typecheck  # tsc --noEmit
```

## Themes

Four full themes, switched from the Hermes card or Settings (gear icon): **Vase** (dark parchment), **Fresco** (light warm parchment), **Amphora** (fired clay), and **Nyx** (true dark — gold on black-figure ground).

## Keyboard reference

| Key | Does |
|---|---|
| `⌘K` / `/` | Speak to Hermes (palette: add, move, cancel, find, go to, todo:) |
| `T` | Today |
| `←` / `→` | Previous / next period |
| `1` / `2` / `3` | Day / Week / Month view |
| `I` | Scrolls (inbox) |
| `D` | Tasks (UPenn to-dos — draggable onto the grid) |
| `L` | Hermes's Ledger |
| `Esc` | Dismiss whatever is open |

Shortcuts never fire while you are typing in a field.

## Deployment

Pushes to `main` build and deploy automatically via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (official `actions/deploy-pages` flow).

> [!IMPORTANT]
> **One-time setup after merging:** in the repo's **Settings → Pages**, change **Source** from "Deploy from a branch" to **"GitHub Actions"**. The site previously deployed from the branch root; the redesign deploys the built `dist/` via Actions instead.
