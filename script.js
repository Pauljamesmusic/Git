/* ============================================================================
   JobVault — script.js
   Pure vanilla JS. No frameworks, no build step, no network calls.
   Everything persists to localStorage, so the app works offline and on
   a static host like GitHub Pages.

   Module map
     1  Constants & storage
     2  State
     3  Utilities
     4  Toast
     5  Theme
     6  Auth (splash → login → app)
     7  Modal engine (+ focus trap)
     8  Entry model / CRUD
     9  Filtering, sorting, rendering
    10  Notes
    11  Archive & Trash
    12  Stats
    13  Bulk actions & drag-reorder
    14  Copy / download / backup
    15  Confetti
    16  Keyboard shortcuts
    17  Boot
   ========================================================================= */
(() => {
'use strict';

/* ============================================================
   1. CONSTANTS & STORAGE
   ============================================================ */
const NS   = 'jobvault.v1.';
const KEY  = {
  entries : NS + 'entries',
  notes   : NS + 'notes',
  creds   : NS + 'credentials',
  session : NS + 'session',
  prefs   : NS + 'prefs'
};

const DEFAULT_USER = 'paul';
const DEFAULT_PASS = '2557';
const TRASH_DAYS   = 30;
const DAY_MS       = 86_400_000;

const TYPES    = ['Resume', 'Cover Letter', 'Both'];
const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
const TYPE_EMOJI   = { 'Resume': '📄', 'Cover Letter': '✉️', 'Both': '🗂️' };
const STATUS_EMOJI = { Saved: '💾', Applied: '🚀', Interview: '🎤', Offer: '🎉', Rejected: '💔' };
const STATUS_VAR   = { Saved: '--st-saved', Applied: '--st-applied', Interview: '--st-interview',
                       Offer: '--st-offer', Rejected: '--st-rejected' };
const NOTE_COLORS  = ['#FF9030', '#5AA9FF', '#34D399', '#C084FC', '#FB7185', '#FBBF24'];

/** localStorage read with a safe fallback (private mode / quota / corrupt JSON). */
const load = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};

/** localStorage write; surfaces quota failures as a toast instead of dying silently. */
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { toast('Storage full — could not save', 'err', '⚠️'); return false; }
};

/* ============================================================
   2. STATE
   ============================================================ */
const state = {
  entries : load(KEY.entries, []),
  notes   : load(KEY.notes, []),
  prefs   : Object.assign({ theme: 'dark', sort: 'date-desc', noteColor: NOTE_COLORS[0] }, load(KEY.prefs, {})),
  view    : 'dashboard',
  q       : '',
  fType   : '',
  fStatus : '',
  fTag    : '',
  selected: new Set(),
  noteQ   : '',
  archQ   : ''
};

const persistEntries = () => save(KEY.entries, state.entries);
const persistNotes   = () => save(KEY.notes, state.notes);
const persistPrefs   = () => save(KEY.prefs, state.prefs);

/* ============================================================
   3. UTILITIES
   ============================================================ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Escape untrusted text before it touches innerHTML. */
const esc = (s = '') => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** cyrb53 — fast non-cryptographic hash. Obfuscation, NOT security. */
function hash(str, seed = 0x9E37) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const fmtDate = ts => new Date(ts).toLocaleDateString(undefined,
  { month: 'short', day: 'numeric', year: 'numeric' });

const fmtLong = ts => new Date(ts).toLocaleDateString(undefined,
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** "3 days ago" / "in 2 hours" — small relative formatter. */
function relative(ts) {
  const diff = Date.now() - ts, abs = Math.abs(diff);
  const units = [['year', 31536e6], ['month', 2592e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const n = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-n, unit);
    }
  }
  return 'just now';
}

const words = s => (s.trim() ? s.trim().split(/\s+/).length : 0);
const slug  = s => (s || 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Turn "a, b ,, c" into ["a","b","c"]. */
const parseTags = s => [...new Set(String(s || '').split(',').map(t => t.trim()).filter(Boolean))];

/** Button ripple — delegated once, applies to every .btn on the page. */
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const el = document.createElement('span');
  el.className = 'ripple';
  el.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  btn.appendChild(el);
  setTimeout(() => el.remove(), 640);
});

/* ============================================================
   4. TOAST
   ============================================================ */
const toastRoot = $('#toasts');

/**
 * @param {string} msg
 * @param {'ok'|'err'|'info'} kind
 * @param {string} icon  emoji
 * @param {{label:string, fn:Function}=} action  optional inline action (e.g. Undo)
 */
function toast(msg, kind = 'ok', icon = '✅', action) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="ic">${icon}</span><span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'undo';
    b.textContent = action.label;
    b.onclick = () => { action.fn(); dismiss(); };
    el.appendChild(b);
  }
  // cap the stack so a burst of actions can't wallpaper the screen
  while (toastRoot.children.length >= 4) toastRoot.firstElementChild.remove();
  toastRoot.appendChild(el);
  const timer = setTimeout(dismiss, action ? 6000 : 2600);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }
}

/* ============================================================
   5. THEME
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('#themeIcon');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#111827' : '#FBF7F3';
  state.prefs.theme = theme;
  persistPrefs();
}

function toggleTheme() {
  const next = state.prefs.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? 'Dark mode on' : 'Light mode on', 'info', next === 'dark' ? '🌙' : '☀️');
}

/* ============================================================
   6. AUTH
   ============================================================ */
/** Seed the credential record on first run. */
function ensureCreds() {
  let c = load(KEY.creds, null);
  if (!c || !c.u || !c.p) {
    c = { u: DEFAULT_USER, p: hash(DEFAULT_PASS) };
    save(KEY.creds, c);
  }
  return c;
}

const isLoggedIn = () => {
  const s = load(KEY.session, null);
  if (!s) return false;
  if (s.remember) return true;
  return sessionStorage.getItem(NS + 'live') === '1';   // session-only login
};

function login(username, password, remember) {
  const c = ensureCreds();
  return username.trim().toLowerCase() === c.u.toLowerCase() && hash(password) === c.p
    ? (save(KEY.session, { user: c.u, remember, at: Date.now() }),
       sessionStorage.setItem(NS + 'live', '1'), true)
    : false;
}

