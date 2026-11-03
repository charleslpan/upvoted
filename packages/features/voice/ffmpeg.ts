import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const run = promisify(execFile);

/**
 * The ffmpeg binary: `FFMPEG_BIN` if set, else the one `ffmpeg-static` downloaded on install.
 * On Vercel the binary has to be traced into the function; see AGENTS.md.
 */
export function ffmpegPath(): string {
  const bin = process.env.FFMPEG_BIN || ffmpegStatic;
  if (!bin || !existsSync(bin)) {
    throw new Error(
      `No ffmpeg binary at ${bin ?? '(none for this platform)'}. Reinstall ffmpeg-static ` +
        '(its install script downloads it) or set FFMPEG_BIN.',
    );
  }
  return bin;
}

/** Runs ffmpeg and resolves with its log (stderr). Rejects with the log's tail on failure. */
export async function ffmpeg(args: string[], timeoutMs = 240_000): Promise<string> {
  try {
    const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return stderr;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    const tail = stderr.trim().split('\n').slice(-15).join('\n');
    throw new Error(`ffmpeg failed: ${(error as Error).message}\n${tail}`);
  }
}

/** The first line of `ffmpeg -version`, for the health route. */
export async function ffmpegVersion(): Promise<string> {
  const { stdout } = await run(ffmpegPath(), ['-version'], { timeout: 10_000 });
  return stdout.split('\n')[0]?.trim() ?? '';
}
