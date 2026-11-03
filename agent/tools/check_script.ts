import { checkScript } from '@upvoted/features/script';
import { defineTool } from 'eve/tools';
import { ScriptInputSchema } from '../lib/script-input';
import { selection } from '../lib/selection';

export default defineTool({
  description:
    'Checks a finished script without publishing anything: the running order, who speaks where, ' +
    'no URLs or markdown in the text, allowed cues, and that it covers exactly the stories ' +
    'get_top_stories picked. Returns ok, or the problems to fix. Call it until it returns ok.',
  inputSchema: ScriptInputSchema,
  execute({ script, storyIds }) {
    const problems = checkScript(script, storyIds, selection.get());
    console.log(`check_script: ${problems.length === 0 ? 'ok' : `${problems.length} problems`}`);
    return problems.length === 0 ? { ok: true as const } : { ok: false as const, problems };
  },
});