function logout() {
  confirmModal({
    emoji: '🚪',
    title: 'Log out of JobVault?',
    body: 'Your entries stay saved on this device.',
    confirmLabel: '🚪 Log out',
    danger: false,
    onConfirm() {
      localStorage.removeItem(KEY.session);
      sessionStorage.removeItem(NS + 'live');
      location.reload();
    }
  });
}

function showLogin() {
  $('#login').classList.remove('hidden');
  setTimeout(() => $('#user').focus(), 350);
}

/** Login → dashboard transition. */
function enterApp(animate = true) {
  const loginEl = $('#login');
  const go = () => {
    loginEl.classList.add('hidden');
    loginEl.classList.remove('is-out');
    $('#app').classList.remove('hidden');
    $('#app').classList.add('is-in');
    bootApp();
  };
  if (animate && !loginEl.classList.contains('hidden')) {
    loginEl.classList.add('is-out');
    setTimeout(go, 400);
  } else {
    go();
  }
}

function wireLogin() {
  const form = $('#loginForm'), card = $('#loginCard'), err = $('#loginError');

  $('#pwToggle').addEventListener('click', e => {
    const pw = $('#pass');
    const showing = pw.type === 'password';
    pw.type = showing ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(showing));
    e.currentTarget.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    e.currentTarget.textContent = showing ? '🙈' : '👁️';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const u = $('#user').value, p = $('#pass').value;
    if (login(u, p, $('#remember').checked)) {
      err.classList.remove('show');
      toast('Vault unlocked', 'ok', '🔓');
      enterApp(true);
    } else {
      err.textContent = '❌ Wrong username or password. Try paul / 2557.';
      err.classList.add('show');
      card.classList.remove('shake');
      void card.offsetWidth;               // restart the CSS animation
      card.classList.add('shake');
      $('#pass').value = '';
      $('#pass').focus();
    }
  });
}

/* ============================================================
   7. MODAL ENGINE
   ============================================================ */
const modalRoot = $('#modalRoot');
let openModals = [];

/**
 * Mount a modal.
 * @param {string} html  inner markup for .modal
 * @param {{size?:'sm', onMount?:Function, onClose?:Function, labelledBy?:string}} opts
 */
