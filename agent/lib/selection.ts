import type { Selection } from '@upvoted/features/script';
import { defineState } from 'eve/context';

/**
 * The stories get_top_stories picked in this session. check_script and publish_episode accept
 * only a script about exactly these, so the agent can't swap in a story of its own.
 */
export const selection = defineState<Selection | null>('upvoted.selection', () => null);
