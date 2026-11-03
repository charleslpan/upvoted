import { Readability } from '@mozilla/readability';
import { BROWSER_USER_AGENT, fetchWithRetry } from '@upvoted/lib/http';
import { parseHTML } from 'linkedom';
import { countWords, nodeToText, truncateWords } from './text';

/** Fetches a story's linked page and extracts its readable text with Mozilla Readability. */

export const ARTICLE_TIMEOUT_MS = 15_000;
export const ARTICLE_MAX_WORDS = 8_000;
/** Pages beyond this size are cut off before parsing. */
const MAX_HTML_BYTES = 5_000_000;
/** Less text than this usually means a paywall, a bot check, or a page built by JavaScript. */
const MIN_WORDS = 50;

export interface ArticleResult {
  text: string | null;
  error: string | null;
}

/** Never throws: any failure comes back as `error`, with `text` null. */
export async function fetchArticle(url: string): Promise<ArticleResult> {
  try {
    return { text: await readArticle(url), error: null };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Extracts the readable text of an HTML page, capped at `ARTICLE_MAX_WORDS`. Throws if none. */
export function extractArticle(html: string): string {
  const { document } = parseHTML(html);
  const article = new Readability(document, { serializer: (node) => node }).parse();
  const text = article?.content ? nodeToText(article.content) : '';
  const words = countWords(text);
  if (words < MIN_WORDS) {
    throw new Error(
      words === 0
        ? 'No readable article text found'
        : `Too little readable text (${words} words); the page may need JavaScript or block bots`,
    );
  }
  return truncateWords(text, ARTICLE_MAX_WORDS);
}

async function readArticle(url: string): Promise<string> {
  const response = await fetchWithRetry(
    url,
    {
      headers: {
        'user-agent': BROWSER_USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    },
    { timeoutMs: ARTICLE_TIMEOUT_MS, retries: 1 },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mimeType && mimeType !== 'text/html' && mimeType !== 'application/xhtml+xml') {
    await response.body?.cancel();
    throw new Error(`Not an HTML page (${mimeType})`);
  }
  const bytes = await readCapped(response, MAX_HTML_BYTES);
  if (startsWith(bytes, '%PDF')) throw new Error('Not an HTML page (application/pdf)');
  return extractArticle(decode(bytes, contentType));
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= maxBytes) await reader.cancel();
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

/** Decodes with the charset the server or the page declares, falling back to UTF-8. */
function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function startsWith(bytes: Uint8Array, prefix: string): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, prefix.length)) === prefix;
}
