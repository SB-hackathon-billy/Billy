import type { VoiceCompletion } from '@sb/contracts';

/** One finite, server-verified WAV. Only this element's natural ended event can
 * authorize completion; cancellation, pause, blocked playback and errors cannot. */
export class CompletionPlayback {
  private audio: HTMLAudioElement | null = null;
  private played = false;
  private consumed = false;
  private cancelled = false;
  readonly createdAt = Date.now();
  loading = false;
  started = false;
  constructor(readonly completion: VoiceCompletion) {}
  get failed() {
    return this.cancelled;
  }
  async start(wav: string): Promise<void> {
    if (this.cancelled || this.started) return;
    this.started = true;
    const audio = new Audio(`data:audio/wav;base64,${wav}`);
    this.audio = audio;
    audio.setAttribute('playsinline', '');
    audio.onended = () => {
      if (!this.cancelled && audio.ended && !audio.muted && audio.volume > 0) this.played = true;
    };
    audio.onpause = () => {
      if (!audio.ended) this.cancel();
    };
    audio.onerror = () => this.cancel();
    try {
      await audio.play();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  take(): VoiceCompletion | null {
    if (!this.played || this.cancelled || this.consumed) return null;
    this.consumed = true;
    return this.completion;
  }
  cancel() {
    this.cancelled = true;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onpause = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
  }
}
