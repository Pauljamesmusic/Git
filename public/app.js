/**
 * app.js — Prompt Vault front end.
 *
 * How it works
 * ------------
 * The whole library is fetched once (GET /api/state) and kept in memory.
 * Search and category filtering run locally, so they are instant as you
 * type. Every change is written to SQLite through the API first; local
 * state only updates once the server confirms, so what you see on screen
 * is always what is actually stored.
 */

/* ================================================================
   API CLIENT
   ================================================================ */
const api = {
  async req(method, path, body) {
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Server down, laptop asleep, port changed — all land here.
      throw new Error("Can’t reach the server. Is it still running?");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
    return data;
  },
  get:   (p)    => api.req("GET", p),
  post:  (p, b) => api.req("POST", p, b),
  patch: (p, b) => api.req("PATCH", p, b),
  del:   (p)    => api.req("DELETE", p),
};

/* ================================================================
   STATE
   ================================================================ */
let cats = [];
let prompts = [];
let hues = ["--h-violet", "--h-cyan", "--h-pink", "--h-amber", "--h-lime", "--h-rose"];

let activeCat = "all";     // "all" | "none" (uncategorised) | a category id
let query = "";
let openId = null;         // prompt shown in the view sheet
let editId = null;         // prompt being edited (null = creating)
let editCatId = null;      // category being edited
let editCatHue = null;
let palIdx = 0;
let pendingImport = null;  // { payload, filename }
let timers = {};

const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const UNCATEGORISED = { id: "none", name: "Uncategorised", hue: "--h-amber", synthetic: true };
const catOf = (id) => (id ? cats.find((c) => c.id === id) : null) || UNCATEGORISED;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Placeholder tokens: [like this]. The second accent colour exists for these. */
const TOKEN_RE = /\[([^\]\n]{1,60})\]/g;
const tokensIn = (t) => [...new Set(t.match(TOKEN_RE) || [])];
const markTokens = (t) => esc(t).replace(/\[([^\]\n]{1,60})\]/g, '<span class="tok">[$1]</span>');
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/* ================================================================
   FEEDBACK
   ================================================================ */
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.classList.add("on");
  clearTimeout(timers.toast);
  timers.toast = setTimeout(() => t.classList.remove("on"), bad ? 4000 : 2000);
}

function showErr(sel, message) {
  const el = $(sel);
  el.textContent = message;
  el.classList.add("on");
}
const clearErr = (sel) => $(sel).classList.remove("on");

function setOffline(on, msg) {
  $("#offline").classList.toggle("on", on);
  if (msg) $("#offline-msg").textContent = msg;
}

/** Disables a button for the length of a request so double-clicks can't double-write. */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn) btn.disabled = false; }
}

/* ================================================================
   RENDER
   ================================================================ */
function visible() {
  const q = query.trim().toLowerCase();
  return prompts.filter((p) => {
    const inCat =
      activeCat === "all" ? true :
      activeCat === "none" ? !p.categoryId :
      p.categoryId === activeCat;
    return inCat && (!q || p.title.toLowerCase().includes(q));  // live filter, by title
  });
}

const orphanCount = () => prompts.filter((p) => !p.categoryId).length;

