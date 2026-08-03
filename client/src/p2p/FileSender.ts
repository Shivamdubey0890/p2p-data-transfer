import {
  BUFFERED_AMOUNT_HIGH,
  BUFFERED_AMOUNT_LOW,
  TransferStatus,
  encodeChunk,
} from '@shared/protocol';

type SendControl = (message: object) => void;

/**
 * One-at-a-time gate shared by all senders on a channel. Many concurrent
 * senders racing the same bufferedAmount check can overflow the SCTP send
 * buffer (Chrome hard-closes the channel at ~16 MB). Sequential sending is
 * also faster per file and keeps progress readable.
 */
export class SendScheduler {
  private queue: Array<() => void> = [];
  private busy = false;

  acquire(): Promise<void> {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.busy = false;
  }
}

/**
 * Streams one file into a DataChannel with backpressure.
 *
 * Never loads the whole file in memory: reads `chunkSize` slices from disk on
 * demand and stops pushing whenever the channel's send buffer exceeds
 * BUFFERED_AMOUNT_HIGH, resuming on the `bufferedamountlow` event. That is
 * what makes 10GB+ transfers possible in a browser tab.
 */
export class FileSender {
  status: TransferStatus = 'pending';
  private offset = 0;
  private chunkIndex = 0;
  private cancelled = false;
  private paused = false;
  private resumeWaiters: Array<() => void> = [];
  /** Contiguous bytes the receiver confirmed persisting (used for resume). */
  ackedBytes = 0;
  private lastProgressEmit = 0;

  /** Wired by the P2P manager right after construction. */
  onProgress: (bytesSent: number) => void = () => {};
  onStatusChange: (status: TransferStatus, error?: string) => void = () => {};

  constructor(
    readonly transferId: string,
    readonly key: number,
    readonly file: File,
    private readonly channel: RTCDataChannel,
    private readonly chunkSize: number,
    private readonly sendControl: SendControl,
    private readonly scheduler: SendScheduler
  ) {}

  /** Called when the receiver sends file-accept. */
  start(resumeFrom: number): void {
    this.offset = Math.min(resumeFrom, this.file.size);
    this.chunkIndex = Math.floor(this.offset / this.chunkSize);
    this.run().catch((err) => this.fail(err instanceof Error ? err.message : 'Send failed'));
  }

  private async run(): Promise<void> {
    // Files queue up and stream one at a time over the shared channel.
    await this.scheduler.acquire();
    try {
      if (this.cancelled) return;
      this.setStatus('transferring');
      this.channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;

      while (this.offset < this.file.size) {
        if (this.cancelled) return;
        if (this.paused) {
          await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
          continue; // re-check cancelled/paused after waking
        }
        if (this.channel.readyState !== 'open') {
          this.fail('Connection lost during transfer');
          return;
        }
        if (this.channel.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
          await this.waitForDrain();
          continue;
        }

        const end = Math.min(this.offset + this.chunkSize, this.file.size);
        const data = await this.file.slice(this.offset, end).arrayBuffer();
        if (this.cancelled) return;
        // Re-check after the async read — the buffer may have filled meanwhile.
        while (this.channel.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
          await this.waitForDrain();
          if (this.cancelled) return;
        }
        if (this.channel.readyState !== 'open') {
          this.fail('Connection lost during transfer');
          return;
        }
        try {
          this.channel.send(encodeChunk(this.key, this.chunkIndex, data));
        } catch (err) {
          this.fail(err instanceof Error ? err.message : 'Channel send failed');
          return;
        }
        this.offset = end;
        this.chunkIndex++;
        this.emitProgress();
      }
      this.onProgress(this.offset);
      // Stay in 'transferring' until the receiver confirms with file-complete.
    } finally {
      this.scheduler.release();
    }
  }

  private waitForDrain(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.channel.removeEventListener('bufferedamountlow', done);
        resolve();
      };
      this.channel.addEventListener('bufferedamountlow', done);
      // Safety net: also poll in case the event is missed (e.g. channel closed).
      setTimeout(done, 2000);
    });
  }

  private emitProgress(force = false): void {
    const now = performance.now();
    if (force || now - this.lastProgressEmit > 200) {
      this.lastProgressEmit = now;
      this.onProgress(this.offset);
    }
  }

  /** local=true when this side clicked the button (notify the peer). */
  pause(local: boolean): void {
    if (this.status !== 'transferring') return;
    this.paused = true;
    this.setStatus('paused');
    if (local) this.sendControl({ type: 'pause', transferId: this.transferId });
  }

  resume(local: boolean): void {
    if (this.status !== 'paused') return;
    this.paused = false;
    this.setStatus('transferring');
    if (local) this.sendControl({ type: 'resume', transferId: this.transferId });
    this.wake();
  }

  cancel(local: boolean): void {
    if (this.status === 'completed' || this.status === 'cancelled') return;
    this.cancelled = true;
    this.setStatus('cancelled');
    if (local && this.channel.readyState === 'open') {
      this.sendControl({ type: 'cancel', transferId: this.transferId });
    }
    this.wake();
  }

  handleAck(receivedBytes: number): void {
    this.ackedBytes = Math.max(this.ackedBytes, receivedBytes);
  }

  handleComplete(): void {
    this.emitProgress(true);
    this.setStatus('completed');
  }

  handleReject(reason: string): void {
    this.cancelled = true;
    this.fail(`Rejected by receiver: ${reason}`);
  }

  fail(error: string): void {
    if (this.status === 'completed' || this.status === 'cancelled') return;
    this.cancelled = true;
    this.onStatusChange('failed', error);
    this.status = 'failed';
    this.wake();
  }

  private wake(): void {
    this.resumeWaiters.splice(0).forEach((fn) => fn());
  }

  private setStatus(status: TransferStatus): void {
    this.status = status;
    this.onStatusChange(status);
  }
}
