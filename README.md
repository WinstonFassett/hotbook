# APITable extensibility — scratch repo

A sandbox for exploring how to extend APITable with custom widgets, both against a local self-hosted stack and against the hosted aitable.ai service. Started 2026-05-05.

## Layout

```
.
├── apitable/             # upstream APITable source, cloned for reference + local stack
├── hello-world-widget/   # minimal widget — shows current view config + records
├── alloc-viz-widget/     # real widget — pie/bands/treemap allocation visualizer (D3)
├── test-harness/         # standalone React+Vite app for iterating on widgets WITHOUT APITable
├── tickets/              # tix-managed tickets (working notes, recipes, decisions)
└── .tix/                 # tix database
```

## How the pieces fit

```
┌──────────────────────────────────────────────────────────────────────┐
│  APITable host (local docker-compose OR aitable.ai cloud)            │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Space (spc...)                                              │    │
│  │   └── Datasheet                                              │    │
│  │        └── View                                              │    │
│  │             └── Widget panel                                 │    │
│  │                  └── Widget instance ← loads bundle from →   │    │
│  └──────────────────────────────┬───────────────────────────────┘    │
│                                 │                                    │
│  Widget package registry (wpk...)                                    │
│   ├── icon / cover / authorIcon                                      │
│   ├── metadata (name, description, author, ...)                      │
│   └── released bundle (widget_bundle.min.js, versioned)              │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │ widget-cli release --uploadHost
                                  │
┌─────────────────────────────────┴────────────────────────────────────┐
│  Widget project (e.g. alloc-viz-widget/)                             │
│   ├── widget.config.json   ← packageId, spaceId, metadata, assets    │
│   ├── src/index.tsx        ← initializeWidget(...) entry point       │
│   ├── icon.png / cover.png / author-icon.png                         │
│   └── package.json         ← uses @apitable/widget-cli + widget-sdk  │
└──────────────────────────────────────────────────────────────────────┘
```

A widget is just a React 17 bundle that calls `initializeWidget(Component)` from `@apitable/widget-sdk`. The SDK gives it hooks to read records, fields, view config, and per-widget cloud storage. The bundle is uploaded to a widget package (`wpk...`) registered against a space (`spc...`). Once released, the package can be installed into any view's widget panel within that space.

## Local development without APITable — the fast loop

`test-harness/` is a Vite+React 18 app that hosts widget components against a mocked SDK. Use this for the inner dev loop — no docker, no widget-cli, no upload step.

```sh
cd test-harness
npm install
npm run dev   # opens http://localhost:5299
```

The harness imports widget components directly from `../alloc-viz-widget/src` (or `../hello-world-widget/src`) and supplies fake records via [test-harness/src/mocks/](test-harness/src/mocks/). Edit widget code, see changes in the browser via HMR.

This is the right environment for almost all widget work. The release flow is only needed when you want to run inside a real APITable space (e.g. final smoke test before sharing).

## Local development against APITable — the full loop

Bring up the local APITable stack via the cloned upstream:

```sh
cd apitable
docker compose -f docker-compose.yaml up -d
# wait for http://localhost:8080 to come up; create an account, create a space
```

