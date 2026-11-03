import { describe, expect, it } from 'vitest';
import { countWords, htmlToText, truncateWords } from './text';

describe('htmlToText', () => {
  it("handles HN's comment markup", () => {
    const html =
      'First &quot;point&quot; isn&#x27;t new.<p>&gt; quoted line<p>See <a href="https:&#x2F;&#x2F;example.com&#x2F;a&#x2F;very&#x2F;long&#x2F;path" rel="nofollow">https:&#x2F;&#x2F;example.com&#x2F;a&#x2F;very...</a> and <i>this</i>.';

    expect(htmlToText(html)).toBe(
      'First "point" isn\'t new.\n\n> quoted line\n\nSee https://example.com/a/very/long/path and this.',
    );
  });

  it('keeps link text that is not a shortened URL', () => {
    expect(htmlToText('<a href="https://example.com">the docs</a>')).toBe('the docs');
  });

  it('keeps line breaks in code blocks', () => {
    expect(htmlToText('Try:<p><pre><code>  a = 1\n  b = 2\n</code></pre>')).toBe(
      'Try:\n\na = 1\nb = 2',
    );
  });

  it('drops scripts and styles, and separates blocks with blank lines', () => {
    const html =
      '<h1>Title</h1><style>p{}</style><p>One  two\n three.</p><script>alert(1)</script><ul><li>a</li><li>b</li></ul>';
    expect(htmlToText(html)).toBe('Title\n\nOne two three.\n\n- a\n\n- b');
  });
});

describe('truncateWords', () => {
  it('leaves short text alone', () => {
    expect(truncateWords('one two three', 3)).toBe('one two three');
  });

  it('cuts after the word limit and says so', () => {
    const text = truncateWords('one two\n\nthree four five', 3);
    expect(text).toBe('one two\n\nthree …\n\n[Truncated after 3 words.]');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('  one two\n\nthree ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});
