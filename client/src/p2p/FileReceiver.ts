import { ACK_EVERY_N_CHUNKS, FileOfferMessage, TransferStatus } from '@shared/protocol';

type SendControl = (message: object) => void;

/**
 * Receives one file from a DataChannel.
 *
 * Persistence strategy:
 *  - Chromium: File System Access API - the user picks a destination on
 *    accept and chunks stream straight to disk (10GB+ works, low memory).
 *  - Fallback (Firefox/Safari): chunks accumulate in memory and download as a
 *    Blob on completion (fine for files that fit comfortably in RAM).
 */
export class FileReceiver {
  status: TransferStatus = 'pending';
  receivedBytes = 0;
  private expectedChunkIndex = 0;
  private writable: FileSystemWritableFileStream | null = null;
  private memoryParts: ArrayBuffer[] = [];
  private useDisk = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastProgressEmit = 0;
  private chunksSinceAck = 0;

  /** Wired by the P2P manager before accept() is called. */
  onProgress: (bytesReceived: number) => void = () => {};
  onStatusChange: (status: TransferStatus, error?: string) => void = () => {};

  constructor(
    public offer: FileOfferMessage,
    private readonly sendControl: SendControl
  ) {}

  /**
   * Re-arm a failed receiver for a retried offer of the same transferId.
   * Keeps receivedBytes and the open writable so only missing bytes resend.
   */
  prepareRetry(offer: FileOfferMessage): void {
    this.offer = offer;
    this.status = 'pending';
    this.expectedChunkIndex = Math.floor(this.receivedBytes / offer.chunkSize);
    this.chunksSinceAck = 0;
  }

  /**
   * Must be called from a user gesture (the Accept button click).
   * With `directory` set (batch accept), the file is created inside that
   * folder — no per-file save dialog.
   */
  async accept(directory?: FileSystemDirectoryHandle): Promise<void> {
    if (this.writable) {
      // Resuming a retry — destination already chosen and partially written.
      this.useDisk = true;
    } else if (directory) {
      try {
        const safeName = this.offer.fileName.replace(/[\\/:*?"<>|]/g, '_') || 'file';
        const handle = await directory.getFileHandle(safeName, { create: true });
        this.writable = await handle.createWritable();
        this.useDisk = true;
      } catch {
        this.useDisk = false; // folder write failed, fall back to memory
      }
    } else if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: this.offer.fileName,
        });
        this.writable = await handle.createWritable();
        this.useDisk = true;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          this.reject('Receiver cancelled the save dialog');
          return;
        }
        this.useDisk = false; // picker unavailable, fall back to memory
      }
    }
    this.status = 'transferring';
    this.onStatusChange('transferring');
    this.sendControl({
      type: 'file-accept',
      transferId: this.offer.transferId,
      resumeFrom: this.receivedBytes,
    });
    // Zero-byte files have no chunks — finalize immediately.
    if (this.offer.fileSize === 0) {
      this.writeQueue = this.writeQueue
        .then(() => this.finalize())
        .catch((err) => this.fail(err instanceof Error ? err.message : 'Write failed'));
    }
  }

  reject(reason: string): void {
    this.status = 'cancelled';
    this.onStatusChange('cancelled', reason);
    this.sendControl({ type: 'file-reject', transferId: this.offer.transferId, reason });
  }

  handleChunk(chunkIndex: number, data: ArrayBuffer): void {
    if (this.status !== 'transferring' && this.status !== 'paused') return;
    if (chunkIndex !== this.expectedChunkIndex) {
      // Channel is ordered+reliable, so this indicates protocol corruption.
      this.fail(`Out-of-order chunk: expected ${this.expectedChunkIndex}, got ${chunkIndex}`);
      return;
    }
    this.expectedChunkIndex++;

    // Serialize async disk writes; DataChannel events arrive synchronously.
    this.writeQueue = this.writeQueue
      .then(async () => {
        if (this.useDisk && this.writable) {
          await this.writable.write(data);
        } else {
          this.memoryParts.push(data);
        }
        this.receivedBytes += data.byteLength;
        this.emitProgress();

        if (++this.chunksSinceAck >= ACK_EVERY_N_CHUNKS) {
          this.chunksSinceAck = 0;
          this.sendControl({
            type: 'chunk-ack',
            transferId: this.offer.transferId,
            receivedBytes: this.receivedBytes,
          });
        }
        if (this.receivedBytes >= this.offer.fileSize) {
          await this.finalize();
        }
      })
      .catch((err) => this.fail(err instanceof Error ? err.message : 'Write failed'));
  }

  private async finalize(): Promise<void> {
    if (this.useDisk && this.writable) {
      await this.writable.close();
      this.writable = null;
    } else {
      const blob = new Blob(this.memoryParts, { type: this.offer.mimeType || 'application/octet-stream' });
      this.memoryParts = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.offer.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    this.sendControl({ type: 'file-complete', transferId: this.offer.transferId });
    this.status = 'completed';
    this.onProgress(this.receivedBytes);
    this.onStatusChange('completed');
  }

  private emitProgress(force = false): void {
    const now = performance.now();
    if (force || now - this.lastProgressEmit > 200) {
      this.lastProgressEmit = now;
      this.onProgress(this.receivedBytes);
    }
  }

  /** Pause asks the SENDER to stop pushing; we keep draining what's in flight. */
  pause(local: boolean): void {
    if (this.status !== 'transferring') return;
    this.status = 'paused';
    this.onStatusChange('paused');
    if (local) this.sendControl({ type: 'pause', transferId: this.offer.transferId });
  }

  resume(local: boolean): void {
    if (this.status !== 'paused') return;
    this.status = 'transferring';
    this.onStatusChange('transferring');
    if (local) this.sendControl({ type: 'resume', transferId: this.offer.transferId });
  }

  cancel(local: boolean, channelOpen: boolean): void {
    if (this.status === 'completed' || this.status === 'cancelled') return;
    this.status = 'cancelled';
    this.onStatusChange('cancelled');
    if (local && channelOpen) {
      this.sendControl({ type: 'cancel', transferId: this.offer.transferId });
    }
    void this.discard();
  }

  fail(error: string): void {
    if (this.status === 'completed') return;
    this.status = 'failed';
    this.onStatusChange('failed', error);
    // Keep `writable` open and receivedBytes intact: a retry offer with the
    // same transferId can resume from where we stopped.
  }

  private async discard(): Promise<void> {
    try {
      await this.writable?.abort();
    } catch {
      /* already closed */
    }
    this.writable = null;
    this.memoryParts = [];
  }
}

