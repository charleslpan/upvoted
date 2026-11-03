# Upvoted

A daily podcast of the three biggest Hacker News stories, made by an [eve](https://vercel.com/docs/eve)
agent. Every morning its schedule starts a session, and the agent:

1. **picks** the day's top stories (`get_top_stories`),
2. **reads** each article and its comment thread (`get_article`, `get_comments`, `get_replies`),
   and searches the web when it helps (`web_search`, `web_fetch`),
3. **writes** a script in the style of NPR's _Up First_: one host, a correspondent per story,
   and checks it (`check_script`),
4. **publishes** it (`publish_episode`): voices it with Gemini TTS, mixes the episode MP3 and adds
   it to `index.json`, which the site reads.

Every model call goes through Vercel AI Gateway. Deployments authenticate with Vercel's OIDC
token, so the project holds no provider keys.

## Layout

A Turborepo + pnpm monorepo, laid out like Cal.com's.

```
agent/                the eve agent (the root package's)
  agent.ts                    model, reasoning, session usage cap, build settings
  instructions.md             the job and the full style guide: edit the show's behavior here
  tools/                      one file per tool the model calls (thin wrappers over features)
  channels/episode.ts         POST /api/episode, the manual trigger; schedules start runs here
  channels/eve.ts             eve's own HTTP API (/eve/v1/*), for the terminal UI
  schedules/daily-episode.ts  the daily run at 09:00 UTC
  hooks/usage.ts              logs each run's tokens, cost, searches and fetches (`upvoted usage:`)
  lib/                        state and schemas the tools share
vercel.ts             the Vercel project: the site and the agent as services (withEve)
apps/
  web/                @upvoted/web: the Next.js App Router app
    app/page.tsx              the site: the latest episode and its show notes
packages/
  types/              @upvoted/types: the zod data contract (contract.ts)
  lib/                @upvoted/lib: config.ts, storage.ts and small shared helpers
  features/           @upvoted/features: one folder per feature, exported as a subpath
    stories/          selection and the read tools   (@upvoted/features/stories)
    script/           checking and finishing scripts (@upvoted/features/script)
    voice/            Gemini voices and the mix      (@upvoted/features/voice)
    episodes/         the index and run triggers     (@upvoted/features/episodes)
    produce/          publish_episode's steps        (@upvoted/features/produce)
  testing/            @upvoted/testing: shared test setup, fetch stubs and fixtures/
  tsconfig/           @upvoted/tsconfig: base.json and nextjs.json
scripts/
  episode.ts          voices, mixes and publishes a saved script (`pnpm episode`)
```

- **`@upvoted/types`** (`packages/types/contract.ts`) holds every schema the steps pass around:
  `StoryRef`, `EpisodeStory`, `Line`, `Segment`, `Script`, `ScriptDraft`, `EpisodeAudio`,
  `EpisodeRecord` and `EpisodeIndex`. Each is a zod schema (`ScriptSchema`) with its inferred type
  (`Script`). All of them are plain JSON (dates are ISO strings), so they round-trip through
  `JSON.stringify` unchanged.
  A `Script` runs intro, three stories, sign-off: only the host speaks in the intro and the
  sign-off, and story `i` is the host and correspondent `i`. A `ScriptDraft` is what the agent
  writes: the segments' kinds and lines, without story ids, title or show notes.
- **`@upvoted/lib/config`** is the show's config (name, time zone, cast, TTS model, retention),
  validated with zod at import. The `cast` is one `host` and three `correspondents`;
  correspondent `i` covers story `i` (`correspondentFor(i)`). Change the cast, voices or the
  show-wide speaking style (`tts.style`) there. The agent's model is in `agent/agent.ts`, and
  `agent/instructions.md` names the cast too: change both together.
- **`@upvoted/lib/storage`** is the only way steps read and write files. See Storage below.
- **`@upvoted/lib/http`** has `fetchWithRetry`, `fetchJson` (timeouts and retries) and
  `createLimiter` (a concurrency cap).
- **`@upvoted/lib/dates`** has `episodeDate(now)`, an episode's date in the show's time zone.
- **`@upvoted/features/episodes`** reads and writes `index.json`: `loadIndex`, `findEpisode`,
  `loadExcludeIds(now)` (story ids from episodes in the `retention.excludeDays` days before
  `now`'s episode date, not counting that date), `episodeRecord(script, stories, audio, at)` and
  `publishEpisode(record)`, which inserts newest first, replaces a record with the same date,
  keeps `retention.episodes` (7) and deletes the dropped episodes' files. `handleRunRequest` and
  `runScheduled` start agent sessions through `startEpisode`, which skips a published date unless
  `force` is set.
- **`@upvoted/features/stories`**: `selectStories`, `selectionTime`, and the read tools'
  functions `getArticle`, `getComments`, `getReplies` and `lookupStories`. Usernames never leave
  it.
- **`@upvoted/features/script`**: `checkScript(draft, storyIds, selection)` returns the problems
  with a draft (empty when it's ready): the contract and cast rules, the stories picked, no URLs,
  markdown or digits in the text, and the word budgets in `WORD_BUDGET` (intro 60–100, each story
  450–600, sign-off 40–70, at least 1,650 in all). `buildScript` adds the story ids, title and
  show notes from HN. `agent/instructions.md` states the same budgets; change both together.

### Package rules

- Internal packages ship TypeScript source with no build step. Each `package.json` exports its
  files directly (`@upvoted/lib/<file>`, `@upvoted/features/<feature>`). `apps/web` compiles
  them through `transpilePackages` in `next.config.ts`; add any new internal package there. eve
  bundles them into the agent, but loads their own dependencies from the root `node_modules`, so
  a runtime dependency of `@upvoted/features` or `@upvoted/lib` also goes in `publicHoistPattern`
  in `pnpm-workspace.yaml`.
- The site imports `@upvoted/features/episodes` only. Keep that subpath free of ffmpeg,
  Readability and the AI SDK, so they stay out of the Next.js bundle.
- **`@upvoted/lib` never imports `@upvoted/types`.** `@upvoted/types` imports
  `@upvoted/lib/config` (a line's speaker must be in the configured cast), so the reverse
  import would be a cycle. Storage takes any zod schema, so it doesn't need the contract.
- Dependencies go in the package that uses them. Versions shared by several packages live in
  the `catalog:` in `pnpm-workspace.yaml`.
- Inside a package, import its own files by relative path, without an extension. Import other
  packages by name (`@upvoted/lib/storage`), never by relative path.

## Commands

Run everything from the repo root. Node 24 (eve needs it) and pnpm (the version pinned in
`packageManager`; `corepack enable` picks it up).

| Command            | What it does                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm install`     | Install all workspaces.                                                                     |
| `pnpm dev`         | Run the Next.js app locally (turbo `dev`).                                                  |
| `pnpm dev:agent`   | Run the agent locally with eve's terminal UI (`eve dev`).                                   |
| `pnpm build`       | Build the app (turbo `build`, which runs `next build` in `apps/web`).                       |
| `pnpm build:agent` | Build the agent (`eve build`), as Vercel does.                                              |
| `pnpm lint`        | Biome lint and format check, per package plus the root files.                               |
| `pnpm format`      | Apply Biome's fixes: formatting, import order and safe lint fixes.                          |
| `pnpm typecheck`   | `tsc --noEmit` per package plus the root (`scripts/`).                                      |
| `pnpm test`        | Vitest, per package through turbo.                                                          |
| `pnpm vitest`      | All packages' tests in one Vitest process (the root `test.projects` config), in watch mode. |
| `pnpm episode`     | Voice, mix and publish a saved script. See below.                                           |

Run one package's task with a filter, such as `pnpm turbo run test --filter=@upvoted/features`.
CI (`.github/workflows/ci.yml`) runs `lint`, `typecheck`, `test` and `build` on every pull
request and on pushes to `main`. Turbo runs in loose env mode, so tasks see the whole
environment. Add any variable that changes a task's output to its `env` in `turbo.json`.

### Running the agent locally

`vercel link && vercel env pull` at the root writes `.env.local` with the project's variables,
`VERCEL_OIDC_TOKEN` for AI Gateway and `VERCEL_ENV=development`, so local runs keep to `preview/`
in storage. Then `pnpm dev:agent` starts eve's dev server (http://localhost:2000) and its terminal
UI, where you can ask for an episode. To start a run as production does:

```
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:2000/api/episode?date=2026-11-03"
```

`eve dev` never fires schedules by itself; `curl -X POST
http://localhost:2000/eve/v1/dev/schedules/daily-episode` fires the daily one once. Behind an HTTP
proxy, set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses it.

### `pnpm episode`

```
pnpm episode [--date YYYY-MM-DD] [--from STAGE] [--until STAGE]
```

`scripts/episode.ts` redoes the audio of a script an agent run saved: it voices, mixes and
publishes `episodes/<date>/script.json` through `@upvoted/lib/storage`, in the stages `voice`,
`mix` and `publish`.

- `--date` is the episode date (default: today in America/New_York).
- `--from mix` reuses the saved segment WAVs; `--until` stops after a stage.
- With `UPVOTED_FAKE_VOICES=1` the voice stage uses tones instead of Gemini, so
  `pnpm episode --until mix` makes a sample mix with no API key. The mix deletes the segment WAVs
  once the MP3 is saved, so rerun from `voice` rather than `mix`.

The runner loads `.env.local` and `.env` from the root, then `apps/web/.env.local`. It never
overrides a variable that's already set. Its first line says which store it uses: Blob when
`BLOB_READ_WRITE_TOKEN` is set, under `preview/` unless `VERCEL_ENV` is unset or `production`.

The runner uses tsx as a loader (`node --import tsx`) rather than the `tsx` CLI. The CLI opens an
IPC socket, which sandboxes often refuse.

## Conventions

- **Tools are thin.** Each file in `agent/tools/` wraps a plain async function in
  `packages/features/<feature>/`, which never imports eve or Next.js and is where the tests are.
  A step takes and returns small JSON (storage keys, ids, contract types), never audio bytes, and
  must finish well inside Vercel Hobby's 300-second function limit.
- **The show's behavior lives in `agent/instructions.md`.** Code enforces what must hold
  (`checkScript`, links from HN), the instructions say how to write. Don't test the wording.
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
- **Do test behavior that can break**: story selection, ranking and exclusions; HTML stripping,
  article failures, comment paging and that no username reaches the agent; the contract's speaker
  and segment rules and `checkScript`; show notes built from HN; the storage backends and the
  `preview/` prefix; splitting segments under the TTS limits; a real ffmpeg mix (duration,
  format, loudness); publish retention, exclusion and idempotency; the trigger's auth; and the
  `force` re-run.
- Keep the suite deterministic. Steps that run in parallel may start in any order, so check
  what they produce, not the order they were called in. Fake only `Date` for time.
- When you delete a test that was the only coverage of something that matters, replace it with
  one behavioral test.

## The daily run

`agent/schedules/daily-episode.ts` runs at `0 9 * * *` (09:00 UTC; Hobby fires it some time in
that hour). It starts a session for today's date in the show's time zone, unless `index.json`
already has that date's episode: then it starts nothing and spends nothing. Stories come from the
24 hours before 09:00 UTC on the episode date, or before now if that's still ahead
(`selectionTime`).

The manual trigger is `POST /api/episode` (`agent/channels/episode.ts`, routed to the agent in
`vercel.ts`). It requires `Authorization: Bearer $CRON_SECRET` (401 otherwise), takes an optional
`?date=YYYY-MM-DD` (default: today in the show's time zone) and `?force=1`, and answers
`{ date, force, status, sessionId }`, where `status` is `started` or `already published`. With
`force` it makes the episode again from freshly selected stories and replaces the published one.
Each run is a session of its own; follow it in **Observability → Agent Runs**.

In a session the agent calls `get_top_stories`, which saves the three ids in eve session state
(`agent/lib/selection.ts`), reads the stories, writes the script and calls `check_script` until it
passes. `publish_episode` checks the script again before it starts (its approval policy denies a
bad one) and then runs as a durable eve workflow tool: `saveScript` (links and show notes looked
up from HN, `script.json` and `transcript.md`), one `voiceSavedSegment` step per segment in
parallel, `mixEpisode`, and `publishSaved`. Steps keep the Workflow SDK's default retries; a step
that keeps failing fails the call before anything is published.

**Cost.** `limits.sessionUsage` in `agent/agent.ts` fails a session at 500,000 new input tokens,
100,000 output tokens or $5. `web_fetch` cuts each page at about 20,000 tokens, and the
instructions say to research only when it adds something. `hooks/usage.ts` logs a line starting
`upvoted usage:` with the session's tokens, cost, searches and fetches when `publish_episode`
settles and at the end of each turn. Search the runtime logs for it to measure what an episode
costs.

**Sessions end on their own.** eve has no way for a tool or hook to end a session, so
`sessionTimeoutMs` completes each one five minutes after its turn ends. Until then it shows as
running, waiting for input, which costs nothing; it never times out while a turn is open.

The site (`app/page.tsx`) renders on each request from `index.json`, so a published episode shows
at once. Each `EpisodeRecord` carries its `stories` (title, url, domain, HN link) for the show
notes.

## Deploying

The Vercel project builds from the **repo root** (its Root Directory is empty), with Node.js 24.
`vercel.ts` uses `withEve` from `eve/vercel`: the Next.js site is the `web` service, and the agent
is added as the `eve` service with its routes (`/eve/v1/*`) and its schedule as a Cron Job.
`/api/episode` goes to the agent, everything else to the site. There is no `vercel.json`.

Preview deployments get `VERCEL_ENV=preview`, so they read and write under `preview/` in Blob
and can't touch the live episode. A run there publishes to `preview/index.json`, which the
preview's own site shows.

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
to its own `index.js` at runtime, so `agent/agent.ts` lists it in `build.externalDependencies`:
eve ships the package whole, binary included, instead of bundling it. Check a build with
`pnpm build:agent && ls .output/server/node_modules/ffmpeg-static`.

## Storage

`@upvoted/lib/storage` exports `putJson(key, value)`, `getJson(key, schema)` (null when missing),
`putFile(key, bytes, contentType)`, `getFile(key)` (a `Buffer`, or null), `list(prefix)`,
`del(keys)`, `describeStorage()`, and `keys`, which builds the key layout:

```
index.json
episodes/<date>/script.json
episodes/<date>/transcript.md
episodes/<date>/segments/<n>.wav     n = the segment's 0-based index in the script
episodes/<date>/episode.mp3
```

The backend is chosen on each call. With `BLOB_READ_WRITE_TOKEN` set it uses the public Vercel
Blob store. When `VERCEL_ENV` is set to anything but `production` (on previews, and locally after
`vercel env pull`), every key is stored under `preview/`; keys passed in and returned never
include the prefix. Keys are used as-is (no random suffix), writes overwrite, and JSON and text files are
cached by the CDN for 60 seconds. Without the token it uses the local filesystem under `out/`.
`put*` returns `{ key, url, bytes }`. The url is the public Blob URL, or a `file://` URL locally.

## Environment

`.env.example` names the variables. None is needed to build or test.

- `AI_GATEWAY_API_KEY`: local runs only. Deployments use Vercel's OIDC token.
- `BLOB_READ_WRITE_TOKEN`: the Vercel Blob store. When unset, storage uses `out/`.
- `CRON_SECRET`: guards the manual trigger, `POST /api/episode`.
- `VERCEL_ENV`: set by Vercel. Anything but `production` keeps storage under `preview/`.
- `UPVOTED_FAKE_VOICES`: set to `1` for tones instead of Gemini in the voice stage.
- `FFMPEG_BIN`: optional. An ffmpeg binary to use instead of `ffmpeg-static`'s.
- `NEXT_PUBLIC_SITE_URL`: optional. The site's origin, which otherwise comes from Vercel's
  `VERCEL_PROJECT_PRODUCTION_URL`, or `http://localhost:3000` locally.

The Vercel project's Root Directory is the repo root (empty), not `apps/web`.
