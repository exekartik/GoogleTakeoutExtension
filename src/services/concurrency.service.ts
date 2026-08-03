import os from 'node:os';
import pLimit, { LimitFunction } from 'p-limit';

export class ConcurrencyService {
  private static limitInstance: LimitFunction;

  /**
   * Returns a shared p-limit queue based on the host CPU cores count.
   * Ensures disk I/O and processing do not overwhelm system file handles (EMFILE).
   */
  static getLimit(concurrency?: number): LimitFunction {
    if (!this.limitInstance) {
      const defaultConcurrency = Math.max(2, Math.min(os.cpus().length * 2, 32));
      this.limitInstance = pLimit(concurrency ?? defaultConcurrency);
    }
    return this.limitInstance;
  }
}
