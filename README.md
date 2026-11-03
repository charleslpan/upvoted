# upvoted

A daily, AI-generated podcast of the three biggest Hacker News stories: two hosts talk through
each story and what the HN thread is arguing about, in about twelve minutes. It runs on Vercel
(Cron, Workflows, Blob and AI Gateway) and is not affiliated with Hacker News or Y Combinator.

See [AGENTS.md](AGENTS.md) for the layout, the commands and the conventions.

```sh
pnpm install
pnpm test
pnpm episode --until gather   # writes out/episodes/<date>/brief.json
```
