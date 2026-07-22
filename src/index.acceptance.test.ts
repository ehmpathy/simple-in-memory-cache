import { getError, given, then, useThen, when } from 'test-fns';

// acceptance tier: drive the vision's three named usage patterns end-to-end through the PUBLISHED
// barrel entry (./index) — the single module that compiles to `dist/index.js`, i.e. the exact surface
// a consumer imports via `simple-in-memory-cache`. this proves every symbol a consumer needs
// (createCache, SimpleInMemoryCache, SimpleCacheCondition, SimpleCacheConditionError) is exported from
// the barrel and that all three journeys compose end-to-end through it. each journey snapshots both its
// positive outcome (the consumer-visible success value) and its negative outcome (the error message).
import {
  createCache,
  type SimpleCacheCondition,
  SimpleCacheConditionError,
  type SimpleInMemoryCache,
} from './index';

describe('index (published contract) — the three conditional-write journeys', () => {
  given(
    '[case1] pattern 1 — put-if-absent claim/converge (stampede control)',
    () => {
      when('[t0] two workers race the same open key', () => {
        const outcome = useThen(
          'exactly one wins, the other throws',
          async () => {
            const cache: SimpleInMemoryCache<string> = createCache<string>();

            // worker-a claims the open slot
            cache.set('compute:slot', 'worker-a', {
              condition: { version: null },
            });

            // worker-b races the same key and loses
            const error = await getError(() =>
              cache.set('compute:slot', 'worker-b', {
                condition: { version: null },
              }),
            );
            return { value: cache.get('compute:slot'), error };
          },
        );

        then('the winner holds the slot', () => {
          expect(outcome.value).toEqual('worker-a');
          expect(outcome.value).toMatchSnapshot();
        });

        then('the loser gets a SimpleCacheConditionError', () => {
          expect(outcome.error).toBeInstanceOf(SimpleCacheConditionError);
        });

        then('the loser error text is stable for a consumer', () => {
          // lock the consumer-visible message, minus the run-specific token tail
          expect(outcome.error.message).toContain(
            "expected key 'compute:slot' to be absent",
          );
          expect(outcome.error.message).toMatchSnapshot();
        });
      });
    },
  );

  given('[case2] pattern 2 — mutex acquire → renew → release', () => {
    when('[t0] one holder walks the full lock lifecycle via the barrel', () => {
      then('each step guards on the held token and the lock ends open', () => {
        const cache = createCache<string>();
        const me = 'worker-a';

        // acquire
        cache.set('lock:report', me, { condition: { version: null } });
        const acquired = cache.version('lock:report');
        if (acquired === undefined)
          throw new Error('expected a token after acquire');
        expect(cache.keys()).toEqual(['lock:report']);

        // renew (CAS on the held token — a success mints a fresh token)
        cache.set('lock:report', me, { condition: { version: acquired } });
        const renewed = cache.version('lock:report');
        if (renewed === undefined)
          throw new Error('expected a token after renew');
        expect(renewed).not.toEqual(acquired);

        // release (compare-and-delete on the current token)
        cache.set('lock:report', undefined, {
          condition: { version: renewed },
        });
        expect(cache.get('lock:report')).toEqual(undefined);
        expect(cache.keys()).toEqual([]);

        // observability: lock the consumer-visible end-state (lock released, no keys held)
        expect(cache.get('lock:report')).toMatchSnapshot(); // undefined
        expect(cache.keys().join(', ')).toMatchSnapshot(); // ''
      });
    });

    when('[t1] a stale holder tries to release a lock taken by another', () => {
      const outcome = useThen('the stale release throws', async () => {
        const cache = createCache<string>();

        // holder-a acquires, then holder-b takes over the same key after a releases
        cache.set('lock:report', 'worker-a', { condition: { version: null } });
        const stale = cache.version('lock:report');
        if (stale === undefined) throw new Error('expected a token');
        cache.set('lock:report', undefined, { condition: { version: stale } }); // a releases
        cache.set('lock:report', 'worker-b', { condition: { version: null } }); // b acquires (new token)

        // a, with its now-stale token, tries to release again — must throw, no clobber of b
        const error = await getError(() =>
          cache.set('lock:report', undefined, {
            condition: { version: stale },
          }),
        );
        return { error, keptBy: cache.get('lock:report') };
      });

      then('the stale release yields a SimpleCacheConditionError', () => {
        expect(outcome.error).toBeInstanceOf(SimpleCacheConditionError);
      });

      then("b's lock is not clobbered by the stale release", () => {
        expect(outcome.keptBy).toEqual('worker-b');
        expect(outcome.keptBy).toMatchSnapshot();
      });

      then('the release-conflict message is stable for a consumer', () => {
        expect(outcome.error.message).toContain(
          "expected key 'lock:report' to match version",
        );
        expect(outcome.error.message).toMatchSnapshot();
      });
    });
  });

  given(
    '[case3] pattern 3 — optimistic round-trip (the vision star usecase)',
    () => {
      when(
        '[t0] read-compute-write-back guarded on the observed version',
        () => {
          then('the write-back commits when the version still holds', () => {
            const cache = createCache<string>();
            cache.set('counter', '1');

            // observe the value + its version together, then compute from the value
            const version = cache.version('counter');
            const condition: SimpleCacheCondition = {
              version: version ?? null,
            };
            const current = cache.get('counter', { condition });
            const next = String(Number(current) + 1);

            // write-back guarded on the SAME version — no drift, so it commits
            cache.set('counter', next, { condition });
            expect(cache.get('counter')).toEqual('2');
            expect(cache.get('counter')).toMatchSnapshot();
          });
        },
      );

      when('[t1] a racer moves the value between read and write-back', () => {
        const outcome = useThen('the stale write-back throws', async () => {
          const cache = createCache<string>();
          cache.set('counter', '1');
          const stale = cache.version('counter');
          if (stale === undefined) throw new Error('expected a token');

          // a racer commits first, so the version moves on
          cache.set('counter', '99');

          // our write-back on the now-stale version is rejected
          const error = await getError(() =>
            cache.set('counter', '2', { condition: { version: stale } }),
          );
          return { error };
        });

        then('the racer path yields a SimpleCacheConditionError', () => {
          expect(outcome.error).toBeInstanceOf(SimpleCacheConditionError);
        });

        then('the mismatch message is stable for a consumer', () => {
          expect(outcome.error.message).toContain(
            "expected key 'counter' to match version",
          );
          expect(outcome.error.message).toMatchSnapshot();
        });
      });
    },
  );
});
