/**
 * Flash safety (Round 09). WCAG 2.3.1: no more than three flashes in any one-second period, and
 * saturated red flashes are avoided. The guard is a sliding window over accepted flash times.
 */
import { MAX_FLASHES_PER_SECOND } from './timing';

export class FlashGuard {
  private times: number[] = [];
  constructor(
    private readonly max = MAX_FLASHES_PER_SECOND,
    private readonly window = 1,
  ) {}

  /** True (and the flash is counted) when a flash at time t keeps the window under the limit. */
  allow(t: number): boolean {
    this.times = this.times.filter((x) => t - x < this.window && x <= t);
    if (this.times.length >= this.max) return false;
    this.times.push(t);
    return true;
  }

  reset() {
    this.times = [];
  }
}

/** Saturated red (red share above 80 %) is pulled towards orange-white before it is flashed. */
export function guardRed(c: readonly [number, number, number]): [number, number, number] {
  const sum = c[0] + c[1] + c[2];
  if (sum <= 0 || c[0] / sum <= 0.8) return [c[0], c[1], c[2]];
  const k = 0.5;
  return [c[0], c[1] + (c[0] * 0.55 - c[1]) * k, c[2] + (c[0] * 0.35 - c[2]) * k];
}
