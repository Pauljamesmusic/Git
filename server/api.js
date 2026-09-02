/**
 * api.js — the JSON API.
 *
 * Shape is deliberately small. The whole library is fetched once on boot
 * (GET /api/state) because a personal prompt library is tens of rows, not
 * thousands; searching and filtering happen instantly in the browser and
 * only mutations come back to the server.
 *
 * Every handler validates its input. Errors carry a `status` and a message
 * written for a human, because that message is what the UI shows.
 */

const express = require("express");
const { store, HUES } = require("./db");

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Validation helpers
 * ------------------------------------------------------------------ */
const LIMITS = { title: 200, body: 100_000, categoryName: 40 };

function bad(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Trims, rejects empties, enforces a length ceiling. Returns the clean value. */
function text(value, field, max, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw bad(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw bad(`${field} must be text.`);
  const v = value.trim();
  if (required && !v) throw bad(`${field} cannot be empty.`);
  if (v.length > max) throw bad(`${field} is too long — ${v.length} characters, limit is ${max}.`);
  return v;
}

/** Wraps an async/sync handler so a thrown error reaches the error middleware. */
const handle = (fn) => (req, res, next) => {
  try { fn(req, res, next); } catch (err) { next(err); }
};

/* ------------------------------------------------------------------ *
 * State — one call, the whole library
 * ------------------------------------------------------------------ */
router.get("/state", handle((req, res) => {
  res.json({ ...store.snapshot(), hues: HUES });
}));

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */
router.get("/categories", handle((req, res) => {
  res.json(store.listCategories());
}));

router.post("/categories", handle((req, res) => {
  const name = text(req.body.name, "Category name", LIMITS.categoryName);
  res.status(201).json(store.createCategory({ name, hue: req.body.hue }));
}));

router.patch("/categories/:id", handle((req, res) => {
  const name = text(req.body.name, "Category name", LIMITS.categoryName, { required: false });
  res.json(store.updateCategory(req.params.id, { name, hue: req.body.hue }));
}));

router.delete("/categories/:id", handle((req, res) => {
  // Prompts are never deleted with the category — they become uncategorised.
  res.json(store.deleteCategory(req.params.id));
}));

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */
router.get("/prompts", handle((req, res) => {
  res.json(store.listPrompts());
}));

router.get("/prompts/:id", handle((req, res) => {
  const p = store.getPrompt(req.params.id);
  if (!p) throw bad("Prompt not found.", 404);
  res.json(p);
}));

router.post("/prompts", handle((req, res) => {
  const title = text(req.body.title, "Title", LIMITS.title);
  const body = text(req.body.body, "Prompt text", LIMITS.body);
  res.status(201).json(store.createPrompt({ title, body, categoryId: req.body.categoryId || null }));
}));

router.patch("/prompts/:id", handle((req, res) => {
  const title = text(req.body.title, "Title", LIMITS.title, { required: false });
  const body = text(req.body.body, "Prompt text", LIMITS.body, { required: false });
  res.json(store.updatePrompt(req.params.id, {
    title, body,
    categoryId: "categoryId" in req.body ? req.body.categoryId : undefined,
  }));
}));

router.delete("/prompts/:id", handle((req, res) => {
  res.json(store.deletePrompt(req.params.id));
}));

/* ------------------------------------------------------------------ *
 * Export / import
 * ------------------------------------------------------------------ */
router.get("/export", handle((req, res) => {
  const data = store.exportAll();
  const stamp = data.exportedAt.slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="prompt-vault-${stamp}.json"`);
  res.send(JSON.stringify(data, null, 2));
}));

router.post("/import", handle((req, res) => {
  const { payload, mode = "merge" } = req.body || {};

  if (!payload || typeof payload !== "object") throw bad("That file did not contain any data.");
  if (payload.format !== "prompt-vault") throw bad("That is not a Prompt Vault backup file.");
  if (!Array.isArray(payload.categories) || !Array.isArray(payload.prompts)) {
    throw bad("The backup is missing its categories or prompts list.");
  }
  if (!["merge", "replace"].includes(mode)) throw bad(`Unknown import mode "${mode}".`);

  // Validate every row before touching the database — the import runs in a
  // transaction, but a clear error beats a rolled-back mystery.
  payload.categories.forEach((c, i) => {
    if (!c || typeof c.id !== "string" || !c.id) throw bad(`Category ${i + 1} in the file has no id.`);
    text(c.name, `Category ${i + 1} name`, LIMITS.categoryName);
  });
  payload.prompts.forEach((p, i) => {
    if (!p || typeof p.id !== "string" || !p.id) throw bad(`Prompt ${i + 1} in the file has no id.`);
    text(p.title, `Prompt ${i + 1} title`, LIMITS.title);
    text(p.body, `Prompt ${i + 1} text`, LIMITS.body);
  });

  const result = store.importAll(payload, mode);
  res.json({ ...result, state: store.snapshot() });
}));

module.exports = router;
