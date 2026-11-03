import { defineSandbox } from 'eve/sandbox';
import { JustBashSandbox } from 'eve/sandbox/just-bash';

// The agent runs no commands and keeps no files (defaultTools is off), so it needs no Vercel
// Sandbox VM: this in-process one costs nothing and has no template to prewarm at build time.
export const environment = JustBashSandbox.environment({ autoInstall: false });
export default defineSandbox(() => environment.open());
