import { config } from '@upvoted/lib/config';
import { describe, expect, it } from 'vitest';
import { dialogueRequest, styleForCue, toTurn } from './speech';

describe('styleForCue', () => {
  it('expands the common cues into fuller directions', () => {
    expect(styleForCue('laughs')).toBe('laughing warmly as you speak');
    expect(styleForCue(' Excited ')).toBe('excited and energetic');
    expect(styleForCue('interrupting')).toBe('cutting in quickly, overlapping the other host');
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
  it("maps a line to a turn, with the cue's style only when there is a cue", () => {
    expect(toTurn({ speaker: 'Maya', text: 'Ha!', cue: 'laughs' })).toEqual({
      speaker: 'Maya',
      text: 'Ha!',
      style: 'laughing warmly as you speak',
    });
    expect(toTurn({ speaker: 'Theo', text: 'Hello.' })).toEqual({
      speaker: 'Theo',
      text: 'Hello.',
    });
  });
});

describe('dialogueRequest', () => {
  it("gives each host their configured voice and uses the show's style", () => {
    const request = dialogueRequest([]);
    expect(request.speakers).toEqual([
      { name: config.hosts[0].name, voice: config.hosts[0].voice },
      { name: config.hosts[1].name, voice: config.hosts[1].voice },
    ]);
    expect(new Set(request.speakers.map((s) => s.voice)).size).toBe(2);
    expect(request.instructions).toBe(config.tts.style);
  });
});
