import { webSearch } from 'eve/tools/web_search';

// Anthropic's own web search, run through AI Gateway with the deployment's OIDC credentials.
export default webSearch({ provider: 'native' });