function renderNav() {
  $("#count-all").textContent = prompts.length;

  const rows = cats.map((c) => ({ ...c, n: prompts.filter((p) => p.categoryId === c.id).length, editable: true }));
  // Only show Uncategorised when something is actually sitting there.
  if (orphanCount() > 0) rows.push({ ...UNCATEGORISED, n: orphanCount(), editable: false });

  $("#catnav").innerHTML = rows.map((c) => `
    <button class="navrow" data-cat="${c.id}" style="--hue:var(${c.hue})" aria-current="${activeCat === c.id}">
      <span class="dot"></span>
      <span class="nm">${esc(c.name)}</span>
      ${c.editable ? `<span class="edit" role="button" tabindex="0" data-editcat="${c.id}" aria-label="Edit ${esc(c.name)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
      </span>` : ""}
      <span class="count">${c.n}</span>
    </button>`).join("");

  $$("[data-cat]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.cat === activeCat)));

  // Categories you said are coming — one click, no schema change.
  const pending = ["Job Search", "Tracker Prompts"].filter((n) => !cats.some((c) => c.name.toLowerCase() === n.toLowerCase()));
  $("#ghosts").innerHTML = pending.map((n) => `<button class="ghost" data-ghost="${esc(n)}">+ ${esc(n)}</button>`).join("");
}

function renderGrid() {
  const list = visible();
  const showing = activeCat === "all" ? null : catOf(activeCat === "none" ? null : activeCat);

  $("#head").hidden = false;
  $("#view-name").textContent = showing ? showing.name : "All prompts";
  $("#view-dot").style.setProperty("--hue", showing ? `var(${showing.hue})` : "var(--text-3)");
  $("#view-sub").innerHTML = query.trim()
    ? `<b>${list.length}</b> match${list.length === 1 ? "" : "es"} for “${esc(query.trim())}”`
    : `<b>${list.length}</b> prompt${list.length === 1 ? "" : "s"}${showing ? "" : ` across ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`}`;

  $("#grid").innerHTML = list.map((p) => {
    const c = catOf(p.categoryId);
    const n = tokensIn(p.body).length;
    return `
    <article class="card" style="--hue:var(${c.hue})" data-id="${p.id}">
      <div class="card-top">
        <span class="chip"><span class="dot"></span>${esc(c.name)}</span>
        <div class="card-acts">
          <button class="icon-btn" data-edit="${p.id}" aria-label="Edit ${esc(p.title)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn danger" data-del="${p.id}" aria-label="Delete ${esc(p.title)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
          </button>
        </div>
      </div>
      <h3 class="card-title" data-open="${p.id}">${esc(p.title)}</h3>
      <div class="meta">
        ${n ? `<span class="vars">${n} variable${n === 1 ? "" : "s"}</span>` : `<span>no variables</span>`}
        <span>${p.body.length} chars</span>
        <span>upd ${fmtDate(p.updatedAt)}</span>
      </div>
      <div class="well"><pre>${markTokens(p.body)}</pre></div>
      <div class="card-foot">
        <button class="btn" data-copy="${p.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          <span>Copy</span>
        </button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-open="${p.id}">Open</button>
      </div>
    </article>`;
  }).join("");

  // Empty states are written for the situation, not one generic line.
  const isEmpty = list.length === 0;
  $("#empty").classList.toggle("on", isEmpty);
  if (isEmpty) {
    if (query.trim()) {
      $("#empty-title").textContent = "Nothing matches that";
      $("#empty-copy").textContent = `No prompt title contains “${query.trim()}”. Try a shorter word, or clear the search.`;
      $("#empty-cta").textContent = "Clear search";
      $("#empty-cta").dataset.act = "clear";
    } else {
      $("#empty-title").textContent = showing ? `No prompts in ${showing.name} yet` : "Your vault is empty";
      $("#empty-copy").textContent = "Add your first one and it will show up here.";
      $("#empty-cta").textContent = "Add your first prompt";
      $("#empty-cta").dataset.act = "new";
    }
  }
}

const render = () => { renderNav(); renderGrid(); };

/* ================================================================
   MODALS
   ================================================================ */
function open(sel) { $(sel).classList.add("on"); document.body.style.overflow = "hidden"; }
function closeAll() {
  $$(".scrim").forEach((s) => s.classList.remove("on"));
  document.body.style.overflow = "";
}

/**
 * One confirm dialog, reused. Resolves true/false.
 *
 * It closes ONLY itself, never every open sheet: it is often stacked on top
 * of another one (the import sheet asking to replace the library), and
 * cancelling has to leave that sheet exactly as the user left it. For the
 * same reason #k-no carries no data-close attribute — the document-level
 * handler for that runs after this promise resolves and would re-close
 * whatever was underneath.
 */
function confirmAction({ title, body, yes = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const sheet = $("#m-confirm");
    $("#k-title").textContent = title;
    $("#k-body").innerHTML = body;
    const btn = $("#k-yes");
    btn.textContent = yes;
    btn.className = danger ? "btn btn-danger" : "btn btn-primary";
    open("#m-confirm");

    const done = (v) => {
      cleanup();
      sheet.classList.remove("on");
      // Only release the page scroll if nothing else is still open.
      if (!$(".scrim.on")) document.body.style.overflow = "";
      resolve(v);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    const onBackdrop = (e) => { if (e.target === sheet) done(false); };

    function cleanup() {
      btn.removeEventListener("click", onYes);
      $("#k-no").removeEventListener("click", onNo);
      document.removeEventListener("keydown", onKey, true);
      sheet.removeEventListener("click", onBackdrop);
    }
    btn.addEventListener("click", onYes);
    $("#k-no").addEventListener("click", onNo);
    document.addEventListener("keydown", onKey, true);   // capture: beat the global Esc
    sheet.addEventListener("click", onBackdrop);
  });
}

function openView(id) {
  const p = prompts.find((x) => x.id === id);
  if (!p) return;
  openId = id;
  const c = catOf(p.categoryId);
  const n = tokensIn(p.body).length;
  $("#v-chip").style.setProperty("--hue", `var(${c.hue})`);
  $("#v-cat").textContent = c.name;
  $("#v-title").textContent = p.title;
  $("#v-body").innerHTML = markTokens(p.body);
  $("#v-meta").innerHTML =
    `${n ? `<span class="vars">${n} variable${n === 1 ? "" : "s"}</span>` : "<span>no variables</span>"}
     <span>${p.body.length} chars</span>
     <span>created ${fmtDate(p.createdAt)}</span>
     <span>updated ${fmtDate(p.updatedAt)}</span>`;
  $("#v-fill").style.display = n ? "" : "none";
  open("#m-view");
}

function openForm(id) {
  editId = id || null;
  const p = id ? prompts.find((x) => x.id === id) : null;
  clearErr("#f-err");
  $("#f-heading").textContent = p ? "Edit prompt" : "New prompt";
  $("#f-save").textContent = p ? "Save changes" : "Save prompt";

  const preselect = p ? p.categoryId : (activeCat !== "all" && activeCat !== "none" ? activeCat : cats[0]?.id);
  $("#f-cat").innerHTML =
    cats.map((c) => `<option value="${c.id}"${preselect === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("") +
    `<option value=""${!preselect ? " selected" : ""}>— No category —</option>`;

  $("#f-title").value = p ? p.title : "";
  $("#f-body").value = p ? p.body : "";
  formStat();
  open("#m-form");
  setTimeout(() => $("#f-title").focus(), 40);
}

function formStat() {
  const v = $("#f-body").value;
  const n = tokensIn(v).length;
  $("#f-stat").textContent = `${v.length} characters · ${n} variable${n === 1 ? "" : "s"}`;
}

function openCatEdit(id) {
  const c = cats.find((x) => x.id === id);
  if (!c) return;
  editCatId = id;
  editCatHue = c.hue;
  clearErr("#c-err");
  $("#c-name").value = c.name;
  $("#c-hues").innerHTML = hues.map((h) => `
    <button type="button" class="hue-opt" style="--hue:var(${h})" data-hue="${h}"
            aria-pressed="${h === c.hue}" aria-label="Colour ${h.replace("--h-", "")}"><i></i></button>`).join("");
  open("#m-cat");
  setTimeout(() => $("#c-name").focus(), 40);
}

function openFill(id) {
  const p = prompts.find((x) => x.id === id);
  if (!p) return;
  openId = id;
  $("#fill-rows").innerHTML = tokensIn(p.body).map((t) => `
    <div class="fill-row">
      <code title="${esc(t)}">${esc(t)}</code>
      <input data-tok="${esc(t)}" placeholder="${esc(t.slice(1, -1))}">
    </div>`).join("");
  open("#m-fill");
  setTimeout(() => $("#fill-rows input")?.focus(), 40);
}

/* ================================================================
   CLIPBOARD  ("Copied!" for 2 seconds, per spec)
   ================================================================ */
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back so the button never lies.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    if (!ok) return toast("Copy blocked by the browser — select the text manually", true);
  }
  toast("Copied");
  if (btn) {
    const label = btn.querySelector("span:last-child") || btn;
    const was = label.textContent;
    const key = btn.dataset.copy || "single";
    label.textContent = "Copied!";
    btn.classList.add("copied");
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => { label.textContent = was; btn.classList.remove("copied"); }, 2000);
  }
}

/* ================================================================
   COMMAND PALETTE  (⌘K)
   ================================================================ */
function palResults() {
  const q = $("#pal-input").value.trim().toLowerCase();
  const rows = [
    ...cats.map((c) => ({ kind: "cat", id: c.id, label: c.name, sub: "Category", hue: c.hue })),
    ...prompts.map((p) => {
      const c = catOf(p.categoryId);
      return { kind: "prompt", id: p.id, label: p.title, sub: c.name, hue: c.hue };
    }),
  ];
  return q ? rows.filter((r) => `${r.label} ${r.sub}`.toLowerCase().includes(q)) : rows;
}

function renderPal() {
  const rows = palResults();
  palIdx = Math.max(0, Math.min(palIdx, rows.length - 1));
  $("#pal-list").innerHTML = rows.length
    ? rows.map((r, i) => `
      <button class="pal-item" data-on="${i === palIdx ? 1 : 0}" data-kind="${r.kind}" data-pid="${r.id}">
        <span class="dot" style="--hue:var(${r.hue})"></span>
        <span class="t">${esc(r.label)}</span>
        <span class="count">${esc(r.sub)}</span>
      </button>`).join("")
    : `<div class="pal-empty">Nothing found</div>`;
  $("#pal-list [data-on='1']")?.scrollIntoView({ block: "nearest" });
}

function palGo() {
  const r = palResults()[palIdx];
  if (!r) return;
  closeAll();
  if (r.kind === "cat") { activeCat = r.id; query = ""; $("#search").value = ""; render(); }
  else openView(r.id);
}

/* ================================================================
   MUTATIONS
   ================================================================ */
async function savePrompt(e) {
  e.preventDefault();
  clearErr("#f-err");
  const title = $("#f-title").value.trim();
  const body = $("#f-body").value.trim();
  const categoryId = $("#f-cat").value || null;
  if (!title || !body) return showErr("#f-err", "A prompt needs both a title and some text.");

  await busy($("#f-save"), async () => {
    try {
      if (editId) {
        const updated = await api.patch(`/prompts/${editId}`, { title, body, categoryId });
        prompts = prompts.map((p) => (p.id === updated.id ? updated : p));
        toast("Changes saved");
      } else {
        const created = await api.post("/prompts", { title, body, categoryId });
        prompts.unshift(created);
        toast("Prompt added");
      }
      editId = null;
      closeAll();
      render();
      setOffline(false);
    } catch (err) {
      showErr("#f-err", err.message);
    }
  });
}

async function deletePrompt(id) {
  const p = prompts.find((x) => x.id === id);
  if (!p) return;
  const ok = await confirmAction({
    title: "Delete this prompt?",
    body: `“<b style="color:var(--text);font-weight:500">${esc(p.title)}</b>” will be removed from your library. This can’t be undone — export a backup first if you might want it back.`,
  });
  if (!ok) return;
  try {
    await api.del(`/prompts/${id}`);
    prompts = prompts.filter((x) => x.id !== id);
    render();
    toast("Prompt deleted");
    setOffline(false);
  } catch (err) { toast(err.message, true); }
}

async function addCategory(name) {
  name = name.trim();
  if (!name) return;
  try {
    const created = await api.post("/categories", { name });
    cats.push(created);
    activeCat = created.id;
    $("#catname").value = "";
    $("#catform").classList.remove("on");
    render();
    toast(`“${created.name}” added`);
    setOffline(false);
  } catch (err) { toast(err.message, true); }
}

async function saveCategory(e) {
  e.preventDefault();
  clearErr("#c-err");
  const name = $("#c-name").value.trim();
  if (!name) return showErr("#c-err", "A category needs a name.");
  try {
    const updated = await api.patch(`/categories/${editCatId}`, { name, hue: editCatHue });
    cats = cats.map((c) => (c.id === updated.id ? updated : c));
    closeAll();
    render();
    toast("Category updated");
  } catch (err) { showErr("#c-err", err.message); }
}

async function deleteCategory() {
  const c = cats.find((x) => x.id === editCatId);
  if (!c) return;
  const n = prompts.filter((p) => p.categoryId === c.id).length;
  closeAll();
  const ok = await confirmAction({
    title: `Delete “${c.name}”?`,
    body: n
      ? `The category goes away. Its <b style="color:var(--text)">${n} prompt${n === 1 ? "" : "s"}</b> stay in your library and move to <b style="color:var(--text)">Uncategorised</b>, so nothing is lost.`
      : "The category is empty, so nothing else changes.",
    yes: "Delete category",
  });
  if (!ok) return;
  try {
    await api.del(`/categories/${c.id}`);
    cats = cats.filter((x) => x.id !== c.id);
    prompts = prompts.map((p) => (p.categoryId === c.id ? { ...p, categoryId: null } : p));
    if (activeCat === c.id) activeCat = "all";
    render();
    toast(n ? `Deleted — ${n} prompt${n === 1 ? "" : "s"} moved to Uncategorised` : "Category deleted");
  } catch (err) { toast(err.message, true); }
}

/* ================================================================
   EXPORT / IMPORT
   ================================================================ */
async function exportBackup() {
  await busy($("#export-btn"), async () => {
    try {
      const data = await api.get("/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prompt-vault-${data.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${data.counts.prompts} prompts`);
      setOffline(false);
    } catch (err) { toast(err.message, true); }
  });
}

