import { defineTool } from 'eve/tools';
import { type WebFetchToolOutput, webFetch } from 'eve/tools/web_fetch';

/** About 20,000 tokens of text, so one huge page can't eat the session's budget. */
const MAX_CHARS = 80_000;

export default defineTool({
  ...webFetch,
  description:
    'Fetches a web page as markdown, cut off after about 20,000 tokens. Use it for background ' +
    "the story's own article and thread don't give, or to check a claim.",
  async execute(input, ctx) {
    const page = await lastOutput(await webFetch.execute(input, ctx));
    const truncated = page.content.length > MAX_CHARS;
    console.log(`web_fetch ${input.url}: ${page.content.length} chars${truncated ? ', cut' : ''}`);
    return truncated
      ? { ...page, content: page.content.slice(0, MAX_CHARS), truncated: true }
      : page;
  },
});

/** eve's fetch returns its output, or snapshots of it ending with the output. */
async function lastOutput(
  result: WebFetchToolOutput | AsyncIterable<WebFetchToolOutput>,
): Promise<WebFetchToolOutput> {
  if (!(Symbol.asyncIterator in result)) return result;
  let last: WebFetchToolOutput | undefined;
  for await (const snapshot of result) last = snapshot;
  if (!last) throw new Error('web_fetch returned nothing');
  return last;
}
