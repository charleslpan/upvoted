# Upvoted

A daily podcast of the three biggest Hacker News stories. Every morning a Vercel Cron job starts
a Vercel Workflow that runs the pipeline:

1. **select** the day's top stories,
2. **gather** each story's article and comments into `brief.json`,
3. **write** a two-host script with Claude,
4. **voice** it with Gemini TTS and **mix** the episode MP3,
5. **publish** it to `index.json`, which the site's feed reads.

Every model call goes through Vercel AI Gateway with the AI SDK (`ai`). Deployments authenticate
with Vercel's OIDC token, so the project holds no provider keys.

## Layout

A Turborepo + pnpm monorepo, laid out like Cal.com's.

```
apps/
  web/                @upvoted/web: the Next.js App Router app (site, feed, cron route, workflow)
packages/
  types/              @upvoted/types: the zod data contract (contract.ts)
  lib/                @upvoted/lib: config.ts, storage.ts and small shared helpers
  features/           @upvoted/features: one folder per feature, exported as a subpath
    stories/          select and gather          (@upvoted/features/stories)
    script/           the Claude script writer   (@upvoted/features/script)
    voice/            Gemini voices and the mix  (@upvoted/features/voice)
    episodes/         publishing and the index   (@upvoted/features/episodes)
  testing/            @upvoted/testing: shared test setup, fetch stubs and fixtures/
  tsconfig/           @upvoted/tsconfig: base.json and nextjs.json
scripts/
  episode.ts          the local pipeline runner (`pnpm episode`)
```

- **`@upvoted/types`** (`packages/types/contract.ts`) holds every schema the steps pass around:
  `Comment`, `StoryRef`, `Story`, `Brief`, `Line`, `Segment`, `Script`, `EpisodeAudio`,
  `EpisodeRecord` and `EpisodeIndex`. Each is a zod schema (`BriefSchema`) with its inferred type
  (`Brief`). All of them are plain JSON (dates are ISO strings), so they round-trip through
  `JSON.stringify` unchanged.
- **`@upvoted/lib/config`** is the show's config (name, time zone, hosts, models, retention),
  validated with zod at import. Change the hosts, voices or models there.
- **`@upvoted/lib/storage`** is the only way steps read and write files. See Storage below.
- **`@upvoted/lib/http`** has `fetchWithRetry`, `fetchJson` (timeouts and retries) and
  `createLimiter` (a concurrency cap).
- **`@upvoted/lib/dates`** has `episodeDate(now)`, an episode's date in the show's time zone.
- **`@upvoted/lib/errors`** has `NotImplementedError`, which a step that isn't built yet throws.

### Package rules

- Internal packages ship TypeScript source with no build step. Each `package.json` exports its
  files directly (`@upvoted/lib/<file>`, `@upvoted/features/<feature>`). `apps/web` compiles
  them through `transpilePackages` in `next.config.ts`; add any new internal package there.
