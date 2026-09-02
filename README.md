# 🗂️ JobVault

**A private, offline-first vault for your resumes, cover letters and job-application notes.**
Everything is organised by **job role**, stored in your browser's `localStorage`, and served as three
static files — so it deploys to GitHub Pages with zero build step and zero backend.

---

## ✨ Features

| | |
|---|---|
| 🔐 **Login gate** | Splash → animated login. Wrong credentials shake the card. "Remember me" persists the session. |
| 📊 **Bento dashboard** | Apple-style bento grid: greeting tile, animated stat counters, sparklines, conversion rates and a live pipeline funnel. |
| 📄 **Entries** | Job role (title), company, type (Resume / Cover Letter / Both), full document text, JD & notes, status, tags. |
| ✏️ **Full CRUD** | Add / edit in a pre-filled modal. Delete via a styled confirmation modal — never `window.confirm`. |
| 🔍 **Search & filter** | Live multi-term AND search across every field, plus type / status / tag filters. |
| ↕️ **Sort** | Newest, oldest, A→Z, Z→A, by pipeline status, or manual drag-and-drop order. |
| 👁️ **Viewer** | Read-only modal with monospace formatting, word count and print support. |
| 📋 **Copy & export** | One-click copy with a `Copied! ✅` toast; download any entry as `.txt` or `.md`; full vault backup as JSON. |
| ⭐ **Favourites** | Pinned entries float to the top and render as a wide bento tile. |
| 📦 **Archive** | Park old entries in a searchable Archive tab. |
| 🗑️ **Trash + restore** | Soft delete with a 30-day window, per-card countdown, one-tap Undo toast, and auto-purge on boot. |
| 📝 **Notes** | A separate quick-comment board — colour-coded, pinnable, searchable sticky notes with live word counts. |
| ✅ **Bulk actions** | Multi-select cards → archive or delete in one go. |
| 🎉 **Confetti** | Fires when an entry's status becomes **Offer**. |
| 🌙☀️ **Themes** | Dark by default, light mode toggle, persisted. |
| ⌨️ **Shortcuts** | `/` search · `N` new entry · `T` theme · `?` help · `Esc` close · `⌘/Ctrl+Enter` save. |
| 📱 **Responsive** | Mobile-first; the bento collapses to a single column and action pills become inline rows. |

---

## 🎨 Design system

- **Accent** `#FF9030` · **Dark base** `#111827` · white type throughout
- **Bento grid** — a 12-column CSS grid where tiles claim 3/4/6/8/12 columns; favourites promote to double-width
- Glassmorphism tiles (`backdrop-filter` + specular sheen), 12–26px radii, generous whitespace
- Micro-animations: staggered tile entry, hover lift + accent glow, modal scale/fade, button ripples, slide-in toasts, ambient aurora background
- Honours `prefers-reduced-motion` and ships a print stylesheet for clean resume output

---

## 🚀 Deploy to GitHub Pages

### Option A — from the repository root (fastest)

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
# index.html, style.css and script.js live at the repo root
git add index.html style.css script.js README.md
git commit -m "Add JobVault"
git push origin main
```

Then in GitHub: **Settings → Pages → Build and deployment**
- **Source:** `Deploy from a branch`
- **Branch:** `main` · **Folder:** `/ (root)`
- **Save**

Your app goes live at `https://<you>.github.io/<repo>/` in about a minute.

### Option B — `docs/` folder

Move the three files into `docs/`, then pick **Branch: `main` · Folder: `/docs`**.

### Notes
- No build tools, no `npm install`, no framework CDN — the page has **zero external requests**.
- The favicon is an inline SVG data URI, so there is no image asset to upload.
- Nothing here starts with `_`, so Jekyll processing is harmless. Add an empty `.nojekyll` file if you prefer to skip it entirely.

---

## 💻 Run locally

Opening `index.html` directly works, but a local server is closer to production
(and the Clipboard API prefers a secure context):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

---

## 🔑 Credentials

```
username: paul
password: 2557
```

Seeded into `localStorage` on first run. To change them, open DevTools → Console:

```js
// cyrb53 hash used by the app — paste the helper, then set your own password
localStorage.setItem('jobvault.v1.credentials', JSON.stringify({ u: 'paul', p: '<hash>' }));
```

…or simply edit `DEFAULT_USER` / `DEFAULT_PASS` at the top of `script.js` and clear
`jobvault.v1.credentials` from localStorage so the new defaults are re-seeded.

### ⚠️ Security reality check

This is a **client-side gate, not real authentication.** GitHub Pages serves static files:
the credential check runs in the visitor's browser and anyone can read `script.js` or open
DevTools. The password is stored as a `cyrb53` hash — that is *obfuscation*, not cryptography.

Treat JobVault as a private convenience vault on your own device. **Do not store anything you
would not be comfortable pasting into a public repository.** If you need genuine privacy,
put it behind a real backend or a private host.

---

## 🗄️ Data & storage

All state lives in `localStorage` under the `jobvault.v1.` namespace:

| Key | Contents |
|---|---|
| `jobvault.v1.entries` | Resume / cover-letter entries (including archived + trashed) |
| `jobvault.v1.notes` | Quick notes |
| `jobvault.v1.prefs` | Theme, sort order, note colour |
| `jobvault.v1.credentials` | Username + hashed password |
| `jobvault.v1.session` | Active session ("remember me") |

- Data is **per browser, per device** — it does not sync. Use the 📦 backup button in the header
  to export a JSON snapshot before clearing site data or switching machines.
- Two open tabs stay in sync via the `storage` event.
- Trash auto-purges entries older than 30 days on every load.

---

## 📁 Files

```
index.html   markup: splash, login, bento dashboard, notes, archive, trash, modal root
style.css    design tokens, themes, bento grid, components, animations, responsive + print
script.js    state, auth, modals, CRUD, filters, notes, stats, confetti, shortcuts
README.md    this file
```

---

## ♿ Accessibility

Semantic landmarks, `role="tablist"`/`tabpanel` navigation, `aria-modal` dialogs with focus
trapping and focus restore, `aria-live` toasts and login errors, keyboard-operable cards,
visible `:focus-visible` rings, and full `prefers-reduced-motion` support.

---

## 🌐 Browser support

Any modern evergreen browser (Chrome/Edge 111+, Firefox 113+, Safari 16.4+).
Uses `color-mix()`, `:has()`, `structuredClone`, `backdrop-filter` and `Intl.RelativeTimeFormat`.

---

## 📄 Licence

MIT — do whatever you like with it.
