/**
 * reset.js — delete the database file and start over. `npm run reset`.
 * Exports a backup first, because destroying someone's library without a
 * copy is not a thing this app does.
 */

const fs = require("node:fs");
const path = require("node:path");

const { store, db, DB_PATH } = require("./db");

const snapshot = store.exportAll();
if (snapshot.counts.prompts > 0 || snapshot.counts.categories > 0) {
  const out = path.join(path.dirname(DB_PATH), `backup-before-reset-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log(`Backed up ${snapshot.counts.prompts} prompts to ${out}`);
}

db.close();
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const f = DB_PATH + suffix;
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`Removed ${path.basename(f)}`); }
}
console.log("Database reset. Next start will reseed.");