Then run a widget against it via `widget-cli start` (HMR'd into the real APITable UI):

```sh
cd alloc-viz-widget
npm install
npm run start    # widget-cli start; serves dev bundle at the host configured in widget.config.json
```

In APITable: open a datasheet → widget panel → "Develop a widget" → paste the local widget URL.

## Deploying to a self-hosted APITable (release flow)

This is the real publish path: bundle the widget, register it as a package, upload, and install into the space. Full recipe and gotchas are in ticket [a390](tickets/Widget-cli%20Release%20Path%20Against%20Local%20Apitable%20Sta%20%28a390%29.md). Short version:

**1. Get an API token** from the APITable UI (user settings → developer → API token). Format: `usk...`.

**2. Get the spaceId** for the space the widget will live in:

```sh
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/fusion/v1/spaces
```

**3. Fill out `widget.config.json`** with all required fields (the CLI is silent about most of them — server returns code 473 if anything's missing):

```json
{
  "packageId":   "wpk...",
  "spaceId":     "spc...",
  "host":        "http://localhost:8080",
  "entry":       "src/index.tsx",
  "name":        { "en-US": "...", "zh-CN": "..." },
  "description": { "en-US": "...", "zh-CN": "..." },
  "icon":        "icon.png",
  "cover":       "cover.png",
  "authorIcon":  "author-icon.png",
  "authorName":  "...",
  "authorEmail": "...@...",
  "authorLink":  "https://...",
  "sandbox":     false
}
```

PNG assets must exist at those paths. 1x1 placeholders are fine for dev.

**4. Release:**

```sh
cd alloc-viz-widget
./node_modules/.bin/widget-cli release --ci \
  --host       http://localhost:8080 \
  --uploadHost http://localhost:8080 \
  --token      <usk-token> \
  --version    0.1.9
```

`--uploadHost` here is **required for self-hosted** — without it the CLI uploads to apitable.com's CDN, which doesn't have a record of your locally-registered package. With it, the bundle goes to the local stack's MinIO/S3.

Caveats (full list in [a390](tickets/Widget-cli%20Release%20Path%20Against%20Local%20Apitable%20Sta%20%28a390%29.md)):
- `release` runs `npm version` and creates a git commit/tag every run unless `--version` is pinned.
- `authorLink` cannot be `localhost:*` — server URL validator rejects it; use `https://example.com` for local dev.
- Server requires `authorIconToken` even for space (non-global) releases, but the CLI only prompts for author fields under `--global`. Pre-fill them in the config.

**5. Install into a view**: APITable UI → datasheet → widget panel → "Add widget" → pick the package → done.

## Deploying to hosted aitable.ai (cloud)

aitable.ai supports custom widgets per-space, scoped to the user that creates the package (per memory note ddf7). The release flow is similar to self-hosted but with two important differences — read both before running.

### Difference 1: do NOT pass `--uploadHost`

For aitable.ai cloud, **omit `--uploadHost` entirely**. The CLI fetches the real S3 upload endpoint (`ap-southeast-1`) automatically via `getUploadMeta`. If you pass `--uploadHost https://aitable.ai`, the bundle PUT goes to `https://aitable.ai/apitable-assets/...` which is the *read* CDN path and returns 404 on PUT.

```
self-hosted:    --host http://localhost:8080  --uploadHost http://localhost:8080
aitable.ai:     --host https://aitable.ai     (no --uploadHost)
```

### Difference 2: first release is interactive (no `--ci`, no `yes |`)

If the `packageId` in `widget.config.json` doesn't exist on aitable.ai yet, the CLI prompts: `Release a new widget with Id: wpk... Y/n?`. That prompt reads `/dev/tty` directly via inquirer — `yes |` does NOT satisfy it (it'll spam the terminal until killed), and `--ci` doesn't bypass it either. **Run interactively, type `y`, hit Enter.** Subsequent releases of the same package skip the prompt and `--ci` works fine.

### Full flow

**1.** Get a `usk`-prefixed API token from the aitable.ai UI (user settings → developer).

**2.** Get your `spaceId`:
```sh
curl -s -H "Authorization: Bearer <token>" https://aitable.ai/fusion/v1/spaces
```

**3.** Pick a `packageId` (any string matching `wpk` + 10 alphanumeric chars). The CLI registers it with the server on first release. Or generate one:
```sh
echo "wpk$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c10)"
```

**4.** Update [widget.config.json](alloc-viz-widget/widget.config.json):
```json
{
  "packageId": "wpk...",
  "spaceId":   "spc...",
  "host":      "https://aitable.ai"
  // ... rest unchanged
}
```
`authorLink` must be a real public URL (no `localhost`).

**5.** First release — interactive, no `--ci`:
```sh
cd alloc-viz-widget
./node_modules/.bin/widget-cli release \
  --version 0.1.11 \
  --host    https://aitable.ai \
  --token   <usk-token>
# at "Release a new widget with Id: wpk... Y/n?", type y + Enter
```

**6.** Subsequent releases — `--ci` is fine because the package now exists:
```sh
./node_modules/.bin/widget-cli release --ci \
  --version 0.1.12 \
  --host    https://aitable.ai \
  --token   <usk-token>
```

**7.** Install in the aitable.ai UI: open a datasheet → widget panel → "Add widget" → pick the package.

Use real (non-placeholder) icon/cover assets before sharing the package with anyone else.

## Tickets and notes

Work-in-progress decisions, recipes, and architecture notes live in [tickets/](tickets/) and are managed via the `tix` CLI. Notable ones:

- [a390](tickets/Widget-cli%20Release%20Path%20Against%20Local%20Apitable%20Sta%20%28a390%29.md) — working release recipe + gotchas (this README's section above is a summary)
- [ddf7](tickets/Clarify%20Architecture%20%28ddf7%29.md) — clarified: aitable.ai does support custom widgets per-space, scoped to creator
- [eaf0](tickets/Viz%20Exploration%20Candidate%20Approaches%20For%20Apitable%20%28eaf0%29.md) — design exploration for the alloc-viz widget
- [f33d](tickets/Register%20And%20Install%20Alloc-viz-widget%20In%20Apitable%20%28f33d%29.md) — superseded forensic recipe (kept for archaeology; use a390 instead)
- [ec79](tickets/Plan%20Personal%20Deployment%20%28ec79%29.md) — personal deployment plan (paused)

Run `tix ls` for the current state, or `tix-ui` for a browser view.
