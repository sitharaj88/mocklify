import { describe, it, expect } from 'vitest';
import {
  decideChaos,
  CHAOS_DEFAULT_FAILURE_STATUS,
  CHAOS_MAX_DELAY_MS,
} from '../src/servers/HttpMockServer.js';
import { ChaosConfig } from '../src/types/core.js';

/** Deterministic random source that returns queued values in order. */
function seeded(...values: number[]): () => number {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('random() called more times than expected');
    }
    return next;
  };
}

describe('decideChaos', () => {
  it('is a no-op when chaos is absent', () => {
    expect(decideChaos(undefined, seeded())).toEqual({ delayMs: 0, failure: null });
  });

  it('is a no-op when chaos is disabled, even with aggressive settings', () => {
    const chaos: ChaosConfig = {
      enabled: false,
      failureRate: 1,
      minDelayMs: 100,
      maxDelayMs: 200,
    };
    // seeded() with no values throws if random is consumed — disabled must not roll
    expect(decideChaos(chaos, seeded())).toEqual({ delayMs: 0, failure: null });
  });

  it('does nothing when enabled with no rate or delay configured', () => {
    expect(decideChaos({ enabled: true }, seeded())).toEqual({ delayMs: 0, failure: null });
  });

  describe('failure rate boundaries', () => {
    it('never fails at rate 0 and does not consume random', () => {
      const result = decideChaos({ enabled: true, failureRate: 0 }, seeded());
      expect(result.failure).toBeNull();
    });

    it('always fails at rate 1, even at the top of the random range', () => {
      const result = decideChaos({ enabled: true, failureRate: 1 }, seeded(0.999999));
      expect(result.failure).toEqual({
        statusCode: CHAOS_DEFAULT_FAILURE_STATUS,
        body: { error: 'Simulated failure (Mocklify chaos)', chaos: true },
      });
    });

    it('fails when the roll is below the rate and passes when at or above it', () => {
      const chaos: ChaosConfig = { enabled: true, failureRate: 0.3 };
      expect(decideChaos(chaos, seeded(0.29)).failure).not.toBeNull();
      expect(decideChaos(chaos, seeded(0.3)).failure).toBeNull();
      expect(decideChaos(chaos, seeded(0.31)).failure).toBeNull();
    });

    it('uses the configured failure status', () => {
      const result = decideChaos(
        { enabled: true, failureRate: 1, failureStatus: 500 },
        seeded(0.5)
      );
      expect(result.failure?.statusCode).toBe(500);
    });

    it('clamps out-of-range rates', () => {
      expect(decideChaos({ enabled: true, failureRate: 5 }, seeded(0.99)).failure).not.toBeNull();
      expect(decideChaos({ enabled: true, failureRate: -1 }, seeded()).failure).toBeNull();
    });
  });

  describe('delay bounds', () => {
    it('interpolates uniformly across [min, max]', () => {
      const chaos: ChaosConfig = { enabled: true, minDelayMs: 100, maxDelayMs: 500 };
      expect(decideChaos(chaos, seeded(0)).delayMs).toBe(100);
      expect(decideChaos(chaos, seeded(0.5)).delayMs).toBe(300);
      expect(decideChaos(chaos, seeded(0.999999)).delayMs).toBe(500); // rounded
    });

    it('treats a lone maxDelayMs as [0, max]', () => {
      const chaos: ChaosConfig = { enabled: true, maxDelayMs: 400 };
      expect(decideChaos(chaos, seeded(0)).delayMs).toBe(0);
      expect(decideChaos(chaos, seeded(0.25)).delayMs).toBe(100);
    });

    it('treats a lone minDelayMs as a fixed delay', () => {
      const chaos: ChaosConfig = { enabled: true, minDelayMs: 250 };
      expect(decideChaos(chaos, seeded(0.7)).delayMs).toBe(250);
    });

    it('clamps inverted bounds to min', () => {
      const chaos: ChaosConfig = { enabled: true, minDelayMs: 500, maxDelayMs: 100 };
      expect(decideChaos(chaos, seeded(0.9)).delayMs).toBe(500);
    });

    it('clamps a negative min to 0', () => {
      const chaos: ChaosConfig = { enabled: true, minDelayMs: -50, maxDelayMs: 100 };
      expect(decideChaos(chaos, seeded(0)).delayMs).toBe(0);
    });

    it('caps an unbounded delay at CHAOS_MAX_DELAY_MS so a hostile config cannot hang requests', () => {
      const chaos: ChaosConfig = { enabled: true, minDelayMs: 2_000_000_000 };
      expect(decideChaos(chaos, seeded(0.9)).delayMs).toBe(CHAOS_MAX_DELAY_MS);
      const wide: ChaosConfig = { enabled: true, minDelayMs: 0, maxDelayMs: 2_000_000_000 };
      expect(decideChaos(wide, seeded(1)).delayMs).toBeLessThanOrEqual(CHAOS_MAX_DELAY_MS);
    });
  });

  it('draws random for the delay first, then for the failure roll', () => {
    const chaos: ChaosConfig = {
      enabled: true,
      failureRate: 0.5,
      minDelayMs: 0,
      maxDelayMs: 1000,
    };
    // First value drives the delay, second drives the failure roll
    const result = decideChaos(chaos, seeded(0.2, 0.4));
    expect(result.delayMs).toBe(200);
    expect(result.failure).not.toBeNull();

    const pass = decideChaos(chaos, seeded(0.2, 0.6));
    expect(pass.delayMs).toBe(200);
    expect(pass.failure).toBeNull();
  });

  it('can combine delay and failure in one decision', () => {
    const result = decideChaos(
      { enabled: true, failureRate: 1, failureStatus: 429, minDelayMs: 50, maxDelayMs: 50 },
      seeded(0.5, 0.5)
    );
    expect(result).toEqual({
      delayMs: 50,
      failure: {
        statusCode: 429,
        body: { error: 'Simulated failure (Mocklify chaos)', chaos: true },
      },
    });
  });
});