function openModal(html, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal ${opts.size === 'sm' ? 'sm' : ''}" role="dialog"
       aria-modal="true" ${opts.labelledBy ? `aria-labelledby="${opts.labelledBy}"` : ''}>${html}</div>`;
  modalRoot.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const prevFocus = document.activeElement;
  const api = { overlay, close };
  openModals.push(api);

  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  $$('[data-close]', overlay).forEach(b => b.addEventListener('click', close));
  overlay.addEventListener('keydown', trapFocus);

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const f = $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', overlay)
      .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function close() {
    if (!overlay.isConnected) return;
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      openModals = openModals.filter(m => m !== api);
      if (!openModals.length) document.body.style.overflow = '';
      opts.onClose?.();
      prevFocus?.focus?.();
    }, 220);
  }

  opts.onMount?.(overlay, close);

  // Focus the first sensible control — synchronously, so we never yank focus
  // out from under someone who has already started typing in another field.
  if (!overlay.contains(document.activeElement)) {
    const target = overlay.querySelector('[autofocus]') ||
                   overlay.querySelector('input,textarea,select,button');
    target?.focus({ preventScroll: true });
  }
  return api;
}

const closeTopModal = () => openModals[openModals.length - 1]?.close();

/** Styled replacement for window.confirm. */
function confirmModal({ emoji = '⚠️', title, body, confirmLabel = 'Confirm', danger = true, onConfirm }) {
  openModal(`
    <div class="confirm-body">
      <span class="big" aria-hidden="true">${emoji}</span>
      <h3 id="cfTitle">${esc(title)}</h3>
      <p>${esc(body)}</p>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>Cancel</button>
      <span class="spacer"></span>
      <button class="btn ${danger ? 'btn-solid-danger' : 'btn-primary'}" id="cfYes">${confirmLabel}</button>
    </div>`,
    { size: 'sm', labelledBy: 'cfTitle', onMount(o, close) {
        $('#cfYes', o).addEventListener('click', () => { onConfirm(); close(); });
      } });
}

/* ============================================================
   8. ENTRY MODEL / CRUD
   ============================================================ */
const blankEntry = () => ({
  id: uid(),
  role: '', company: '', type: 'Resume', text: '', notes: '',
  status: 'Saved', tags: [],
  fav: false, archived: false, deletedAt: null,
  order: state.entries.length,
  created: Date.now(), updated: Date.now()
});

const byId = id => state.entries.find(e => e.id === id);

function upsertEntry(entry) {
  const i = state.entries.findIndex(e => e.id === entry.id);
  entry.updated = Date.now();
  if (i > -1) state.entries[i] = entry; else state.entries.unshift(entry);
  persistEntries();
  renderAll();
}

function softDelete(ids) {
  const list = [].concat(ids);
  const snapshot = list.map(id => ({ id, prev: byId(id)?.deletedAt ?? null }));
  list.forEach(id => { const e = byId(id); if (e) { e.deletedAt = Date.now(); e.archived = false; } });
  state.selected.clear();
  persistEntries(); renderAll();
  toast(`${list.length} moved to trash`, 'info', '🗑️', {
    label: 'Undo',
    fn() {
      snapshot.forEach(({ id, prev }) => { const e = byId(id); if (e) e.deletedAt = prev; });
      persistEntries(); renderAll();
      toast('Restored', 'ok', '↩️');
    }
  });
}

function restore(id) {
  const e = byId(id);
  if (!e) return;
  e.deletedAt = null;
  persistEntries(); renderAll();
  toast('Restored to dashboard', 'ok', '↩️');
}

function purge(ids) {
  const list = [].concat(ids);
  state.entries = state.entries.filter(e => !list.includes(e.id));
  persistEntries(); renderAll();
  toast(`${list.length} permanently deleted`, 'err', '🔥');
}

function toggleArchive(ids, value) {
  const list = [].concat(ids);
  list.forEach(id => { const e = byId(id); if (e) e.archived = value ?? !e.archived; });
  state.selected.clear();
  persistEntries(); renderAll();
  toast(value === false ? 'Unarchived' : 'Archived', 'ok', value === false ? '📂' : '📦');
}

function toggleFav(id) {
  const e = byId(id);
  if (!e) return;
  e.fav = !e.fav;
  persistEntries(); renderAll();
  toast(e.fav ? 'Pinned to top' : 'Unpinned', 'ok', e.fav ? '⭐' : '☆');
}

/** Auto-purge trash older than TRASH_DAYS on every boot. */
function purgeExpired() {
  const cutoff = Date.now() - TRASH_DAYS * DAY_MS;
  const before = state.entries.length;
  state.entries = state.entries.filter(e => !(e.deletedAt && e.deletedAt < cutoff));
  if (state.entries.length !== before) persistEntries();
}

/* ---------- entry form modal ---------- */
function entryModal(existing) {
  const e = existing ? structuredClone(existing) : blankEntry();
  const isNew = !existing;

  openModal(`
    <div class="modal-head">
      <h2 id="emTitle">${isNew ? '➕ New entry' : '✏️ Edit entry'}</h2>
      <button class="x-btn" data-close aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <form id="entryForm">
        <div class="grid2">
          <div class="field">
            <label for="fRole">💼 Job role <span class="req">*</span></label>
            <input class="input" id="fRole" required maxlength="120" autofocus
                   placeholder="Senior Frontend Engineer" value="${esc(e.role)}">
          </div>
          <div class="field">
            <label for="fCompany">🏢 Company</label>
            <input class="input" id="fCompany" maxlength="120"
                   placeholder="Acme Inc." value="${esc(e.company)}">
          </div>
        </div>

        <div class="grid2">
          <div class="field">
            <label for="fTypeI">🗂️ Type</label>
            <select class="select" id="fTypeI">
              ${TYPES.map(t => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="fStatusI">📊 Status</label>
            <select class="select" id="fStatusI">
              ${STATUSES.map(s => `<option ${s === e.status ? 'selected' : ''}>${STATUS_EMOJI[s]} ${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="fText">📄 Resume / cover letter text</label>
          <textarea class="textarea mono" id="fText" rows="10"
                    placeholder="Paste the full document here…">${esc(e.text)}</textarea>
          <div class="counter" id="textCount"></div>
        </div>

        <div class="field">
          <label for="fNotes">📝 Job description / notes</label>
          <textarea class="textarea" id="fNotes" rows="4"
                    placeholder="JD highlights, salary range, recruiter name, follow-up date…">${esc(e.notes)}</textarea>
          <div class="counter" id="noteCount2"></div>
        </div>

        <div class="field">
          <label for="fTags">🏷️ Tags <span style="color:var(--text-faint);font-weight:400">(comma separated)</span></label>
          <input class="input" id="fTags" placeholder="remote, react, senior" value="${esc(e.tags.join(', '))}">
        </div>
      </form>
    </div>
    <div class="modal-foot">
      <label class="check" style="font-size:13px">
        <input type="checkbox" id="fFav" ${e.fav ? 'checked' : ''}> ⭐ Favourite
      </label>
      <span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="saveEntry">${isNew ? '💾 Save entry' : '💾 Update'}</button>
    </div>`,
  { labelledBy: 'emTitle', onMount(o, close) {
      const text = $('#fText', o), notes = $('#fNotes', o);
      const count = (el, out) => {
        const v = el.value;
        $(out, o).textContent = `${words(v)} words · ${v.length} chars`;
      };
      count(text, '#textCount'); count(notes, '#noteCount2');
      text.addEventListener('input', () => count(text, '#textCount'));
      notes.addEventListener('input', () => count(notes, '#noteCount2'));

      const submit = () => {
        const role = $('#fRole', o).value.trim();
        if (!role) {
          $('#fRole', o).focus();
          toast('Job role is required', 'err', '⚠️');
          return;
        }
        const prevStatus = e.status;
        e.role    = role;
        e.company = $('#fCompany', o).value.trim();
        e.type    = $('#fTypeI', o).value;
        e.status  = $('#fStatusI', o).value.replace(/^\S+\s/, '');   // strip the emoji
        e.text    = text.value;
        e.notes   = notes.value;
        e.tags    = parseTags($('#fTags', o).value);
        e.fav     = $('#fFav', o).checked;

        upsertEntry(e);
        close();
        toast(isNew ? 'Entry saved' : 'Entry updated', 'ok', isNew ? '📄' : '✏️');
        if (e.status === 'Offer' && prevStatus !== 'Offer') celebrate();
      };

      $('#saveEntry', o).addEventListener('click', submit);
      $('#entryForm', o).addEventListener('submit', ev => { ev.preventDefault(); submit(); });
      // Ctrl/Cmd+Enter saves from anywhere in the form
      o.addEventListener('keydown', ev => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); submit(); }
      });
    } });
}

