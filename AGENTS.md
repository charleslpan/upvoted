# Upvoted

A daily podcast of the three biggest Hacker News stories. Every morning a Vercel Cron job starts
a Vercel Workflow that runs the pipeline:

1. **select** the day's top stories,
2. **gather** each story's article and comments into `brief.json`,
3. **write** a script with Claude in the style of NPR's _Up First_: one host, a correspondent per story,
4. **voice** it with Gemini TTS and **mix** the episode MP3,
5. **publish** it to `index.json`, which the site's feed reads.

Every model call goes through Vercel AI Gateway with the AI SDK (`ai`). Deployments authenticate
with Vercel's OIDC token, so the project holds no provider keys.

## Layout

A Turborepo + pnpm monorepo, laid out like Cal.com's.

```
apps/
  web/                @upvoted/web: the Next.js App Router app
    app/page.tsx              the site: the latest episode and its show notes
    app/api/cron/daily/       the daily cron route, which starts the workflow
    workflows/                the daily-episode workflow ('use workflow' / 'use step')
    vercel.json               the cron schedule
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
  A `Script` runs intro, three stories, sign-off: only the host speaks in the intro and the
  sign-off, and story `i` is the host and correspondent `i`.
- **`@upvoted/lib/config`** is the show's config (name, time zone, cast, models, retention),
  validated with zod at import. The `cast` is one `host` and three `correspondents`;
  correspondent `i` covers story `i` (`correspondentFor(i)`). Change the cast, voices, models or
  the show-wide speaking style (`tts.style`) there.
- **`@upvoted/lib/storage`** is the only way steps read and write files. See Storage below.
- **`@upvoted/lib/http`** has `fetchWithRetry`, `fetchJson` (timeouts and retries) and
  `createLimiter` (a concurrency cap).
- **`@upvoted/lib/dates`** has `episodeDate(now)`, an episode's date in the show's time zone.
- **`@upvoted/lib/errors`** has `NotImplementedError`, which a step that isn't built yet throws.
- **`@upvoted/features/episodes`** reads and writes `index.json`: `loadIndex`, `findEpisode`,
  `loadExcludeIds(now)` (story ids from episodes in the `retention.excludeDays` days before
  `now`'s episode date, not counting that date), `episodeRecord(brief, script, audio, at)` and
  `publishEpisode(record)`, which inserts newest first, replaces a record with the same date,
  keeps `retention.episodes` (7) and deletes the dropped episodes' files.

### Package rules

- Internal packages ship TypeScript source with no build step. Each `package.json` exports its
  files directly (`@upvoted/lib/<file>`, `@upvoted/features/<feature>`). `apps/web` compiles
  them through `transpilePackages` in `next.config.ts`; add any new internal package there.
- **`@upvoted/lib` never imports `@upvoted/types`.** `@upvoted/types` imports
  `@upvoted/lib/config` (a line's speaker must be in the configured cast), so the reverse
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
  hours before 08:00 UTC that day, when the daily cron runs, or before now if that's still ahead
  (`selectionTime` in `@upvoted/features/stories`, shared with the workflow).
- `--from` starts at a later stage and reads the earlier stages' output from storage, so
  `pnpm episode --from write --until write` rewrites the script from a saved brief.
- `--until` stops after a stage. `pnpm episode --until gather` writes
  `out/episodes/<date>/brief.json`.
- When the runner reaches a step that is still a stub, it stops with a message naming it.
  Everything before that step has been saved.
- `pnpm episode --until mix` voices and mixes the episode. With `UPVOTED_FAKE_VOICES=1` the
  voice stage uses tones instead of Gemini, so `--from voice --until mix` makes a sample mix
  from a saved script with no API key. The mix deletes the segment WAVs once the MP3 is saved,
  so rerun `--from voice` rather than `--from mix`.

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

## Tests

A test earns its place only if both hold: a plausible bug in the code under test would make it
fail, and a correct refactor wouldn't.

- **Don't write tests that** assert prompt or copy wording (error messages, page text, the
  script writer's prompt), or the content of fixtures we wrote ourselves; assert the order or
  count of calls to internal functions or mocks, unless that order is the behavior (the mix
  getting segments in script order, a retry calling again); mirror the implementation line by
  line; or duplicate another test.
- **Do test behavior that can break**: story selection, ranking and exclusions; HTML stripping
  and article failures; the contract's speaker and segment rules; the storage backends;
  splitting segments under the TTS limits; a real ffmpeg mix (duration, format, loudness);
  publish retention, exclusion and idempotency; cron auth; and the `force` re-run.
- Keep the suite deterministic. Steps that run in parallel may start in any order, so check
  what they produce, not the order they were called in. Fake only `Date` for time.
- When you delete a test that was the only coverage of something that matters, replace it with
  one behavioral test.

## The daily workflow

`vercel.json` (in `apps/web`) runs `GET /api/cron/daily` at `0 8 * * *`; Hobby fires it some time
in that hour. The route requires `Authorization: Bearer $CRON_SECRET` (401 otherwise), takes an
optional `?date=YYYY-MM-DD` (default: today in the show's time zone) and `?force=1`, and starts
`dailyEpisode(date, force)` from `apps/web/workflows/daily-episode.ts` with `start()` from
`workflow/api`, answering `{ date, force, runId }`. `next.config.ts` is wrapped with `withWorkflow`.

The workflow returns at once if `index.json` already has the date's episode, so a re-run changes
nothing. With `force`, it makes the episode again from freshly selected stories and replaces the
published one. Otherwise it runs, as `'use step'` wrappers around `@upvoted/features`: select (with
`loadExcludeIds`), three `gatherStory` in parallel, save `brief.json`, three `writeStorySegment`
in parallel, the bookends and `script.json` + `transcript.md`, one `voiceSegment` per segment in
parallel, `mixEpisode`, and `publishEpisode`. Steps pass dates, indexes, storage keys and
contract types; the brief and the script travel through storage. Steps keep the SDK's default
retries; a step that keeps failing fails the run before anything is published.

The site (`app/page.tsx`) renders on each request from `index.json`, so a published episode shows
at once. Each `EpisodeRecord` carries its `stories` (title, url, domain, HN link) for the show
notes.

Without the Workflow compiler, `'use workflow'` and `'use step'` are no-ops, so
`daily-episode.test.ts` runs the workflow as a plain function with the model and ffmpeg steps
mocked.

## Voice and mix

`@upvoted/features/voice` turns a `Script` into `episode.mp3`:

- **`voiceSegment(date, index, segment)`** voices one segment with `config.tts.model` through
  AI Gateway (`generateSpeech`) with the voices of the cast members in it (`segmentSpeakers`),
  and `config.tts.style` as the `instructions`. The host-only intro and sign-off use Gemini's
  single-speaker mode (the lines as `text`, the host's `voice`). A story uses two-speaker mode:
  the host's and its correspondent's voices in `providerOptions.google.multiSpeakerVoiceConfig`,
  the lines as `turns`, and each line's `cue` as its `speechMetadata.style` (`styleForCue` in
  `speech.ts`). Segments longer than one call's budget (`split.ts`: about 4 minutes of audio
  and 4,000 input tokens, well inside Gemini's 8,192-token, ~10.9-minute limits) are split at
  whole turns, voiced at once and joined. It warns when a call's audio is far from what its
  word count predicts, which is how Gemini's voice swaps and dropped lines tend to show up.
  Adapters implement `SpeechAdapter` (`gemini.ts`, and `fake.ts` for tests and dry runs).
- **`mixEpisode(date, segmentKeys)`** runs ffmpeg once: the theme, the intro, a sting before
  each story segment, the stories, the sign-off and the theme's tail, with short pauses. The
  music is synthesized in the filtergraph (`music.ts`), so there are no audio files to license.
  Segment kinds come from the saved `script.json` (or from position when it's missing). The
  episode is loudness-normalized to −16 LUFS and encoded as a 44.1 kHz mono 96 kbps MP3 with
  ID3 tags.

**ffmpeg on Vercel.** The binary comes from `ffmpeg-static`, a dependency of
`@upvoted/features` whose install script downloads it (allowed in `allowBuilds` in
`pnpm-workspace.yaml`). `FFMPEG_BIN` overrides the path. `ffmpeg-static` finds the binary next
to its own `index.js` at runtime, which Next.js's file tracing can't see, so
`apps/web/next.config.ts`:

- sets `outputFileTracingRoot` to the repo root, where pnpm keeps `node_modules/.pnpm`,
- lists `ffmpeg-static` in `serverExternalPackages`, so it is required from `node_modules`
  rather than bundled, and
- adds the binary with `outputFileTracingIncludes` to `/api/health/ffmpeg` and to Vercel
  Workflow's generated routes (`/.well-known/workflow/**/*`).

Any other route that calls `mixEpisode` needs its own entry there. Check a build with
`grep ffmpeg-static/ffmpeg apps/web/.next/server/app/<route>/route.js.nft.json`, and a
deployment with `curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/health/ffmpeg`, which
answers the first line of `ffmpeg -version`.

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
- `CRON_SECRET`: guards the daily cron route and `/api/health/ffmpeg`.
- `UPVOTED_FAKE_VOICES`: set to `1` for tones instead of Gemini in the voice stage.
- `FFMPEG_BIN`: optional. An ffmpeg binary to use instead of `ffmpeg-static`'s.
- `NEXT_PUBLIC_SITE_URL`: optional. The site's origin, which otherwise comes from Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, or `http://localhost:3000` locally.

The Vercel project's Root Directory is `apps/web`.