function openImport() {
  pendingImport = null;
  clearErr("#i-err");
  $("#drop-title").textContent = "Choose a backup file";
  $("#drop-sub").textContent = "or drop a .json export here";
  $("#i-stat").textContent = "";
  $("#i-go").disabled = true;
  $("#file-input").value = "";
  $$('input[name="mode"]')[0].checked = true;
  syncModes();
  open("#m-import");
}

const syncModes = () =>
  $$(".mode").forEach((m) => m.setAttribute("aria-pressed", String(m.querySelector("input").checked)));

async function readBackupFile(file) {
  clearErr("#i-err");
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) return showErr("#i-err", "That file is over 12 MB — larger than this app accepts.");
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== "prompt-vault") throw new Error("That is not a Prompt Vault backup file.");
    if (!Array.isArray(payload.categories) || !Array.isArray(payload.prompts)) {
      throw new Error("The backup is missing its categories or prompts list.");
    }
    pendingImport = { payload, filename: file.name };
    $("#drop-title").textContent = file.name;
    $("#drop-sub").textContent = `${payload.prompts.length} prompts · ${payload.categories.length} categories`;
    $("#i-stat").textContent = payload.exportedAt ? `Exported ${fmtDate(payload.exportedAt)}` : "";
    $("#i-go").disabled = false;
  } catch (err) {
    pendingImport = null;
    $("#i-go").disabled = true;
    showErr("#i-err", err instanceof SyntaxError ? "That file isn’t valid JSON." : err.message);
  }
}

