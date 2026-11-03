import { localDev, vercelOidc } from 'eve/channels/auth';
import { eveChannel } from 'eve/channels/eve';

// eve's own HTTP API (/eve/v1/*), for the terminal UI: this project's Vercel OIDC tokens, or a
// local dev server. Episode runs start at POST /api/episode instead (channels/episode.ts).
export default eveChannel({ auth: [vercelOidc(), localDev()] });