/* ---------- read-only viewer ---------- */
function viewerModal(id) {
  const e = byId(id);
  if (!e) return;

  openModal(`
    <div class="modal-head">
      <span style="font-size:22px">${TYPE_EMOJI[e.type]}</span>
      <div style="margin-right:auto;min-width:0">
        <h2 id="vwTitle">${esc(e.role)}</h2>
        <div class="sub">${esc(e.company || 'No company')} · ${fmtDate(e.created)}</div>
      </div>
      <button class="x-btn" data-close aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <div class="viewer-meta">
        <span class="status" data-s="${e.status}">${STATUS_EMOJI[e.status]} ${e.status}</span>
        <span class="tag">${TYPE_EMOJI[e.type]} ${esc(e.type)}</span>
        ${e.fav ? '<span class="tag">⭐ Favourite</span>' : ''}
        ${e.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}
        <span style="margin-left:auto;font-size:11.5px;color:var(--text-faint)">
          ${words(e.text)} words · updated ${relative(e.updated)}
        </span>
      </div>

      <div class="viewer-block">
        <h4>📄 Document</h4>
        <div class="viewer-text">${esc(e.text) || '<span style="color:var(--text-faint)">Empty — hit Edit to paste your document.</span>'}</div>
      </div>

      ${e.notes ? `<div class="viewer-block">
        <h4>📝 Job description / notes</h4>
        <div class="viewer-text">${esc(e.notes)}</div>
      </div>` : ''}
    </div>
    <div class="modal-foot" style="flex-wrap:wrap">
      <button class="btn btn-sm" id="vCopy">📋 Copy</button>
      <button class="btn btn-sm" id="vTxt">⬇️ .txt</button>
      <button class="btn btn-sm" id="vMd">⬇️ .md</button>
      <button class="btn btn-sm" id="vPrint">🖨️ Print</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="vEdit">✏️ Edit</button>
    </div>`,
  { labelledBy: 'vwTitle', onMount(o, close) {
      $('#vCopy',  o).onclick = () => copyText(e.text, e.role);
      $('#vTxt',   o).onclick = () => download(e, 'txt');
      $('#vMd',    o).onclick = () => download(e, 'md');
      $('#vPrint', o).onclick = () => window.print();
      $('#vEdit',  o).onclick = () => { close(); setTimeout(() => entryModal(e), 240); };
    } });
}

/* ============================================================
   9. FILTER / SORT / RENDER
   ============================================================ */
const live    = () => state.entries.filter(e => !e.deletedAt && !e.archived);
const archived= () => state.entries.filter(e => !e.deletedAt && e.archived);
const trashed = () => state.entries.filter(e => e.deletedAt);

function matches(e, q) {
  if (!q) return true;
  const hay = [e.role, e.company, e.type, e.status, e.text, e.notes, e.tags.join(' ')]
    .join(' ').toLowerCase();
  // every whitespace-separated term must appear (AND search)
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

function sortEntries(list) {
  const s = state.prefs.sort;
  const arr = [...list];
  const cmp = {
    'date-desc': (a, b) => b.created - a.created,
    'date-asc' : (a, b) => a.created - b.created,
    'az'       : (a, b) => a.role.localeCompare(b.role),
    'za'       : (a, b) => b.role.localeCompare(a.role),
    'status'   : (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || b.created - a.created,
    'manual'   : (a, b) => (a.order ?? 0) - (b.order ?? 0)
  }[s] || ((a, b) => b.created - a.created);

  arr.sort(cmp);
  // favourites always float to the top (except in explicit manual mode)
  return s === 'manual' ? arr : arr.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
}

function visibleEntries() {
  return sortEntries(live().filter(e =>
    matches(e, state.q) &&
    (!state.fType   || e.type === state.fType) &&
    (!state.fStatus || e.status === state.fStatus) &&
    (!state.fTag    || e.tags.includes(state.fTag))
  ));
}

/* ---------- card template ---------- */
function cardHTML(e, i, mode = 'live') {
  const excerpt = (e.text || e.notes || '').slice(0, 220);
  const wide = e.fav && mode === 'live';
  const daysLeft = e.deletedAt ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - e.deletedAt) / DAY_MS)) : 0;

  const actions = {
    live: `
      <button class="mini" data-act="fav" title="${e.fav ? 'Unpin' : 'Pin to top'}"
              aria-pressed="${e.fav}" aria-label="${e.fav ? 'Unpin' : 'Pin'} ${esc(e.role)}">${e.fav ? '⭐' : '☆'}</button>
      <button class="mini" data-act="view"    title="View">👁️</button>
      <button class="mini" data-act="copy"    title="Copy text">📋</button>
      <button class="mini" data-act="edit"    title="Edit">✏️</button>
      <button class="mini" data-act="archive" title="Archive">📦</button>
      <button class="mini" data-act="delete"  title="Delete">🗑️</button>`,
    archive: `
      <button class="mini" data-act="view"      title="View">👁️</button>
      <button class="mini" data-act="unarchive" title="Restore to dashboard">📂</button>
      <button class="mini" data-act="delete"    title="Delete">🗑️</button>`,
    trash: `
      <button class="mini" data-act="restore" title="Restore">↩️</button>
      <button class="mini" data-act="purge"   title="Delete forever">🔥</button>`
  }[mode];

  return `
  <article class="tile card ${wide ? 'wide' : ''} ${state.selected.has(e.id) ? 'selected' : ''}"
           style="--i:${i}" data-id="${e.id}" data-mode="${mode}"
           ${mode === 'live' ? 'draggable="true"' : ''}
           tabindex="0" role="button" aria-label="${esc(e.role)} at ${esc(e.company || 'unknown company')}">

    ${mode === 'live' ? `<input type="checkbox" class="card-check" data-act="select"
        ${state.selected.has(e.id) ? 'checked' : ''} aria-label="Select ${esc(e.role)}">` : ''}

    <div class="card-actions">${actions}</div>

    <div class="card-head">
      <div class="card-type" aria-hidden="true">${TYPE_EMOJI[e.type]}</div>
      <div class="card-titles">
        <h3>${esc(e.role)}</h3>
        <p>🏢 ${esc(e.company || '—')}</p>
      </div>
      ${e.fav ? '<span class="card-star on" title="Pinned" aria-hidden="true">⭐</span>' : ''}
    </div>

    ${excerpt ? `<p class="card-excerpt">${esc(excerpt)}</p>` : ''}
    ${e.tags.length ? `<div class="card-tags">${e.tags.slice(0, 4).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}

    <div class="card-foot">
      <span class="status" data-s="${e.status}">${STATUS_EMOJI[e.status]} ${e.status}</span>
      <span class="card-date">${mode === 'trash' ? `⏳ ${daysLeft}d left` : fmtDate(e.created)}</span>
    </div>
    ${mode === 'live' ? '<span class="drag-dot" aria-hidden="true">⠿</span>' : ''}
  </article>`;
}

const emptyHTML = (emoji, title, body, cta = '') => `
  <div class="empty">
    <span class="big" aria-hidden="true">${emoji}</span>
    <h3>${title}</h3>
    <p>${body}</p>
    ${cta}
  </div>`;

/* ---------- renderers ---------- */
function renderGrid() {
  const grid = $('#grid');
  const list = visibleEntries();
  const filtering = state.q || state.fType || state.fStatus || state.fTag;

  grid.innerHTML = list.length
    ? list.map((e, i) => cardHTML(e, i, 'live')).join('')
    : (live().length && filtering
        ? emptyHTML('🔍', 'No matches', 'Nothing fits those filters. Try clearing them.',
            '<button class="btn" id="clearFilters">🧹 Clear filters</button>')
        : emptyHTML('🗂️', 'Your vault is empty',
            'Add your first resume or cover letter and JobVault will keep it organised by job role.',
            '<button class="btn btn-primary" id="emptyNew">➕ Add your first entry</button>'));

  $('#clearFilters')?.addEventListener('click', clearFilters);
  $('#emptyNew')?.addEventListener('click', () => entryModal());
}

function renderArchive() {
  const list = archived().filter(e => matches(e, state.archQ));
  $('#archGrid').innerHTML = list.length
    ? list.map((e, i) => cardHTML(e, i, 'archive')).join('')
    : emptyHTML('📦', 'Archive is empty', 'Archived entries stay searchable here without cluttering your dashboard.');
}

function renderTrash() {
  const list = trashed().sort((a, b) => b.deletedAt - a.deletedAt);
  $('#trashGrid').innerHTML = list.length
    ? list.map((e, i) => cardHTML(e, i, 'trash')).join('')
    : emptyHTML('🧹', 'Trash is clean', 'Deleted entries land here and are auto-purged after 30 days.');
}

function renderTagChips() {
  const counts = {};
  live().forEach(e => e.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14);
  const box = $('#tagChips');
  box.innerHTML = tags.length
    ? `<button class="chip ${state.fTag ? '' : 'on'}" data-tag="">All</button>` +
      tags.map(([t, n]) => `<button class="chip ${state.fTag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)} <b>${n}</b></button>`).join('')
    : '';
}