async function runImport() {
  if (!pendingImport) return;
  const mode = $$('input[name="mode"]').find((r) => r.checked).value;

  if (mode === "replace") {
    const ok = await confirmAction({
      title: "Replace your whole library?",
      body: `All <b style="color:var(--text)">${prompts.length} prompt${prompts.length === 1 ? "" : "s"}</b> and <b style="color:var(--text)">${cats.length} categor${cats.length === 1 ? "y" : "ies"}</b> currently stored will be deleted, then replaced with the contents of <b style="color:var(--text)">${esc(pendingImport.filename)}</b>. This can’t be undone.`,
      yes: "Replace everything",
    });
    if (!ok) return;   // the import sheet is still open underneath
  }

  await busy($("#i-go"), async () => {
    try {
      const r = await api.post("/import", { payload: pendingImport.payload, mode });
      cats = r.state.categories;
      prompts = r.state.prompts;
      activeCat = "all";
      query = "";
      $("#search").value = "";
      closeAll();
      render();
      const bits = [];
      if (r.prompts.added) bits.push(`${r.prompts.added} added`);
      if (r.prompts.updated) bits.push(`${r.prompts.updated} updated`);
      if (r.prompts.skipped) bits.push(`${r.prompts.skipped} already current`);
      toast(bits.length ? `Imported — ${bits.join(", ")}` : "Nothing to import, your library is already up to date");
      setOffline(false);
    } catch (err) {
      open("#m-import");
      showErr("#i-err", err.message);
    }
  });
}

