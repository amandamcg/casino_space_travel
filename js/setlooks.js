/**
 * Set looks that change on their own.
 *
 * A set is the mapped regions (spots) sharing one link letter, A to F, which show one
 * look between them. In the show each set takes a new random look now and then, each set
 * at its own pace, so they never change together; and all of it is relative to how fast
 * the show moves from one design to the next, so a slow show has slow sets and the toy,
 * which hurries the morph, hurries them too. Amanda, 2026-10-05: "set looks should be
 * more randomly generated and changing at a faster speed than the background, so the
 * sets are each changing looks regularly, all at diff speeds. make it relative to the
 * overall speed".
 *
 * The looks designed in the room composer are what the show starts from; the random ones
 * live only in the page and are never written back to the calibration.
 */

import { randomVariant } from "./mapping.js";

// A set never takes a new look sooner than this after its last, however hard the toy is
// played: nothing in the room may strobe (SPEC.md).
export const LEAST_SECS = 4;

// Each set's own pace, as a share of the common one. Spread out so that no two sets fall
// into step for long.
export const PACES = { A: 1, B: 1.45, C: 0.8, D: 1.7, E: 1.15, F: 0.62 };

/** How long one design lasts on average: a morph and then a hold, in seconds. */
export function designSecs(S) {
  const mid = (lo, hi) => (Number(lo) + Number(hi)) / 2;
  return mid(S.morphMin ?? 60, S.morphMax ?? 150) + mid(S.holdMin ?? 20, S.holdMax ?? 90);
}

export class SetLooks {
  /** @param {() => number} random  a source of numbers in [0, 1) */
  constructor(random = Math.random) {
    this.random = random;
    this.sets = new Map();
  }

  /** Which sets are in play: the link letters the regions use. Others are forgotten. */
  setRegions(regions) {
    const used = new Set(regions.map((r) => r.link).filter((link) => link && PACES[link]));
    for (const link of [...this.sets.keys()]) if (!used.has(link)) this.sets.delete(link);
    for (const link of used) {
      // Starting part way through its first wait, so the sets do not all change at once.
      if (!this.sets.has(link)) this.sets.set(link, { phase: this.random() * 0.8, since: LEAST_SECS, least: LEAST_SECS });
    }
  }

  /**
   * Time passes. `S` holds the show's settings (setChange and the morph and hold times),
   * `boost` is how much faster the toy is making the morph run just now.
   * Returns the sets that take a new look this step: [{ link, variant }, ...].
   */
  update(dt, S, boost = 1) {
    const changes = [];
    const rate = Number(S.setChange ?? 0);
    if (!(rate > 0) || !(dt > 0)) return changes;
    const common = designSecs(S) / rate; // seconds between changes, before each set's own pace
    for (const [link, set] of this.sets) {
      set.since += dt;
      set.phase += (dt * boost * PACES[link]) / Math.max(common, LEAST_SECS);
      if (set.phase < 1 || set.since < set.least) continue;
      // Not like clockwork: the next wait is a little shorter or longer than the last. The
      // least wait varies too, so sets held back by it do not fall into step.
      set.phase = this.random() * 0.5 - 0.25;
      set.since = 0;
      set.least = LEAST_SECS * (1 + this.random() * 0.6);
      changes.push({ link, variant: randomVariant(this.random) });
    }
    return changes;
  }
}
