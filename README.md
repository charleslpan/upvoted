# upvoted

A daily, AI-generated podcast of the three biggest Hacker News stories, in about twelve minutes:
a host brings in a correspondent for each story, who explains what happened and what the HN
thread is arguing about. Listen at
**[upvoted.dev](https://upvoted.dev)**, which plays the latest episode.

It runs on Vercel (Cron, Workflows, Blob and AI Gateway). The script is written by Claude and
voiced by Gemini. Upvoted is not affiliated with Hacker News or Y Combinator.

See [AGENTS.md](AGENTS.md) for the layout, the commands and the conventions.

## How it runs

Every morning between 08:00 and 08:59 UTC (about 3–5am Eastern), Vercel Cron calls
`/api/cron/daily`, which starts the `dailyEpisode` workflow (`apps/web/workflows/daily-episode.ts`)
for today's date in New York. The workflow picks the stories, gathers them, writes the script,
voices and mixes it, then adds the episode to `index.json` in Blob, which the site reads. If the
day's episode is already published, the run does nothing.

Run it by hand, or for another day:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://upvoted.dev/api/cron/daily
curl -H "Authorization: Bearer $CRON_SECRET" "https://upvoted.dev/api/cron/daily?date=2026-11-03"
# Make a published day's episode again, replacing it:
curl -H "Authorization: Bearer $CRON_SECRET" "https://upvoted.dev/api/cron/daily?force=1"
```

It answers `{ "date": "...", "force": false, "runId": "wrun_..." }`. Follow the run in the Vercel dashboard: open
the **upvoted** project's Workflows view (under **Observability**) and find the run by that id. Each step
shows its attempts, logs and errors. A failed step is retried a few times; if it keeps failing
the run fails there, and nothing is published.

## One-time setup

- **AI Gateway credits.** In the Vercel dashboard, open **AI Gateway**, add credits, and set a
  monthly budget so a runaway day can't overspend. Each episode is a handful of Claude calls and
  about twelve minutes of Gemini speech.
- The Vercel project (Root Directory `apps/web`), the public Blob store and `CRON_SECRET` are
  already set up. Deployments reach AI Gateway with Vercel's OIDC token, so there are no provider
  keys to add.

## Running locally

Node 22+ and pnpm (`corepack enable`).

```sh
pnpm install
(cd apps/web && vercel link && vercel env pull)   # writes apps/web/.env.local
pnpm episode --until mix           # select, gather, write, voice and mix today's episode
```

`pnpm episode` runs the same steps as the workflow and saves each stage's output, so
`--from`/`--until` can redo one stage. With `BLOB_READ_WRITE_TOKEN` set it writes to the
production Blob store (its first line says so), and a full run publishes to the live site. To
write to `out/` instead, blank it for the run: `BLOB_READ_WRITE_TOKEN= pnpm episode`. `pnpm dev`
serves the site from whichever store is configured.

## Changing the voices

The cast and their voices are in `packages/lib/config.ts`:

- `cast.host` and `cast.correspondents[]` each have a `name` and a `voice`, a Gemini prebuilt
  voice name such as `Kore` or `Puck`. Correspondent `i` covers story `i`.
- `tts.model` is the AI Gateway speech model, and `tts.style` the show-wide speaking style.

Try a change on a saved script with `pnpm episode --from voice --until mix`.