/* ================================================================
   EVENTS
   ================================================================ */
document.addEventListener("click", (e) => {
  const t = e.target;

  if (t.closest("[data-close]")) return closeAll();
  const scrim = t.closest(".scrim");
  if (scrim && t === scrim) return closeAll();          // click the backdrop

  const editCat = t.closest("[data-editcat]");
  if (editCat) { e.stopPropagation(); return openCatEdit(editCat.dataset.editcat); }

  const nav = t.closest("[data-cat]");
  if (nav) {
    activeCat = nav.dataset.cat;
    render();
    $("#rail").classList.remove("on");
    $("#rail-scrim").classList.remove("on");
    return;
  }

  const ghost = t.closest("[data-ghost]");
  if (ghost) return addCategory(ghost.dataset.ghost);

  const hue = t.closest("[data-hue]");
  if (hue) {
    editCatHue = hue.dataset.hue;
    $$("#c-hues .hue-opt").forEach((b) => b.setAttribute("aria-pressed", String(b === hue)));
    return;
  }

  const openBtn = t.closest("[data-open]"); if (openBtn) return openView(openBtn.dataset.open);
  const editBtn = t.closest("[data-edit]"); if (editBtn) return openForm(editBtn.dataset.edit);
  const delBtn  = t.closest("[data-del]");  if (delBtn)  return deletePrompt(delBtn.dataset.del);

  const copyBtn = t.closest("[data-copy]");
  if (copyBtn) {
    const p = prompts.find((x) => x.id === copyBtn.dataset.copy);
    if (p) copyText(p.body, copyBtn);
    return;
  }

  const palItem = t.closest(".pal-item");
  if (palItem) { palIdx = $$(".pal-item").indexOf(palItem); return palGo(); }
});

