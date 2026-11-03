/** Just enough WAV handling to join a segment's chunks and time them: 16-bit PCM only. */

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface Pcm {
  format: PcmFormat;
  /** Interleaved little-endian samples. */
  data: Buffer;
}

/** Reads a RIFF/WAVE file's format and sample data. Throws on anything but uncompressed PCM. */
export function parseWav(bytes: Uint8Array): Pcm {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Not a WAV file');
  }
  let format: PcmFormat | undefined;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(body);
      // 1 is PCM; 0xfffe (WAVE_FORMAT_EXTENSIBLE) also carries PCM in the files we handle.
      if (audioFormat !== 1 && audioFormat !== 0xfffe) {
        throw new Error(`Unsupported WAV encoding ${audioFormat}`);
      }
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data before its format');
      // Streamed WAVs may give a placeholder size; take what is actually there.
      const end = Math.min(buffer.length, body + size);
      return { format, data: buffer.subarray(body, end) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data');
}

export function encodeWav({ format, data }: Pcm): Buffer {
  const { sampleRate, channels, bitsPerSample } = format;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function pcmDurationSec({ format, data }: Pcm): number {
  const bytesPerSecond = (format.sampleRate * format.channels * format.bitsPerSample) / 8;
  return data.length / bytesPerSecond;
}

/** Joins PCM chunks of the same format, with `gapSec` of silence between them. */
export function joinPcm(chunks: Pcm[], gapSec = 0): Pcm {
  const [first] = chunks;
  if (!first) throw new Error('Nothing to join');
  const { format } = first;
  for (const chunk of chunks) {
    if (
      chunk.format.sampleRate !== format.sampleRate ||
      chunk.format.channels !== format.channels ||
      chunk.format.bitsPerSample !== format.bitsPerSample
    ) {
      throw new Error('Cannot join WAV chunks with different formats');
    }
  }
  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const gap = Buffer.alloc(Math.round(gapSec * format.sampleRate) * blockAlign);
  const parts = chunks.flatMap((chunk, i) => (i === 0 ? [chunk.data] : [gap, chunk.data]));
  return { format, data: Buffer.concat(parts) };
}
