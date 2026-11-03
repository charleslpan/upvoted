import { config } from '@upvoted/lib/config';
import type { Segment } from '@upvoted/types';
import { describe, expect, it } from 'vitest';
import { segmentSpeakers, styleForCue, toTurn } from './speech';

describe('styleForCue', () => {
  it('ignores case and surrounding spaces', () => {
    expect(styleForCue(' Excited ')).toBe(styleForCue('excited'));
  });

  it('passes any other cue through as the style', () => {
    expect(styleForCue('mock-indignant')).toBe('mock-indignant');
  });

  it('leaves a line with no cue to the show-wide style', () => {
    expect(styleForCue(undefined)).toBeUndefined();
    expect(styleForCue('  ')).toBeUndefined();
  });
});

describe('toTurn', () => {
  it("gives a turn the cue's style only when there is a cue", () => {
    expect(toTurn({ speaker: 'Maya', text: 'Ha!', cue: 'laughs' })).toEqual({
      speaker: 'Maya',
      text: 'Ha!',
      style: styleForCue('laughs'),
    });
    expect(toTurn({ speaker: 'Theo', text: 'Hello.' })).toEqual({
      speaker: 'Theo',
      text: 'Hello.',
    });
  });
});

describe('segmentSpeakers', () => {
  const { host, correspondents } = config.cast;
  const line = (speaker: string) => ({ speaker, text: 'Hello.' });

  it('gives a host-only segment the host alone', () => {
    const intro: Segment = { kind: 'intro', storyId: null, lines: [line(host.name)] };
    expect(segmentSpeakers(intro)).toEqual([{ name: host.name, voice: host.voice }]);
  });

  it("gives a story the host and its correspondent, host first, with the cast's voices", () => {
    const [, nadia] = correspondents;
    const story: Segment = {
      kind: 'story',
      storyId: 1,
      lines: [line(nadia.name), line(host.name), line(nadia.name)],
    };
    expect(segmentSpeakers(story)).toEqual([
      { name: host.name, voice: host.voice },
      { name: nadia.name, voice: nadia.voice },
    ]);
  });

  it('gives every cast member their own voice', () => {
    const voices = [host, ...correspondents].map((member) => member.voice);
    expect(new Set(voices).size).toBe(4);
  });
});