- **`@upvoted/lib` never imports `@upvoted/types`.** `@upvoted/types` imports
  `@upvoted/lib/config` (a line's speaker must be one of the configured hosts), so the reverse
  import would be a cycle. Storage takes any zod schema, so it doesn't need the contract.
- Dependencies go in the package that uses them. Versions shared by several packages live in
  the `catalog:` in `pnpm-workspace.yaml`.
- Inside a package, import its own files by relative path, without an extension. Import other
  packages by name (`@upvoted/lib/storage`), never by relative path.

## Commands

Run everything from the repo root. Node 22+ and pnpm (the version pinned in `packageManager`;
`corepack enable` picks it up).

| Command          | What it does                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `pnpm install`   | Install all workspaces.                                                                     |
| `pnpm dev`       | Run the Next.js app locally (turbo `dev`).                                                  |
| `pnpm build`     | Build the app (turbo `build`, which runs `next build` in `apps/web`).                       |
| `pnpm lint`      | Biome lint and format check, per package plus the root files.                               |
| `pnpm format`    | Apply Biome's fixes: formatting, import order and safe lint fixes.                          |
| `pnpm typecheck` | `tsc --noEmit` per package plus the root (`scripts/`).                                      |
| `pnpm test`      | Vitest, per package through turbo.                                                          |
| `pnpm vitest`    | All packages' tests in one Vitest process (the root `test.projects` config), in watch mode. |
| `pnpm episode`   | Run the pipeline locally. See below.                                                        |

Run one package's task with a filter, such as `pnpm turbo run test --filter=@upvoted/features`.
CI (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test` and `build` on every pull
request and on pushes to `main`. Turbo runs in loose env mode, so tasks see the whole
environment. Add any variable that changes a task's output to its `env` in `turbo.json`.

### `pnpm episode`

```
pnpm episode [--date YYYY-MM-DD] [--from STAGE] [--until STAGE]
```

The local runner (`scripts/episode.ts`) runs the stages in order, `gather`, `write`, `voice`,
`mix`, `publish`, through `@upvoted/lib/storage`:

- `--date` is the episode date (default: today in America/New_York). Stories come from the 24
  hours before 08:00 UTC that day, when the daily cron runs, or before now if that's still ahead.
- `--from` starts at a later stage and reads the earlier stages' output from storage, so
  `pnpm episode --from write --until write` rewrites the script from a saved brief.
- `--until` stops after a stage. `pnpm episode --until gather` writes
  `out/episodes/<date>/brief.json`.
- When the runner reaches a step that is still a stub, it stops with a message naming it.
  Everything before that step has been saved.

The runner loads `.env.local` and `.env` from the root, then `apps/web/.env.local`, where
`vercel env pull` writes. It never overrides a variable that's already set. For model calls set
`AI_GATEWAY_API_KEY`, or use the `VERCEL_OIDC_TOKEN` that `vercel env pull` writes. If
`BLOB_READ_WRITE_TOKEN` is set, the runner writes to the production Blob store, and its first line
says so.

The runner uses tsx as a loader (`node --import tsx`) rather than the `tsx` CLI. The CLI opens an
IPC socket, which sandboxes often refuse. Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` so
Node's `fetch` uses it.

## Conventions

- **Each pipeline step is a plain async function** in `packages/features/<feature>/` that never
  imports Next.js. A step takes and returns small JSON (storage keys, ids, contract types), never
  audio bytes, so a thin `'use step'` wrapper in `apps/web` can call it. Each step must finish
  well inside Vercel Hobby's 300-second function limit.
- **Steps read and write files only through `@upvoted/lib/storage`.**
- **Tests never touch the network.** They sit next to the code as `*.test.ts`. Shared fixtures
  live in `packages/testing/fixtures/` and are read with `@upvoted/testing/fixtures`. The shared
  setup (`@upvoted/testing/setup`) makes any unstubbed `fetch` fail. It also points storage at a
  fresh temp folder per test and clears the Blob token. Stub requests with `stubFetch`
  (`@upvoted/testing/fetch`), or the HN APIs with `stubHnApi` (`@upvoted/testing/hn`). A package
  with tests has a `vitest.config.ts` that calls `testProject(name)` from
  `@upvoted/testing/vitest`.
- **Local output goes to `out/`** at the repo root (gitignored), or to `UPVOTED_OUT_DIR` if set.
- TypeScript is strict, including `noUncheckedIndexedAccess`. Biome formats with 2 spaces,
  single quotes and 100-column lines.
- The config (`@upvoted/lib/config`) and the contract (`@upvoted/types`) are shared by every
  step. Change them deliberately, and update the tests and this file with them.

## Storage

`@upvoted/lib/storage` exports `putJson(key, value)`, `getJson(key, schema)` (null when missing),
`putFile(key, bytes, contentType)`, `getFile(key)` (a `Buffer`, or null), `list(prefix)`,
`del(keys)`, `describeStorage()`, and `keys`, which builds the key layout:

```
index.json
episodes/<date>/brief.json
episodes/<date>/script.json
episodes/<date>/transcript.md
episodes/<date>/segments/<n>.wav     n = the segment's 0-based index in the script
episodes/<date>/episode.mp3
```

The backend is chosen on each call. With `BLOB_READ_WRITE_TOKEN` set it uses the public Vercel
Blob store. Keys are used as-is (no random suffix), writes overwrite, and JSON and text files are
cached by the CDN for 60 seconds. Without the token it uses the local filesystem under `out/`.
`put*` returns `{ key, url, bytes }`. The url is the public Blob URL, or a `file://` URL locally.

## Environment

`.env.example` names the variables. None is needed to build or test.

- `AI_GATEWAY_API_KEY`: local runs only. Deployments use Vercel's OIDC token.
- `BLOB_READ_WRITE_TOKEN`: the Vercel Blob store. When unset, storage uses `out/`.
- `CRON_SECRET`: guards the daily cron route.
- `NEXT_PUBLIC_SITE_URL`: optional. The site's origin, which otherwise comes from Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, or `http://localhost:3000` locally.

The Vercel project's Root Directory is `apps/web`.
