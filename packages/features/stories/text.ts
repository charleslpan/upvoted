import { parseHTML } from 'linkedom';

/** Turns HTML into readable plain text for the brief. */

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tr',
  'ul',
]);
const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'button',
]);

/**
 * Converts an HTML fragment (an HN comment, a post's text, an article) to plain text: tags
 * stripped, entities decoded, whitespace collapsed, and blocks such as paragraphs separated by
 * blank lines.
 */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return nodeToText(document.body);
}

/** Converts a DOM node's contents to plain text, as `htmlToText` does. */
export function nodeToText(root: Node): string {
  const out: string[] = [];
  walk(root, out);
  return out
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walk(node: Node, out: string[], preformatted = false): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? '';
      out.push(preformatted ? text : text.replace(/\s+/g, ' '));
    } else if (child.nodeType === 1) {
      const element = child as Element;
      const tag = element.localName.toLowerCase();
      if (SKIPPED_TAGS.has(tag)) continue;
      if (tag === 'br') {
        out.push('\n');
      } else if (tag === 'a') {
        out.push(linkText(element));
      } else if (BLOCK_TAGS.has(tag)) {
        out.push(tag === 'li' ? '\n\n- ' : '\n\n');
        walk(element, out, preformatted || tag === 'pre');
        out.push('\n\n');
      } else {
        walk(element, out, preformatted);
      }
    }
  }
}

/** HN shortens long link text to `https://example.com/some/pa...`; use the full href instead. */
function linkText(anchor: Element): string {
  const text = (anchor.textContent ?? '').replace(/\s+/g, ' ');
  const href = anchor.getAttribute('href') ?? '';
  const shortened = text.endsWith('...') && /^https?:\/\//.test(text);
  return shortened && href.startsWith(text.slice(0, -3)) ? href : text;
}

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Cuts `text` after `maxWords` words, noting the cut, or returns it unchanged. */
export function truncateWords(text: string, maxWords: number): string {
  const words = /\S+/g;
  let count = 0;
  for (let match = words.exec(text); match; match = words.exec(text)) {
    count++;
    if (count === maxWords) {
      const end = match.index + match[0].length;
      if (!/\S/.test(text.slice(end))) return text;
      return `${text.slice(0, end)} …\n\n[Truncated after ${maxWords.toLocaleString('en-US')} words.]`;
    }
  }
  return text;
}