function renderBulkBar() {
  const n = state.selected.size;
  $('#bulkbar').innerHTML = n ? `
    <div class="bulkbar">
      <b>✅ ${n} selected</b>
      <button class="btn btn-sm" data-bulk="all">Select all</button>
      <button class="btn btn-sm" data-bulk="none">Clear</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-bulk="archive">📦 Archive</button>
      <button class="btn btn-sm btn-danger" data-bulk="delete">🗑️ Delete</button>
    </div>` : '';
  document.body.classList.toggle('selectmode', n > 0);
}

function renderCounts() {
  $('#cDash').textContent  = live().length;
  $('#cNotes').textContent = state.notes.length;
  $('#cArch').textContent  = archived().length;
  $('#cTrash').textContent = trashed().length;
  const sub = $('#brandSub');
  if (sub) {
    const n = live().length, m = state.notes.length;
    sub.textContent = `💼 ${n} ${n === 1 ? 'entry' : 'entries'} · ${m} ${m === 1 ? 'note' : 'notes'}`;
  }
}

function renderAll() {
  renderGrid();
  renderTagChips();
  renderBulkBar();
  renderArchive();
  renderTrash();
  renderNotes();
  renderStats();
  renderCounts();
}

function clearFilters() {
  state.q = state.fType = state.fStatus = state.fTag = '';
  $('#search').value = ''; $('#fType').value = ''; $('#fStatus').value = '';
  renderAll();
  toast('Filters cleared', 'info', '🧹');
}

/* ============================================================
   10. NOTES  (quick comments)
   ============================================================ */
const blankNote = () => ({ id: uid(), title: '', body: '', color: state.prefs.noteColor,
                           pinned: false, created: Date.now(), updated: Date.now() });

function addNote(title, body) {
  const n = blankNote();
  n.title = title.trim() || '📝 Note';
  n.body  = body.trim();
  state.notes.unshift(n);
  persistNotes(); renderAll();
  toast('Note added', 'ok', '📝');
}

function noteHTML(n, i) {
  return `
  <article class="tile note ${n.pinned ? 'pinned' : ''}" style="--i:${i};border-left-color:${n.color}" data-note="${n.id}">
    <div class="card-actions">
      <button class="mini" data-nact="pin"  title="${n.pinned ? 'Unpin' : 'Pin'}">${n.pinned ? '📌' : '📍'}</button>
      <button class="mini" data-nact="copy" title="Copy">📋</button>
      <button class="mini" data-nact="edit" title="Edit">✏️</button>
      <button class="mini" data-nact="del"  title="Delete">🗑️</button>
    </div>
    <h4>${esc(n.title)}</h4>
    <div class="note-body">${esc(n.body)}</div>
    <div class="note-foot">
      <time datetime="${new Date(n.created).toISOString()}">🕒 ${relative(n.updated)}</time>
      <span class="tag">${words(n.body)}w</span>
    </div>
  </article>`;
}

function renderNotes() {
  const list = state.notes
    .filter(n => !state.noteQ || (n.title + ' ' + n.body).toLowerCase().includes(state.noteQ.toLowerCase()))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);

  $('#noteGrid').innerHTML = list.length
    ? list.map(noteHTML).join('')
    : emptyHTML('📝', 'No notes yet', 'Jot down recruiter calls, salary numbers or interview questions — they stay next to your documents.');
}