$("#new-btn").onclick = () => openForm(null);
$("#empty-cta").onclick = () => {
  if ($("#empty-cta").dataset.act === "clear") { query = ""; $("#search").value = ""; render(); }
  else openForm(null);
};

$("#search").addEventListener("input", (e) => { query = e.target.value; renderGrid(); });

$("#v-edit").onclick = () => { closeAll(); openForm(openId); };
$("#v-del").onclick  = () => { const id = openId; closeAll(); deletePrompt(id); };
$("#v-copy").onclick = () => { const p = prompts.find((x) => x.id === openId); if (p) copyText(p.body, $("#v-copy")); };
$("#v-fill").onclick = () => { const id = openId; closeAll(); openFill(id); };

$("#fill-copy").onclick = () => {
  const p = prompts.find((x) => x.id === openId);
  if (!p) return;
  let out = p.body;
  $$("#fill-rows input").forEach((inp) => {
    const val = inp.value.trim();
    if (val) out = out.split(inp.dataset.tok).join(val);   // blank keeps its bracket
  });
  copyText(out, $("#fill-copy"));
  closeAll();
};

$("#promptform").addEventListener("submit", savePrompt);
$("#catedit").addEventListener("submit", saveCategory);
$("#c-del").onclick = deleteCategory;
$("#f-body").addEventListener("input", formStat);

