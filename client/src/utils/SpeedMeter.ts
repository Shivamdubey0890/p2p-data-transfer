/** Rolling-window transfer speed estimator. */
export class SpeedMeter {
  private samples: Array<{ t: number; bytes: number }> = [];

  constructor(private readonly windowMs = 5000) {}

  record(totalBytes: number): void {
    const now = performance.now();
    this.samples.push({ t: now, bytes: totalBytes });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }

  /** Bytes per second over the sampling window. */
  speed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return 0;
    return (last.bytes - first.bytes) / dt;
  }

  eta(remainingBytes: number): number {
    const s = this.speed();
    return s > 0 ? remainingBytes / s : Infinity;
  }

  reset(): void {
    this.samples = [];
  }
}
