/**
 * index.js — the server.
 *
 * Binds to 127.0.0.1 on purpose. This app has no login, by design, so it
 * must not listen on every interface: on a shared network that would hand
 * your whole prompt library to anyone who guessed the port. Set HOST to
 * override if you know what you are doing.
 */

const path = require("node:path");
const express = require("express");
const api = require("./api");
const { store, DB_PATH } = require("./db");
const { seedIfEmpty } = require("./seed");

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "127.0.0.1";

const app = express();
app.disable("x-powered-by");

// 12 MB covers a very large library import; anything bigger is a mistake.
app.use(express.json({ limit: "12mb" }));

app.use("/api", api);

app.get("/api/health", (req, res) => res.json({ ok: true, db: DB_PATH }));

app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

// Unknown /api routes get JSON, not the HTML index.
app.use("/api", (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

/* Error handler — one place, one shape. The `error` string is shown to the user. */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) console.error("[prompt-vault]", err);
  res.status(status).json({ error: err.message || "Something went wrong." });
});

const seed = seedIfEmpty(store);

app.listen(PORT, HOST, () => {
  const { categories, prompts } = store.snapshot();
  console.log(`\n  Prompt Vault  →  http://${HOST}:${PORT}`);
  console.log(`  database      →  ${DB_PATH}`);
  console.log(`  library       →  ${prompts.length} prompts in ${categories.length} categories`);
  if (seed.seeded) console.log(`  seeded        →  ${seed.prompts} example prompts (delete them any time)`);
  console.log("");
});
