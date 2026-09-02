# Prompt Vault — standalone

One HTML file. No server, no build, no install. Double-click it, or host it
anywhere that serves static files.

This is the version published as a shareable Artifact:
https://claude.ai/code/artifact/937202eb-489f-4d84-a369-3eb0c5e7b801

## How it differs from the server version

|  | `standalone/` | root (`server/` + `public/`) |
| --- | --- | --- |
| Storage | This browser, via localStorage | SQLite on your machine |
| Users | Sign in with any name; each name is its own vault | Single user |
| Sync across devices | No — export/import moves it | No, but the database is one file you can sync |
| Setup | None | `npm install && npm start` |

## The login is not security

There is no password and no server. A name is a drawer in this browser, not an
account: anyone using the same browser can open any name they can see, and the
sign-in screen says so. Everything stays on the device — nothing is uploaded.
Don't keep anything private in it.

## Storage limits

localStorage caps around 5 MB per site, shared by every vault in the browser.
That is thousands of prompts, but a write that overflows it is caught and
reported rather than silently dropped — export a backup and prune if you hit it.

## Export and import

`Export` shows your whole vault as JSON to copy somewhere safe. `Import` takes
it back — paste it into the import sheet or drop the file in. Two modes:

- **Merge** — adds what is missing, updates anything the file has a newer copy
  of, reuses a category that already exists by name. Nothing is deleted.
- **Replace** — wipes this vault and restores the file. Confirmation names the
  vault it will destroy.

Merge resolves conflicts by `updatedAt`, so a stale backup can never overwrite
newer work. Backups are interchangeable with the server version's.