function editNoteModal(n) {
  openModal(`
    <div class="modal-head">
      <h2 id="nmTitle">✏️ Edit note</h2>
      <button class="x-btn" data-close aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label for="enTitle">Title</label>
        <input class="input" id="enTitle" value="${esc(n.title)}" maxlength="90" autofocus>
      </div>
      <div class="field">
        <label for="enBody">Note</label>
        <textarea class="textarea" id="enBody" rows="8">${esc(n.body)}</textarea>
        <div class="counter" id="enCount"></div>
      </div>
      <div class="field">
        <label>Colour</label>
        <div class="note-color-row" id="enColors"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>Cancel</button>
      <span class="spacer"></span>
      <button class="btn btn-primary" id="enSave">💾 Save note</button>
    </div>`,
  { labelledBy: 'nmTitle', onMount(o, close) {
      let color = n.color;
      const colors = $('#enColors', o);
      colors.innerHTML = NOTE_COLORS.map(c =>
        `<button type="button" class="swatch ${c === color ? 'on' : ''}" data-c="${c}"
                 style="background:${c}" aria-label="Colour ${c}"></button>`).join('');
      colors.addEventListener('click', ev => {
        const b = ev.target.closest('.swatch'); if (!b) return;
        color = b.dataset.c;
        $$('.swatch', colors).forEach(s => s.classList.toggle('on', s === b));
      });

      const body = $('#enBody', o);
      const upd = () => $('#enCount', o).textContent = `${words(body.value)} words · ${body.value.length} chars`;
      upd(); body.addEventListener('input', upd);

      $('#enSave', o).onclick = () => {
        n.title = $('#enTitle', o).value.trim() || '📝 Note';
        n.body  = body.value;
        n.color = color;
        n.updated = Date.now();
        persistNotes(); renderAll(); close();
        toast('Note updated', 'ok', '✏️');
      };
    } });
}

function wireNotes() {
  // colour picker on the compose tile
  const colors = $('#noteColors');
  colors.innerHTML = NOTE_COLORS.map(c =>
    `<button type="button" class="swatch ${c === state.prefs.noteColor ? 'on' : ''}" data-c="${c}"
             style="background:${c}" role="radio" aria-checked="${c === state.prefs.noteColor}" aria-label="Colour ${c}"></button>`).join('');
  colors.addEventListener('click', e => {
    const b = e.target.closest('.swatch'); if (!b) return;
    state.prefs.noteColor = b.dataset.c; persistPrefs();
    $$('.swatch', colors).forEach(s => {
      s.classList.toggle('on', s === b);
      s.setAttribute('aria-checked', String(s === b));
    });
  });

  const body = $('#noteBody');
  const upd = () => $('#noteCount').textContent = `${words(body.value)} words · ${body.value.length} chars`;
  body.addEventListener('input', upd); upd();
  body.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('#noteForm').requestSubmit();
  });

  $('#noteForm').addEventListener('submit', e => {
    e.preventDefault();
    const t = $('#noteTitle').value, b = body.value;
    if (!t.trim() && !b.trim()) { toast('Write something first', 'err', '✍️'); return; }
    addNote(t, b);
    $('#noteTitle').value = ''; body.value = ''; upd();
  });

  $('#noteSearch').addEventListener('input', e => { state.noteQ = e.target.value; renderNotes(); });

  // delegated note actions
  $('#noteGrid').addEventListener('click', e => {
    const card = e.target.closest('[data-note]'); if (!card) return;
    const n = state.notes.find(x => x.id === card.dataset.note); if (!n) return;
    const act = e.target.closest('[data-nact]')?.dataset.nact;

    if (act === 'pin')  { n.pinned = !n.pinned; n.updated = Date.now(); persistNotes(); renderAll(); toast(n.pinned ? 'Pinned' : 'Unpinned', 'ok', '📌'); }
    else if (act === 'copy') copyText(`${n.title}\n\n${n.body}`, n.title);
    else if (act === 'del') {
      const snapshot = { note: n, index: state.notes.indexOf(n) };
      state.notes = state.notes.filter(x => x.id !== n.id);
      persistNotes(); renderAll();
      toast('Note deleted', 'info', '🗑️', { label: 'Undo', fn() {
        state.notes.splice(snapshot.index, 0, snapshot.note);
        persistNotes(); renderAll();
      } });
    }
    else editNoteModal(n);      // click anywhere else opens the editor
  });
}

/* ============================================================
   11. STATS
   ============================================================ */
/** Ease-out counter animation. */
function animateCount(el, to) {
  const from = Number(el.dataset.count || 0);
  if (from === to) { el.textContent = to; return; }
  el.dataset.count = to;
  const dur = 700, t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStats() {
  const all = state.entries.filter(e => !e.deletedAt);
  const resumes = all.filter(e => e.type === 'Resume' || e.type === 'Both').length;
  const letters = all.filter(e => e.type === 'Cover Letter' || e.type === 'Both').length;
  const applied = all.filter(e => ['Applied', 'Interview', 'Offer', 'Rejected'].includes(e.status)).length;
  const inter   = all.filter(e => ['Interview', 'Offer'].includes(e.status)).length;

  const nums = $$('#statsBento .stat-num');
  [resumes, letters, applied, inter].forEach((v, i) => nums[i] && animateCount(nums[i], v));

  // sparkline: last 6 months of entry creation
  $$('#statsBento .stat-spark').forEach((spark, idx) => {
    const now = new Date();
    const buckets = Array.from({ length: 6 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - k), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return all.filter(e => {
        const t = e.created;
        const typeOk = idx === 0
          ? (e.type === 'Resume' || e.type === 'Both')
          : (e.type === 'Cover Letter' || e.type === 'Both');
        return typeOk && t >= +d && t < +end;
      }).length;
    });
    const max = Math.max(1, ...buckets);
    $$('i', spark).forEach((bar, k) => {
      bar.style.height = `${Math.max(12, (buckets[k] / max) * 100)}%`;
      bar.style.background = buckets[k] ? 'linear-gradient(180deg, var(--accent-soft), var(--accent-deep))' : 'var(--accent-ghost)';
      bar.style.animationDelay = `${k * 60}ms`;
    });
  });

  // conversion rates on the two lower stat tiles
  const rate = (sel, n, of, label) => {
    const box = $(sel);
    if (!box) return;
    const pct = of ? Math.round((n / of) * 100) : 0;
    $('i', box).style.width = pct + '%';
    $('span', box).textContent = of ? `${pct}% ${label}` : `no data yet`;
  };
  rate('[data-rate="applied"]',   applied, all.length, 'of vault');
  rate('[data-rate="interview"]', inter,   applied,    'of applications');

  // pipeline funnel
  const total = all.length || 1;
  $('#funnel').innerHTML = STATUSES.map(s => {
    const n = all.filter(e => e.status === s).length;
    const pct = Math.round((n / total) * 100);
    return `<div class="funnel-row">
      <b>${STATUS_EMOJI[s]} ${s}</b>
      <div class="funnel-bar"><i style="width:${all.length ? pct : 0}%;background:var(${STATUS_VAR[s]})"></i></div>
      <em>${n}</em>
    </div>`;
  }).join('');
}

