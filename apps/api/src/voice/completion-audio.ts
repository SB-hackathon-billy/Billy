import { VOICE_COMPLETION_NOTICE } from '@sb/contracts';

const normalize = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');
const expected = normalize(VOICE_COMPLETION_NOTICE);
type Range = { startMs: number; endMs: number };
const validRange = (range: Range) =>
  Number.isFinite(range.startMs) &&
  Number.isFinite(range.endMs) &&
  range.startMs >= 0 &&
  range.endMs > range.startMs;

/** Bounded, in-memory assistant audio only. Live sideband PCM and transcript share
 * a session timeline. Never infer playback completion from a transcript or silence. */
export class CompletionAudio {
  private chunks: (Range & { data: Buffer })[] = [];
  private words: (Range & { text: string })[] = [];
  private bytes = 0;
  private failed = false;
  private cached: string | null = null;
  addAudio(range: Range, base64: string) {
    if (this.cached || this.failed || !validRange(range)) return;
    const data = Buffer.from(base64, 'base64');
    // Reflected audio is PCM16 mono 24 kHz: 48 bytes per millisecond.
    if (data.length % 2 || Math.abs(data.length / 48 - (range.endMs - range.startMs)) > 1) {
      this.failed = true;
      this.chunks = [];
      this.words = [];
      return;
    }
    this.bytes += data.length;
    if (this.bytes > 30 * 24_000 * 2) {
      this.failed = true;
      this.chunks = [];
      this.words = [];
      return;
    }
    this.chunks.push({ ...range, data });
  }
  addTranscript(range: Range, text: string) {
    if (this.cached || this.failed || !validRange(range)) return;
    if (this.words.length >= 500) {
      this.failed = true;
      this.chunks = [];
      this.words = [];
      return;
    }
    this.words.push({ ...range, text: normalize(text).slice(0, 1000) });
  }
  diagnostics() {
    return {
      audioChunks: this.chunks.length,
      audioBytes: this.bytes,
      transcriptFragments: this.words.length,
      noticeMatched: this.words
        .map((w) => w.text)
        .join('')
        .includes(expected),
      failed: this.failed,
      ready: this.cached !== null,
      audioStart: this.chunks[0]?.startMs ?? -1,
      audioEnd: this.chunks.at(-1)?.endMs ?? -1,
      transcriptStart: this.words[0]?.startMs ?? -1,
      transcriptEnd: this.words.at(-1)?.endMs ?? -1,
    };
  }
  wav(): string | null {
    if (this.cached) return this.cached;
    if (this.failed || !this.chunks.length) return null;
    const text = this.words.map((w) => w.text).join('');
    const offset = text.indexOf(expected);
    if (offset < 0) return null;
    let cursor = 0;
    const words = this.words.filter((word) => {
      const start = cursor;
      cursor += word.text.length;
      return cursor > offset && start < offset + expected.length;
    });
    if (!words.length || this.chunks[0]!.startMs > words[0]!.startMs) return null;
    const start = Math.max(this.chunks[0]!.startMs, words[0]!.startMs - 100);
    const speechEnd = words.at(-1)!.endMs;
    // Extra tail is optional: some streams omit silent output frames.
    const end = Math.min(speechEnd + 250, Math.max(speechEnd, this.chunks.at(-1)!.endMs));
    if (end - start < 1000 || end - start > 30_000) return null;
    const parts: Buffer[] = [];
    let covered = start;
    for (const chunk of this.chunks) {
      if (chunk.endMs <= covered) continue;
      // Reject gaps. A dropped frame cannot be replaced by unrelated audio.
      if (chunk.startMs > covered + 0.1) return null;
      const until = Math.min(end, chunk.endMs);
      const fromSample = Math.round((covered - chunk.startMs) * 24);
      const toSample = Math.round((until - chunk.startMs) * 24);
      parts.push(chunk.data.subarray(fromSample * 2, toSample * 2));
      covered = until;
      if (covered >= end) break;
    }
    if (covered < end) return null;
    const pcm = Buffer.concat(parts);
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(24_000, 24);
    header.writeUInt32LE(48_000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    this.cached = Buffer.concat([header, pcm]).toString('base64');
    this.chunks = [];
    this.words = [];
    return this.cached;
  }
}
