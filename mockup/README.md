# Prompt Vault — design mockup

Clickable mockup for the Personal Prompt Library Dashboard. Open
`prompt-vault.html` in any browser — no build, no install, no server.

This is a **design mockup**, not the app. Prompt data lives in memory and
resets on reload. Only the theme choice is persisted (localStorage).

## Decisions locked

| Question | Answer |
| --- | --- |
| Categories | **Data, not hardcoded.** Seeded with UI/UX, Digital Marketing, Graphic Design, Other. Addable at runtime (Job Search / Tracker Prompts are one click away in the sidebar). |
| Persistence | Full stack with a real DB — **not wired in this mockup.** |
| Theme | Both. Dark is the default; toggle persists per browser. |
| Deliverable | Mockup first, app after sign-off. |

## What is interactive

- Category filter, live title search, per-category counts
- Add / edit / delete prompts (delete is behind a confirm dialog)
- Add categories at runtime
- Copy to clipboard with 2-second "Copied!" feedback
- Contextual empty states (empty category vs. no search match)
- Light / dark toggle
- Command palette (Cmd/Ctrl+K), `/` to search, `N` for new, `Esc` to close
- Responsive down to mobile — sidebar becomes a drawer

## Beyond the brief

`[bracketed]` text is treated as a **variable**. Prompts are written with
placeholders like `[target audience]`, so the mockup detects them, highlights
them in the second accent colour, counts them on each card, and offers
**Fill variables…** — type the values once, copy the finished prompt. Blank
fields keep their brackets.

## Design tokens

- Ground `#0D1014` slate-black, surfaces `#14181E`, recessed well `#090C10`
- Accent 1 (brand/action): mint `#5CE0A0` — `#0E9F6E` in light
- Accent 2 (variables only): apricot `#F2A65A` — `#B25C0A` in light
- Category hues are a separate semantic set, not accents
- Type: Bricolage Grotesque (display), Instrument Sans (UI), JetBrains Mono (prompt bodies)

## Not built yet

Database and API, export/import, favourites, recently-used, sort options,
duplicate detection, prompt versioning.