/* ============================================================
   12. BULK ACTIONS & DRAG REORDER
   ============================================================ */
function wireBulk() {
  $('#bulkbar').addEventListener('click', e => {
    const act = e.target.closest('[data-bulk]')?.dataset.bulk;
    if (!act) return;
    const ids = [...state.selected];

    if (act === 'all')  { visibleEntries().forEach(x => state.selected.add(x.id)); renderAll(); }
    if (act === 'none') { state.selected.clear(); renderAll(); }
    if (act === 'archive' && ids.length) toggleArchive(ids, true);
    if (act === 'delete' && ids.length) {
      confirmModal({
        emoji: '🗑️', title: `Delete ${ids.length} entries?`,
        body: 'They go to Trash and can be restored for 30 days.',
        confirmLabel: '🗑️ Move to trash',
        onConfirm: () => softDelete(ids)
      });
    }
  });
}

let dragId = null;

function wireDrag() {
  const grid = $('#grid');

  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.card'); if (!card) return;
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  grid.addEventListener('dragend', () => {
    dragId = null;
    $$('.card', grid).forEach(c => c.classList.remove('dragging', 'drop-target'));
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.card');
    $$('.card', grid).forEach(c => c.classList.toggle('drop-target', c === card && c.dataset.id !== dragId));
  });

  grid.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.card');
    if (!card || !dragId || card.dataset.id === dragId) return;

    // Reordering implies manual sort — switch to it so the new order is visible.
    const order = visibleEntries().map(x => x.id);
    const from = order.indexOf(dragId), to = order.indexOf(card.dataset.id);
    order.splice(to, 0, order.splice(from, 1)[0]);
    order.forEach((id, i) => { const en = byId(id); if (en) en.order = i; });

    if (state.prefs.sort !== 'manual') {
      state.prefs.sort = 'manual';
      $('#sort').value = 'manual';
      persistPrefs();
      toast('Switched to manual order', 'info', '✋');
    }
    persistEntries(); renderAll();
  });
}

/* ============================================================
   13. COPY / DOWNLOAD / BACKUP
   ============================================================ */
async function copyText(text, label = '') {
  if (!text) { toast('Nothing to copy', 'err', '📭'); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard API needs a secure context — fall back to a hidden textarea
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { toast('Copy blocked by browser', 'err', '🚫'); }
    ta.remove();
  }
  toast(label ? `Copied! ✅ ${label}` : 'Copied! ✅', 'ok', '📋');
}

function saveBlob(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download(e, fmt) {
  const stamp = new Date(e.created).toISOString().slice(0, 10);
  const base = `${slug(e.role)}${e.company ? '-' + slug(e.company) : ''}-${stamp}`;

  if (fmt === 'md') {
    const md = [
      `# ${e.role}`,
      e.company ? `**Company:** ${e.company}  ` : '',
      `**Type:** ${e.type}  `,
      `**Status:** ${e.status}  `,
      `**Created:** ${fmtDate(e.created)}  `,
      e.tags.length ? `**Tags:** ${e.tags.map(t => '`' + t + '`').join(', ')}` : '',
      '', '---', '', e.text || '_(empty)_',
      e.notes ? `\n---\n\n## Notes\n\n${e.notes}` : ''
    ].filter(Boolean).join('\n');
    saveBlob(`${base}.md`, md, 'text/markdown;charset=utf-8');
  } else {
    const txt = [
      e.role.toUpperCase(),
      e.company ? `Company: ${e.company}` : '',
      `Type: ${e.type} | Status: ${e.status} | Created: ${fmtDate(e.created)}`,
      e.tags.length ? `Tags: ${e.tags.join(', ')}` : '',
      '='.repeat(60), '', e.text || '(empty)',
      e.notes ? `\n${'='.repeat(60)}\nNOTES\n\n${e.notes}` : ''
    ].filter(Boolean).join('\n');
    saveBlob(`${base}.txt`, txt, 'text/plain;charset=utf-8');
  }
  toast(`Downloaded .${fmt}`, 'ok', '⬇️');
}

function backupAll() {
  const payload = {
    app: 'JobVault', version: 1, exportedAt: new Date().toISOString(),
    entries: state.entries, notes: state.notes, prefs: state.prefs
  };
  saveBlob(`jobvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2), 'application/json');
  toast('Backup downloaded', 'ok', '📦');
}

/* ============================================================
   14. CONFETTI 🎉
   ============================================================ */
function celebrate() {
  const cv = $('#confetti');
  cv.classList.remove('hidden');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const colors = ['#FF9030', '#FFB067', '#34D399', '#5AA9FF', '#C084FC', '#FFFFFF'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 220,
    y: innerHeight * .34,
    vx: (Math.random() - .5) * 13,
    vy: Math.random() * -15 - 4,
    w: 5 + Math.random() * 7,
    h: 8 + Math.random() * 10,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - .5) * .3,
    c: colors[(Math.random() * colors.length) | 0]
  }));

  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach(p => {
      p.vy += .38; p.x += p.vx; p.y += p.vy; p.vx *= .992; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - frame / 165);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (++frame < 170) requestAnimationFrame(tick);
    else { ctx.clearRect(0, 0, innerWidth, innerHeight); cv.classList.add('hidden'); }
  })();

  toast('Offer! Congratulations 🎉', 'ok', '🏆');
}

/* ============================================================
   15. KEYBOARD SHORTCUTS
   ============================================================ */
function wireKeys() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (openModals.length) { e.preventDefault(); closeTopModal(); }
      else if (typing && e.target.type === 'search') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('#app').classList.contains('hidden')) return;

    if (e.key === '/') { e.preventDefault(); switchView('dashboard'); $('#search').focus(); }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); entryModal(); }
    if (e.key.toLowerCase() === 't') { e.preventDefault(); toggleTheme(); }
    if (e.key === '?') { e.preventDefault(); shortcutsModal(); }
  });
}

function shortcutsModal() {
  const rows = [
    ['/', 'Focus search'], ['N', 'New entry'], ['T', 'Toggle theme'],
    ['Esc', 'Close modal / clear search'], ['⌘/Ctrl + Enter', 'Save from a form'], ['?', 'This help']
  ];
  openModal(`
    <div class="modal-head"><h2 id="skTitle">⌨️ Keyboard shortcuts</h2>
      <button class="x-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">
      ${rows.map(([k, v]) => `<div class="funnel-row" style="grid-template-columns:150px 1fr;margin-bottom:8px">
        <b><span class="search-kbd" style="position:static;transform:none">${k}</span></b>
        <span style="color:var(--text-dim)">${v}</span></div>`).join('')}
    </div>`, { size: 'sm', labelledBy: 'skTitle' });
}

/* ============================================================
   16. VIEW SWITCHING + EVENT WIRING
   ============================================================ */
function switchView(view) {
  state.view = view;
  ['dashboard', 'notes', 'archive', 'trash'].forEach(v => {
    $(`#view-${v}`).classList.toggle('hidden', v !== view);
    const tab = $(`#tab-${v}`);
    tab.setAttribute('aria-selected', String(v === view));
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** One delegated handler for every entry grid (live / archive / trash). */
function wireGrids() {
  ['#grid', '#archGrid', '#trashGrid'].forEach(sel => {
    const root = $(sel);

    root.addEventListener('click', e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id, mode = card.dataset.mode, entry = byId(id);
      if (!entry) return;
      const act = e.target.closest('[data-act]')?.dataset.act;

      switch (act) {
        case 'select':
          state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
          card.classList.toggle('selected');
          renderBulkBar();
          return;
        case 'fav':       toggleFav(id); return;
        case 'view':      viewerModal(id); return;
        case 'copy':      copyText(entry.text, entry.role); return;
        case 'edit':      entryModal(entry); return;
        case 'archive':   toggleArchive(id, true); return;
        case 'unarchive': toggleArchive(id, false); return;
        case 'restore':   restore(id); return;
        case 'delete':
          confirmModal({
            emoji: '🗑️', title: `Delete “${entry.role}”?`,
            body: 'It moves to Trash and can be restored for 30 days.',
            confirmLabel: '🗑️ Move to trash',
            onConfirm: () => softDelete(id)
          });
          return;
        case 'purge':
          confirmModal({
            emoji: '🔥', title: 'Delete forever?',
            body: `“${entry.role}” will be gone permanently. This cannot be undone.`,
            confirmLabel: '🔥 Delete forever',
            onConfirm: () => purge(id)
          });
          return;
      }
      if (mode !== 'trash') viewerModal(id);   // bare card click → viewer
    });

    // keyboard: Enter/Space opens the card
    root.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.card');
      if (!card || card.dataset.mode === 'trash') return;
      e.preventDefault();
      viewerModal(card.dataset.id);
    });
  });
}

