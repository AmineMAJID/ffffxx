# FXAP Studio

A complete Node.js + HTML/CSS/JavaScript workspace for decoding FiveM-compatible FXAP containers, extracting decoded ZIP data in memory, removing files, and downloading a fresh archive.

## What it does

- Accepts one `.fxap` or `.zip` upload through a drag-and-drop web interface.
- Detects ZIP data directly or decodes the FXAP outer container using its ChaCha20 layout.
- Optionally decodes a second FXAP content layer with an **owner-supplied 32-byte content key**.
- Extracts ZIP entries in memory and displays their names, types, sizes, and modification dates.
- Removes one file, a selected group, or the entire archive; a reset action restores the original extracted entries.
- Builds and downloads a new ZIP without modifying the source upload.
- Downloads the exact decoded bytes when the result is not a ZIP.
- Reports upload, validation, decoding, extraction, expiration, and network errors clearly.

### Important FXAP format note

A FiveM `.fxap` descriptor is **not necessarily a ZIP archive**. It commonly contains protected binary metadata. FXAP Studio therefore has two honest outcomes:

1. **ZIP signature found:** decode and open the editable archive workspace.
2. **No ZIP signature:** report a decoded binary payload and provide a binary download; do not invent entries or claim extraction succeeded.

The optional content key is a 64-hex-character asset key, **not** a `cfxk_...` server license key. This project does not request Keymaster grants, bypass asset entitlements, derive protected keys, or decompile Lua bytecode. Use it only for resources you own or have permission to modify.

## Quick start

Requirements: **Node.js 20 or newer** (Node.js 22 recommended).

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

For development with automatic Node.js restarts:

```bash
npm run dev
```

To use another interface or port:

```bash
HOST=0.0.0.0 PORT=8080 npm start
```

There is no frontend build step. The Node.js server serves `public/` directly and binds to `0.0.0.0` by default.

## Using the workspace

1. Drop a `.fxap` or `.zip` file into the upload area, or browse for it.
2. If the asset has a second encrypted layer and you are authorized to decode it, expand **Advanced decoding options** and enter its 32-byte content key as 64 hex characters.
3. Select **Decode & inspect**. The progress bar shows real upload progress, then an indeterminate server-processing state.
4. For an archive, search or sort the extracted files. Use row checkboxes, the page checkbox, or a row's trash button to remove entries.
5. Use **Clear archive** for an empty output ZIP, or **Reset** to restore all initially extracted entries.
6. Select **Download processed ZIP**. For a non-ZIP result, select **Download decoded data** instead.
7. Select **New upload** to explicitly wipe the current session. Otherwise it expires automatically after 30 minutes.

## API

All API responses except downloads are JSON. Errors use this shape:

```json
{
  "error": {
    "code": "INVALID_FILE_SIGNATURE",
    "message": "A useful explanation of the problem."
  }
}
```

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Server readiness and upload limit |
| `POST` | `/api/jobs` | Multipart upload (`file`) and optional `contentKey`; decode and extract |
| `GET` | `/api/jobs/:id` | Read current job metadata, entries, and statistics |
| `DELETE` | `/api/jobs/:id/entries` | Remove files using JSON body `{ "ids": ["entry-id"] }` |
| `POST` | `/api/jobs/:id/clear` | Mark every file and directory as removed |
| `POST` | `/api/jobs/:id/reset` | Restore every initially extracted entry |
| `GET` | `/api/jobs/:id/download` | Download the processed ZIP or decoded binary |
| `DELETE` | `/api/jobs/:id` | Explicitly wipe a session; idempotent, returns `204` |

Example upload:

```bash
curl -sS -F "file=@resource.fxap" http://localhost:3000/api/jobs
```

With an authorized content key held in an environment variable:

```bash
curl -sS \
  -F "file=@resource.fxap" \
  -F "contentKey=$FXAP_CONTENT_KEY" \
  http://localhost:3000/api/jobs
```

Entry IDs are opaque and session-specific; use the IDs returned by the upload or job-inspection response rather than archive paths.

## Safety and resource limits

- Uploads and extracted entries remain in memory; untrusted paths are never passed to filesystem extraction functions.
- ZIP paths are normalized and checked for absolute paths, `..`, `.`, empty segments, control characters, duplicates, symlinks, and password protection.
- Maximum compressed upload: **25 MiB**.
- Maximum extracted size: **100 MiB total**, **50 MiB per file**.
- Maximum entries: **2,000 per archive**.
- Sessions expire after **30 minutes** and are wiped during deletion/eviction.
- The in-memory store is bounded by job count and total retained bytes.
- Helmet supplies a restrictive Content Security Policy and other HTTP security headers.

This is a single-process, single-user-oriented tool. Add authentication, rate limiting, TLS, reverse-proxy body limits, and a distributed/session-aware job design before exposing it as a multi-tenant public service.

## Tests

```bash
npm test
npm audit
```

The test suite uses Node's built-in test runner and covers:

- The FXAP ChaCha20 counter/nonce reference vector.
- Plain ZIP pass-through and outer/inner FXAP decoding.
- Non-ZIP binary fallback and malformed input errors.
- Safe archive extraction, path rejection, rebuilding, and empty ZIP output.
- The complete HTTP workflow: upload, inspect, remove, download, reset, clear, and delete.

## Project structure

```text
public/
  index.html        Accessible upload, processing, editor, and guide UI
  styles.css        Responsive visual design
  app.js            Browser state, real upload progress, API integration
  favicon.svg
src/
  app.js            Express routes, validation, responses, error middleware
  archive.js        Safe in-memory ZIP extraction and rebuilding (adm-zip)
  config.js         Upload, extraction, and session limits
  errors.js         Expected API error type
  fxap.js           FXAP signatures and ChaCha20 container decoding
  job-store.js      Bounded, expiring, memory-only sessions
  server.js         HTTP server and graceful shutdown
tests/
  helpers.js        Deterministic ZIP/FXAP fixture builders
  fxap.test.js
  archive.test.js
  api.test.js
```

FXAP Studio is an independent utility and is not affiliated with or endorsed by Cfx.re, FiveM, or Rockstar Games.