$("#addcat-btn").onclick = () => {
  $("#catform").classList.toggle("on");
  if ($("#catform").classList.contains("on")) $("#catname").focus();
};
$("#catform").addEventListener("submit", (e) => { e.preventDefault(); addCategory($("#catname").value); });

$("#export-btn").onclick = exportBackup;
$("#import-btn").onclick = openImport;
$("#i-go").onclick = runImport;
$("#dropzone").onclick = () => $("#file-input").click();
$("#dropzone").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file-input").click(); } };
$("#file-input").onchange = (e) => readBackupFile(e.target.files[0]);
$$('input[name="mode"]').forEach((r) => r.addEventListener("change", syncModes));

["dragenter", "dragover"].forEach((ev) =>
  $("#dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("#dropzone").classList.add("hot"); }));
["dragleave", "drop"].forEach((ev) =>
  $("#dropzone").addEventListener(ev, (e) => { e.preventDefault(); $("#dropzone").classList.remove("hot"); }));
$("#dropzone").addEventListener("drop", (e) => readBackupFile(e.dataTransfer.files[0]));

$("#retry-btn").onclick = () => boot();

/* --- theme: dark is the default, the choice persists per browser --- */
(function theme() {
  const SUN = '<path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18"/><circle cx="12" cy="12" r="4"/>';
  const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';
  let saved = null;
  try { saved = localStorage.getItem("pv-theme"); } catch { /* private mode throws */ }
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");

  const paint = () => {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    $("#theme-icon").innerHTML = light ? SUN : MOON;
    $("#theme-btn").title = light ? "Switch to dark" : "Switch to light";
  };
  paint();
  $("#theme-btn").onclick = () => {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    if (light) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "light");
    try { localStorage.setItem("pv-theme", light ? "dark" : "light"); } catch { /* ignore */ }
    paint();
  };
})();

/* --- mobile drawer --- */
$("#menu-btn").onclick   = () => { $("#rail").classList.add("on"); $("#rail-scrim").classList.add("on"); };
$("#rail-scrim").onclick = () => { $("#rail").classList.remove("on"); $("#rail-scrim").classList.remove("on"); };

/* --- keyboard --- */
$("#pal-input").addEventListener("input", () => { palIdx = 0; renderPal(); });

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const palOpen = $("#m-pal").classList.contains("on");

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    closeAll();
    $("#pal-input").value = "";
    palIdx = 0;
    renderPal();
    open("#m-pal");
    setTimeout(() => $("#pal-input").focus(), 40);
    return;
  }
  if (palOpen) {
    if (e.key === "ArrowDown") { e.preventDefault(); palIdx++; renderPal(); }
    if (e.key === "ArrowUp")   { e.preventDefault(); palIdx--; renderPal(); }
    if (e.key === "Enter")     { e.preventDefault(); palGo(); }
  }
  if (e.key === "Escape") closeAll();

  // Cmd/Ctrl+Enter saves the prompt form without reaching for the mouse.
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && $("#m-form").classList.contains("on")) {
    e.preventDefault();
    $("#promptform").requestSubmit();
    return;
  }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
  if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openForm(null); }
});

/* ================================================================
   BOOT
   ================================================================ */
async function boot() {
  $("#boot").style.display = "";
  setOffline(false);
  try {
    const state = await api.get("/state");
    cats = state.categories;
    prompts = state.prompts;
    if (Array.isArray(state.hues) && state.hues.length) hues = state.hues;
    $("#boot").style.display = "none";
    render();
  } catch (err) {
    $("#boot").style.display = "none";
    $("#head").hidden = true;
    setOffline(true, `${err.message} Start it with npm start, then hit Retry.`);
  }
}

boot();