function wireApp() {
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#logoutBtn').addEventListener('click', logout);
  $('#newBtn').addEventListener('click', () => entryModal());
  $('#heroNew').addEventListener('click', () => entryModal());
  $('#heroNote').addEventListener('click', () => { switchView('notes'); setTimeout(() => $('#noteTitle').focus(), 250); });
  $('#exportAllBtn').addEventListener('click', backupAll);

  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#search').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });
  $('#fType').addEventListener('change', e => { state.fType = e.target.value; renderGrid(); });
  $('#fStatus').addEventListener('change', e => { state.fStatus = e.target.value; renderGrid(); });
  $('#sort').addEventListener('change', e => {
    state.prefs.sort = e.target.value; persistPrefs(); renderGrid();
  });
  $('#archSearch').addEventListener('input', e => { state.archQ = e.target.value; renderArchive(); });

  $('#tagChips').addEventListener('click', e => {
    const chip = e.target.closest('[data-tag]'); if (!chip) return;
    state.fTag = chip.dataset.tag;
    renderGrid(); renderTagChips();
  });

  $('#emptyTrashBtn').addEventListener('click', () => {
    const ids = trashed().map(e => e.id);
    if (!ids.length) { toast('Trash is already empty', 'info', '🧹'); return; }
    confirmModal({
      emoji: '🔥', title: `Empty trash (${ids.length})?`,
      body: 'Every item in Trash will be deleted permanently.',
      confirmLabel: '🔥 Empty trash',
      onConfirm: () => purge(ids)
    });
  });

  wireGrids(); wireBulk(); wireDrag(); wireNotes(); wireKeys();

  // keep multiple tabs of the app in sync
  window.addEventListener('storage', ev => {
    if (ev.key === KEY.entries) { state.entries = load(KEY.entries, []); renderAll(); }
    if (ev.key === KEY.notes)   { state.notes   = load(KEY.notes, []);   renderAll(); }
  });
}

/* ============================================================
   17. BOOT
   ============================================================ */
let appBooted = false;

function bootApp() {
  if (appBooted) return;
  appBooted = true;

  const user = (load(KEY.session, {}).user || DEFAULT_USER);
  const name = user.charAt(0).toUpperCase() + user.slice(1);
  $('#greeting').innerHTML = `${timeGreeting()}, ${esc(name)}! <span class="wave">👋</span>`;
  $('#todayLine').textContent = `📅 ${fmtLong(Date.now())}`;

  $('#sort').value = state.prefs.sort;
  purgeExpired();
  wireApp();
  renderAll();
}

const timeGreeting = () => {
  const h = new Date().getHours();
  if (h < 5)  return 'Still up, ';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

function init() {
  applyTheme(state.prefs.theme);
  ensureCreds();
  wireLogin();

  setTimeout(() => {
    $('#splash').classList.add('is-out');
    setTimeout(() => {
      $('#splash').remove();
      if (isLoggedIn()) enterApp(false);
      else showLogin();
    }, 480);
  }, 1100);
}

document.addEventListener('DOMContentLoaded', init);
})();
