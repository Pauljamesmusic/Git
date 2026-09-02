/**
 * db.js — SQLite schema, seed data, and every query the app makes.
 *
 * Design notes
 * ------------
 * - Categories are DATA, not constants. Four are seeded; you add more at
 *   runtime (Job Search, Tracker Prompts, whatever comes next) with no
 *   schema change.
 * - Deleting a category never deletes prompts. The foreign key is
 *   ON DELETE SET NULL, so orphaned prompts surface as "Uncategorised"
 *   instead of vanishing.
 * - Timestamps are ISO-8601 UTC strings: sortable as text, portable
 *   across an export/import round trip, no timezone surprises.
 * - Every write goes through a prepared statement. No string-built SQL.
 */

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "vault.db");

/** Hue tokens the UI knows how to render. New categories cycle through these. */
const HUES = ["--h-violet", "--h-cyan", "--h-pink", "--h-amber", "--h-lime", "--h-rose"];

const nowIso = () => new Date().toISOString();
/** Short, sortable, collision-resistant enough for a single-user library. */
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");   // survives an ungraceful shutdown
db.pragma("foreign_keys = ON");    // off by default in SQLite; we rely on it

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */
function migrate() {
  const version = db.pragma("user_version", { simple: true });

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        hue        TEXT NOT NULL,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      -- Case-insensitive uniqueness: "Job Search" and "job search" are one category.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name
        ON categories (name COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS prompts (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts (category_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_updated  ON prompts (updated_at DESC);
    `);
    db.pragma("user_version = 1");
  }
  // Future migrations: `if (version < 2) { ...; db.pragma("user_version = 2") }`
}
migrate();

/* ------------------------------------------------------------------ *
 * Row <-> API shape
 * ------------------------------------------------------------------ */
const toCategory = (r) => r && {
  id: r.id, name: r.name, hue: r.hue, position: r.position, createdAt: r.created_at,
};
const toPrompt = (r) => r && {
  id: r.id, title: r.title, body: r.body, categoryId: r.category_id,
  createdAt: r.created_at, updatedAt: r.updated_at,
};

/* ------------------------------------------------------------------ *
 * Statements (prepared once, reused)
 * ------------------------------------------------------------------ */
const S = {
  allCategories: db.prepare("SELECT * FROM categories ORDER BY position ASC, name COLLATE NOCASE ASC"),
  getCategory:   db.prepare("SELECT * FROM categories WHERE id = ?"),
  findCatByName: db.prepare("SELECT * FROM categories WHERE name = ? COLLATE NOCASE"),
  maxPosition:   db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM categories"),
  insertCat:     db.prepare(`INSERT INTO categories (id, name, hue, position, created_at)
                             VALUES (@id, @name, @hue, @position, @created_at)`),
  updateCat:     db.prepare("UPDATE categories SET name = @name, hue = @hue WHERE id = @id"),
  deleteCat:     db.prepare("DELETE FROM categories WHERE id = ?"),
  countCats:     db.prepare("SELECT COUNT(*) AS n FROM categories"),

  allPrompts:    db.prepare("SELECT * FROM prompts ORDER BY updated_at DESC"),
  getPrompt:     db.prepare("SELECT * FROM prompts WHERE id = ?"),
  insertPrompt:  db.prepare(`INSERT INTO prompts (id, title, body, category_id, created_at, updated_at)
                             VALUES (@id, @title, @body, @category_id, @created_at, @updated_at)`),
  updatePrompt:  db.prepare(`UPDATE prompts SET title = @title, body = @body,
                             category_id = @category_id, updated_at = @updated_at WHERE id = @id`),
  deletePrompt:  db.prepare("DELETE FROM prompts WHERE id = ?"),
  countInCat:    db.prepare("SELECT COUNT(*) AS n FROM prompts WHERE category_id = ?"),

  wipeCats:      db.prepare("DELETE FROM categories"),
  wipePrompts:   db.prepare("DELETE FROM prompts"),
};

/* ------------------------------------------------------------------ *
 * Public store API
 * ------------------------------------------------------------------ */
const store = {
  HUES,
  newId,
  nowIso,

  /** One call on boot: the whole library. It is a personal library, not a feed. */
  snapshot() {
    return {
      categories: S.allCategories.all().map(toCategory),
      prompts: S.allPrompts.all().map(toPrompt),
    };
  },

  listCategories: () => S.allCategories.all().map(toCategory),
  getCategory: (id) => toCategory(S.getCategory.get(id)),
  findCategoryByName: (name) => toCategory(S.findCatByName.get(name)),
  countPromptsIn: (id) => S.countInCat.get(id).n,

  createCategory({ name, hue }) {
    const existing = S.findCatByName.get(name);
    if (existing) { const e = new Error(`A category called "${existing.name}" already exists.`); e.status = 409; throw e; }
    const position = S.maxPosition.get().m + 1;
    const row = {
      id: newId("cat"),
      name,
      hue: hue && HUES.includes(hue) ? hue : HUES[S.countCats.get().n % HUES.length],
      position,
      created_at: nowIso(),
    };
    S.insertCat.run(row);
    return toCategory(S.getCategory.get(row.id));
  },

  updateCategory(id, { name, hue }) {
    const cur = S.getCategory.get(id);
    if (!cur) { const e = new Error("Category not found."); e.status = 404; throw e; }
    if (name && name.toLowerCase() !== cur.name.toLowerCase()) {
      const clash = S.findCatByName.get(name);
      if (clash) { const e = new Error(`A category called "${clash.name}" already exists.`); e.status = 409; throw e; }
    }
    S.updateCat.run({ id, name: name ?? cur.name, hue: hue && HUES.includes(hue) ? hue : cur.hue });
    return toCategory(S.getCategory.get(id));
  },

  /** Prompts survive: the FK sets category_id to NULL, so they become Uncategorised. */
  deleteCategory(id) {
    const cur = S.getCategory.get(id);
    if (!cur) { const e = new Error("Category not found."); e.status = 404; throw e; }
    const orphaned = S.countInCat.get(id).n;
    S.deleteCat.run(id);
    return { deleted: toCategory(cur), orphaned };
  },

  listPrompts: () => S.allPrompts.all().map(toPrompt),
  getPrompt: (id) => toPrompt(S.getPrompt.get(id)),

  createPrompt({ title, body, categoryId }) {
    if (categoryId && !S.getCategory.get(categoryId)) {
      const e = new Error("That category does not exist."); e.status = 400; throw e;
    }
    const ts = nowIso();
    const row = {
      id: newId("pr"), title, body,
      category_id: categoryId || null,
      created_at: ts, updated_at: ts,
    };
    S.insertPrompt.run(row);
    return toPrompt(S.getPrompt.get(row.id));
  },

  updatePrompt(id, { title, body, categoryId }) {
    const cur = S.getPrompt.get(id);
    if (!cur) { const e = new Error("Prompt not found."); e.status = 404; throw e; }
    const nextCat = categoryId === undefined ? cur.category_id : (categoryId || null);
    if (nextCat && !S.getCategory.get(nextCat)) {
      const e = new Error("That category does not exist."); e.status = 400; throw e;
    }
    S.updatePrompt.run({
      id,
      title: title ?? cur.title,
      body: body ?? cur.body,
      category_id: nextCat,
      updated_at: nowIso(),
    });
    return toPrompt(S.getPrompt.get(id));
  },

  deletePrompt(id) {
    const cur = S.getPrompt.get(id);
    if (!cur) { const e = new Error("Prompt not found."); e.status = 404; throw e; }
    S.deletePrompt.run(id);
    return toPrompt(cur);
  },

  /* ---------------- export / import ---------------- */

  exportAll() {
    const { categories, prompts } = store.snapshot();
    return {
      format: "prompt-vault",
      version: 1,
      exportedAt: nowIso(),
      counts: { categories: categories.length, prompts: prompts.length },
      categories,
      prompts,
    };
  },

  /**
   * Restore a backup.
   *  mode "replace" — wipe the library, then insert the file verbatim.
   *  mode "merge"   — keep what is here; add what is missing. A category
   *                   whose NAME already exists is reused rather than
   *                   duplicated, and its incoming prompts are remapped
   *                   onto the category you already had.
   * Runs in a single transaction: a bad file changes nothing.
   */
  importAll(payload, mode = "merge") {
    const run = db.transaction(() => {
      const result = { mode, categories: { added: 0, reused: 0 }, prompts: { added: 0, updated: 0, skipped: 0 } };

      if (mode === "replace") {
        S.wipePrompts.run();
        S.wipeCats.run();
      }

      // Maps an id from the FILE to the id that ends up in THIS database.
      const catIdMap = new Map();

      for (const c of payload.categories) {
        const byId = S.getCategory.get(c.id);
        if (byId) { catIdMap.set(c.id, byId.id); result.categories.reused++; continue; }

        const byName = S.findCatByName.get(c.name);
        if (byName) { catIdMap.set(c.id, byName.id); result.categories.reused++; continue; }

        const row = {
          id: c.id,
          name: c.name,
          hue: HUES.includes(c.hue) ? c.hue : HUES[S.countCats.get().n % HUES.length],
          position: Number.isInteger(c.position) ? c.position : S.maxPosition.get().m + 1,
          created_at: c.createdAt || nowIso(),
        };
        S.insertCat.run(row);
        catIdMap.set(c.id, row.id);
        result.categories.added++;
      }

      for (const p of payload.prompts) {
        const mappedCat = p.categoryId ? (catIdMap.get(p.categoryId) || null) : null;
        const catExists = mappedCat && S.getCategory.get(mappedCat) ? mappedCat : null;
        const existing = S.getPrompt.get(p.id);

        if (existing) {
          // Last edit wins. An older copy in the file never clobbers newer work.
          if (mode === "merge" && existing.updated_at >= (p.updatedAt || "")) { result.prompts.skipped++; continue; }
          S.updatePrompt.run({
            id: p.id, title: p.title, body: p.body,
            category_id: catExists, updated_at: p.updatedAt || nowIso(),
          });
          result.prompts.updated++;
        } else {
          S.insertPrompt.run({
            id: p.id || newId("pr"),
            title: p.title,
            body: p.body,
            category_id: catExists,
            created_at: p.createdAt || nowIso(),
            updated_at: p.updatedAt || nowIso(),
          });
          result.prompts.added++;
        }
      }
      return result;
    });
    return run();
  },

  isEmpty: () => S.countCats.get().n === 0 && S.allPrompts.all().length === 0,
};

module.exports = { db, store, DB_PATH, HUES };
