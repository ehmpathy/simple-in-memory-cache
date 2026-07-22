import { UnexpectedCodePathError } from 'helpful-errors';
import { getError, given, then, when } from 'test-fns';

import { createCache } from './cache';
import { SimpleCacheConditionError } from './SimpleCacheConditionError';

/**
 * .what = narrow version() to a definite token for a compare-and-set condition
 * .why = version() returns string | undefined (undefined = absent), but a CAS condition wants
 *        string | null. these tests always read a token they just minted, so it is present;
 *        this asserts that intent without a cast
 */
const tokenOf = (input: { token: string | undefined }): string => {
  const { token } = input;
  if (token === undefined)
    throw new UnexpectedCodePathError(
      'expected a version token to be present',
      {
        token,
        hint: 'the key was set immediately before this read, so version() should return a token; an undefined here signals a test bug',
      },
    );
  return token;
};

/**
 * .what = pause for a fixed number of milliseconds
 * .why = the renewal ttl-extension case (case15) needs real elapsed time to prove a conditional
 *        set with a longer expiration outlives the original ttl; the cache reads a real clock
 */
const sleep = (input: { ms: number }): Promise<void> =>
  new Promise((res) => setTimeout(res, input.ms));

describe('cache.conditionals', () => {
  given('[case1] a conditional cache and the version reader', () => {
    when('[t0] a key is absent', () => {
      then('version returns undefined', () => {
        const { version } = createCache<string>();
        expect(version('open')).toEqual(undefined);
      });
    });

    when('[t1] a key is set', () => {
      then('version returns an opaque token', () => {
        const { set, version } = createCache<string>();
        set('held', 'a');
        expect(typeof version('held')).toEqual('string');
      });

      then('an unconditional overwrite mints a fresh token', () => {
        const { set, version } = createCache<string>();
        set('k', 'a');
        const first = version('k');
        set('k', 'b');
        const second = version('k');
        expect(first).not.toEqual(second);
      });
    });
  });

  given('[case2] put-if-absent (condition.version: null)', () => {
    when('[t0] the key is open', () => {
      then('the write succeeds', () => {
        const { set, get } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });
        // functional assertion + observability snapshot of the put-if-absent success output
        expect(get('lock')).toEqual('worker-a');
        expect(get('lock')).toMatchSnapshot();
      });
    });

    when('[t1] the key is already held', () => {
      then('the write throws SimpleCacheConditionError', async () => {
        const { set } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });

        const error = await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
      });

      then('the held value is not clobbered', async () => {
        const { set, get } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });
        await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        );
        expect(get('lock')).toEqual('worker-a');
      });
    });

    when('[t2] two put-if-absent race the same open key', () => {
      then('exactly one wins', async () => {
        const { set, get } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } }); // first wins
        const error = await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        ); // second loses
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        expect(get('lock')).toEqual('worker-a');
      });
    });
  });

  given('[case3] compare-and-set (condition.version: token)', () => {
    when('[t0] the stored version matches the token', () => {
      then('the write succeeds', () => {
        const { set, version, get } = createCache<string>();
        set('k', 'a');
        const v = tokenOf({ token: version('k') });
        set('k', 'b', { condition: { version: v } });
        // functional assertion + observability snapshot of the compare-and-set success output
        expect(get('k')).toEqual('b');
        expect(get('k')).toMatchSnapshot();
      });
    });

    when('[t1] the stored version does not match the token', () => {
      then('the write throws SimpleCacheConditionError', async () => {
        const { set, version } = createCache<string>();
        set('k', 'a');
        const stale = tokenOf({ token: version('k') }); // capture the current token
        set('k', 'b'); // unconditional overwrite mints a fresh token, stale is now old

        const error = await getError(() =>
          set('k', 'c', { condition: { version: stale } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
      });
    });

    when('[t2] the key is absent but a token is required', () => {
      then(
        'the write throws SimpleCacheConditionError (cannot CAS what is absent)',
        async () => {
          const { set } = createCache<string>();
          const error = await getError(() =>
            set('k', 'a', { condition: { version: 'v-ghost' } }),
          );
          expect(error).toBeInstanceOf(SimpleCacheConditionError);
        },
      );
    });
  });

  given('[case4] version-checked get', () => {
    when('[t0] the version matches', () => {
      then('the value is returned', () => {
        const { set, version, get } = createCache<string>();
        set('counter', '1');
        const v = tokenOf({ token: version('counter') });
        // functional assertion + observability snapshot of the version-checked get success output
        expect(get('counter', { condition: { version: v } })).toEqual('1');
        expect(get('counter', { condition: { version: v } })).toMatchSnapshot();
      });
    });

    when('[t1] the version has drifted', () => {
      then('the read throws SimpleCacheConditionError', async () => {
        const { set, version, get } = createCache<string>();
        set('counter', '1');
        const stale = tokenOf({ token: version('counter') });
        set('counter', '2'); // drift

        const error = await getError(() =>
          get('counter', { condition: { version: stale } }),
        );
        // functional assertion + observability snapshot of the get-triggered blocked-state message
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        expect(error.message).toMatchSnapshot();
      });

      then(
        'the get-triggered message embeds key and tokens (actionable)',
        async () => {
          const { set, version, get } = createCache<string>();
          set('counter', '1');
          const stale = tokenOf({ token: version('counter') });
          set('counter', '2'); // drift
          const current = tokenOf({ token: version('counter') });

          // the get path routes through the same assertConditionMet as set → same actionable message
          const error = await getError(() =>
            get('counter', { condition: { version: stale } }),
          );
          expect(error.message).toContain('counter');
          expect(error.message).toContain(stale);
          expect(error.message).toContain(current);
        },
      );
    });

    when('[t2] a null condition (must-be-absent) on get', () => {
      then('an absent key returns undefined', () => {
        const { get } = createCache<string>();
        // functional assertion + observability snapshot of the must-be-absent get on an absent key
        expect(get('counter', { condition: { version: null } })).toEqual(
          undefined,
        );
        expect(
          get('counter', { condition: { version: null } }),
        ).toMatchSnapshot();
      });

      then('a present key throws SimpleCacheConditionError', async () => {
        const { set, get } = createCache<string>();
        set('counter', '1');
        const error = await getError(() =>
          get('counter', { condition: { version: null } }),
        );
        // functional assertion + observability snapshot of the blocked-state message
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        expect(error.message).toMatchSnapshot();
      });
    });

    when('[t3] a token condition on an absent key', () => {
      then(
        'the read throws SimpleCacheConditionError (cannot CAS-read what is absent)',
        async () => {
          const { get } = createCache<string>();
          const error = await getError(() =>
            get('counter', { condition: { version: 'v-ghost' } }),
          );
          // functional assertion + observability snapshot of the blocked-state message
          expect(error).toBeInstanceOf(SimpleCacheConditionError);
          expect(error.message).toMatchSnapshot();
        },
      );
    });

    when('[t4] a version-checked get succeeds', () => {
      // .why = only a successful conditional *write* mints a fresh token (nextVersion runs on set);
      //        a read never rotates. pin that reads are side-effect-free so a future refactor cannot
      //        silently make get() mint a token (which would break every hold-my-token caller).
      then('the token is not rotated (reads never mint)', () => {
        const { set, version, get } = createCache<string>();
        set('counter', '1');
        const v = tokenOf({ token: version('counter') });
        get('counter', { condition: { version: v } }); // read, guarded
        expect(version('counter')).toEqual(v); // unchanged — the read minted no token
      });
    });
  });

  given('[case5] an expired entry is treated as absent', () => {
    when('[t0] a key was set with immediate expiration', () => {
      then('put-if-absent succeeds after expiry', () => {
        const { set, get } = createCache<string>({
          expiration: { seconds: 0 },
        });
        set('lock', 'worker-a'); // expires immediately (default expiration is 0s)
        // the expired entry is absent → put-if-absent must succeed
        // .note = give worker-b a real ttl so we can observe it (the cache default is 0s)
        set('lock', 'worker-b', {
          condition: { version: null },
          expiration: { minutes: 5 },
        });
        // functional assertion + observability snapshot of the post-expiry put-if-absent get output
        expect(get('lock')).toEqual('worker-b');
        expect(get('lock')).toMatchSnapshot();
      });

      then('version returns undefined for the expired key', () => {
        const { set, version } = createCache<string>({
          expiration: { seconds: 0 },
        });
        set('lock', 'worker-a');
        // functional assertion + observability snapshot of the expired-key version output
        expect(version('lock')).toEqual(undefined);
        expect(version('lock')).toMatchSnapshot();
      });
    });
  });

  given(
    '[case6] conditional delete (compare-and-delete = mutex release)',
    () => {
      when('[t0] the holder releases on its own version', () => {
        then('the delete succeeds and the key becomes open', () => {
          const { set, version, get } = createCache<string>();
          set('lock', 'worker-a', { condition: { version: null } });
          const mine = tokenOf({ token: version('lock') });
          set('lock', undefined, { condition: { version: mine } }); // release
          // functional assertion + observability snapshot of the post-release (open) get output
          expect(get('lock')).toEqual(undefined);
          expect(get('lock')).toMatchSnapshot();
          // key is open again → a fresh put-if-absent succeeds
          set('lock', 'worker-b', { condition: { version: null } });
          expect(get('lock')).toEqual('worker-b');
        });
      });

      when(
        '[t1] a stale holder tries to release a lock taken by another',
        () => {
          then(
            'the delete throws SimpleCacheConditionError (no clobber)',
            async () => {
              const { set, version, get } = createCache<string>();
              set('lock', 'worker-a', { condition: { version: null } });
              const staleHandle = tokenOf({ token: version('lock') }); // the acquired token

              // worker-a's entry is replaced by a newer write (simulates takeover)
              set('lock', 'worker-a-renewed'); // mints a fresh token

              const error = await getError(() =>
                set('lock', undefined, { condition: { version: staleHandle } }),
              );
              expect(error).toBeInstanceOf(SimpleCacheConditionError);
              expect(get('lock')).toEqual('worker-a-renewed'); // not clobbered
              // observability snapshot of the compare-and-delete blocked-state message
              expect(error.message).toMatchSnapshot();
            },
          );
        },
      );
    },
  );

  given('[case7] the error carries diagnostic metadata', () => {
    when('[t0] a put-if-absent conflict is thrown', () => {
      then('metadata includes key, condition, and found', async () => {
        const { set } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });

        const error = await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        if (!(error instanceof SimpleCacheConditionError)) throw error; // narrow
        expect(error.metadata?.key).toEqual('lock');
        expect(error.metadata?.condition).toEqual({ version: null });
        expect(typeof error.metadata?.found).toEqual('string');
      });
    });
  });

  given('[case8] the error is recognizable across a package boundary', () => {
    // .why = with-simple-cache's exception:'ignore' converge identifies our throw structurally,
    //        by class name (not instanceof), since our local class is a distinct prototype.
    //        this guards that the runtime constructor.name stays 'SimpleCacheConditionError'.
    when('[t0] a condition miss throws', () => {
      then(
        'the runtime constructor name is SimpleCacheConditionError',
        async () => {
          const { set } = createCache<string>();
          set('lock', 'worker-a', { condition: { version: null } });

          const error = await getError(() =>
            set('lock', 'worker-b', { condition: { version: null } }),
          );
          expect(error.constructor.name).toEqual('SimpleCacheConditionError');
        },
      );

      then('the message prefixes with the ✋ constraint marker', async () => {
        const { set } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });

        const error = await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        );
        expect(error.message).toContain('SimpleCacheConditionError');
        expect(error.message).toContain('cache condition failed');
      });

      then(
        'the message embeds the key and the found version (actionable)',
        async () => {
          const { set, version } = createCache<string>();
          set('lock', 'worker-a', { condition: { version: null } });
          const held = tokenOf({ token: version('lock') });

          const error = await getError(() =>
            set('lock', 'worker-b', { condition: { version: null } }),
          );
          // the primary message (not just metadata) names the key and the live version it found
          expect(error.message).toContain('lock');
          expect(error.message).toContain(held);
        },
      );

      then(
        'a version-mismatch message embeds expected and found tokens',
        async () => {
          const { set, version } = createCache<string>();
          set('k', 'a');
          const stale = tokenOf({ token: version('k') });
          set('k', 'b'); // move the version so `stale` is now old
          const current = tokenOf({ token: version('k') });

          const error = await getError(() =>
            set('k', 'c', { condition: { version: stale } }),
          );
          // the message states both the expected (stale) token and the actual (current) one
          expect(error.message).toContain(stale);
          expect(error.message).toContain(current);
        },
      );
    });
  });

  given(
    '[case9] the fresh-read footgun — a condition guards a PRIOR observation',
    () => {
      // .why = pin the subtle-but-critical trap from the vision: a token read from the very same key
      //        immediately before its own conditional write ALWAYS matches the current token, so the
      //        condition guards no state. the mechanism is deterministic, so this test documents the
      //        trap for future readers rather than catches a regression. the safe pattern (a token from
      //        a prior, separate observation) is the one that actually guards state — proven by case3.
      when('[t0] a token is read fresh and used to guard its own write', () => {
        then(
          'the write always succeeds — the condition guarded no state',
          () => {
            const { set, version, get } = createCache<string>();
            set('counter', '1');

            // anti-pattern: read the token now, then immediately guard the write on it
            const fresh = tokenOf({ token: version('counter') });
            set('counter', '2', { condition: { version: fresh } }); // always matches → no guard

            expect(get('counter')).toEqual('2');
          },
        );

        then(
          'a token captured BEFORE an intervening write correctly throws',
          async () => {
            const { set, version } = createCache<string>();
            set('counter', '1');

            // safe pattern: capture the token from a prior observation
            const prior = tokenOf({ token: version('counter') });
            set('counter', '2'); // an intervening write moves the version

            // the prior token now guards real state → the stale write is rejected
            const error = await getError(() =>
              set('counter', '3', { condition: { version: prior } }),
            );
            expect(error).toBeInstanceOf(SimpleCacheConditionError);
          },
        );
      });
    },
  );

  given('[case10] error messages are locked by snapshot', () => {
    // .why = the error message is a user-visible contract surface (logs, aggregators, downstream
    //        parsers). snapshot each variant so any drift in the text surfaces in a pr diff. tokens
    //        are opaque uuids, so the jest.serializer.uuid serializer masks each to a stable
    //        <uuid-N> placeholder — the message SHAPE stays deterministic while the random token does not.
    // .note = every snapshot is paired with an explicit assertion (see rule.require.snapshots — use
    //         BOTH: snapshot for pr-diff observability, explicit assert for functional verification;
    //         a lone toMatchSnapshot is a failhide because it can be re-recorded past a regression).
    when('[t0] a put-if-absent conflict is thrown', () => {
      then('the full message matches the snapshot', async () => {
        const { set, version } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });
        const held = tokenOf({ token: version('lock') }); // the token the live entry now holds

        const error = await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        );
        // functional assertion: the message names the key and the found version token
        expect(error.message).toContain('lock');
        expect(error.message).toContain(held);
        expect(error.message).toContain('to be absent');
        // observability: lock the full text for pr-diff review (uuid masked to <uuid-N>)
        expect(error.message).toMatchSnapshot();
      });
    });

    when('[t1] a compare-and-set mismatch is thrown', () => {
      then('the full message matches the snapshot', async () => {
        const { set, version } = createCache<string>();
        set('k', 'a');
        const stale = tokenOf({ token: version('k') });
        set('k', 'b'); // mints a fresh token — stale is now old
        const current = tokenOf({ token: version('k') });

        const error = await getError(() =>
          set('k', 'c', { condition: { version: stale } }),
        );
        // functional assertion: the message names the expected (stale) and found (current) tokens
        expect(error.message).toContain(`to match version ${stale}`);
        expect(error.message).toContain(
          `found a live entry at version ${current}`,
        );
        // observability: lock the full text for pr-diff review (uuids masked to <uuid-1>/<uuid-2>)
        expect(error.message).toMatchSnapshot();
      });
    });

    when('[t2] a compare-and-set against an absent key is thrown', () => {
      then('the full message matches the snapshot', async () => {
        const { set } = createCache<string>();

        const error = await getError(() =>
          set('k', 'a', { condition: { version: 'v-ghost' } }),
        );
        // functional assertion: expected the ghost token, found no live entry
        expect(error.message).toContain('to match version v-ghost');
        expect(error.message).toContain('no live entry');
        // observability: lock the full text for pr-diff review
        expect(error.message).toMatchSnapshot();
      });
    });

    when('[t3] a success path returns contract output', () => {
      // .why = lock a representative success-path shape for the contract surface (get value + version
      //        token) so unintended drift in the returned values surfaces in a pr diff, alongside the
      //        error-message snapshots above. each snapshot is paired with an explicit assertion.
      // .note = split into one-snapshot-per-then (value vs token) so each snapshot's then-title
      //         names exactly what it locks — a reviewer reads the intent from the .snap key alone
      then('get returns the stored value', () => {
        const { set, get } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } }); // mints a token

        // functional assertion
        expect(get('lock')).toEqual('worker-a');
        // observability
        expect(get('lock')).toMatchSnapshot();
      });

      then('version mints a token for the stored key', () => {
        const { set, version } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });

        // functional assertion: a live key holds an opaque string token
        expect(typeof version('lock')).toEqual('string');
        // observability (uuid masked to <uuid-N>)
        expect(version('lock')).toMatchSnapshot();
      });

      then('version of an absent key is undefined', () => {
        const { version } = createCache<string>();
        // functional assertion
        expect(version('open')).toEqual(undefined);
        // observability
        expect(version('open')).toMatchSnapshot();
      });
    });
  });

  given(
    '[case11] the version() ?? null idiom unifies create-if-absent and update-if-unchanged',
    () => {
      // .why = version() returns string | undefined but a condition wants string | null, so the realistic
      //        "optimistic upsert" a consumer reaches for is `set(k, next, { condition: { version: v ?? null } })`
      //        at ONE call site: absent → the null branch (put-if-absent), present → the token branch (CAS).
      //        prove both branches of that single idiom end-to-end.
      when('[t0] the key is absent (v is undefined → null)', () => {
        then('the idiom takes the put-if-absent branch and writes', () => {
          const { set, get, version } = createCache<string>();

          const v = version('slot'); // undefined — key is open
          set('slot', 'first', { condition: { version: v ?? null } }); // put-if-absent

          // functional assertion + observability snapshot of the idiom's put-if-absent branch output
          expect(get('slot')).toEqual('first');
          expect(get('slot')).toMatchSnapshot();
        });
      });

      when('[t1] the key is present and unchanged (v is a token → CAS)', () => {
        then('the idiom takes the compare-and-set branch and writes', () => {
          const { set, get, version } = createCache<string>();
          set('slot', 'first');

          const v = version('slot'); // a token — key is held
          set('slot', 'second', { condition: { version: v ?? null } }); // compare-and-set

          // functional assertion + observability snapshot of the idiom's compare-and-set branch output
          expect(get('slot')).toEqual('second');
          expect(get('slot')).toMatchSnapshot();
        });
      });

      when('[t2] the key drifted since v was read', () => {
        then(
          'the idiom throws — the optimistic upsert refused to clobber',
          async () => {
            const { set, version } = createCache<string>();
            set('slot', 'first');

            const v = version('slot'); // token captured
            set('slot', 'other'); // someone else moved it

            const error = await getError(() =>
              set('slot', 'second', { condition: { version: v ?? null } }),
            );
            expect(error).toBeInstanceOf(SimpleCacheConditionError);
          },
        );
      });
    },
  );

  given(
    '[case12] the mutex-renew invariant — a conditional set rotates the token',
    () => {
      // .why = a successful conditional set mints a FRESH token (nextVersion runs after the condition
      //        passes), so the token used to authorize a renewal is immediately dead. a mutex-renew loop
      //        MUST re-observe version() between renewals. if the token did NOT rotate on conditional
      //        writes, a stale holder could keep a lock another worker has taken over alive — the exact
      //        silent-clobber this feature exists to prevent. this proves the token rotates.
      when('[t0] a holder renews once with its acquired token', () => {
        then('the first renewal succeeds and mints a new token', () => {
          const { set, version } = createCache<string>();
          set('lock', 'worker-a', { condition: { version: null } }); // acquire mints a token
          const acquired = tokenOf({ token: version('lock') });

          set('lock', 'worker-a', { condition: { version: acquired } }); // renew mints a fresh token

          // the acquired token is now stale — the successful renewal rotated it
          expect(version('lock')).not.toEqual(acquired);
        });
      });

      when(
        '[t1] the holder renews AGAIN with the same (now-stale) acquired token',
        () => {
          then(
            'the second renewal throws — the caller must re-observe between renewals',
            async () => {
              const { set, version } = createCache<string>();
              set('lock', 'worker-a', { condition: { version: null } }); // acquire mints a token
              const acquired = tokenOf({ token: version('lock') });

              set('lock', 'worker-a', { condition: { version: acquired } }); // renew once mints a fresh token, acquired now dead

              // pass the SAME acquired token again → must throw (it no longer matches the live version)
              const error = await getError(() =>
                set('lock', 'worker-a', { condition: { version: acquired } }),
              );
              expect(error).toBeInstanceOf(SimpleCacheConditionError);
            },
          );
        },
      );
    },
  );

  given('[case13] conditional writes keep keys() consistent', () => {
    // .why = keys() shares the same isLive filter as the new conditional paths; prove the old and new
    //        api surfaces agree — a compare-and-delete removes the key, and a lost put-if-absent
    //        leaves no phantom key.
    when('[t0] a compare-and-delete releases the key', () => {
      then('keys() no longer lists it', () => {
        const { set, version, keys } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } });
        expect(keys()).toEqual(['lock']);

        const mine = tokenOf({ token: version('lock') });
        set('lock', undefined, { condition: { version: mine } }); // release

        // functional assertion + observability. snapshot a single-line join (not the raw array) so
        // the .snap stays clean — a raw array snapshot renders multi-line with a comma at the tail (a
        // visual blemish), whereas the join reads as a plain, self-evident string in a pr diff
        expect(keys()).toEqual([]);
        expect(keys().join(', ')).toMatchSnapshot();
      });
    });

    when('[t1] a put-if-absent loses the race', () => {
      then('keys() lists the key exactly once (no phantom)', async () => {
        const { set, keys } = createCache<string>();
        set('lock', 'worker-a', { condition: { version: null } }); // wins

        await getError(() =>
          set('lock', 'worker-b', { condition: { version: null } }),
        ); // loses

        // functional assertion + observability via a clean single-line join (see t0 note)
        expect(keys()).toEqual(['lock']);
        expect(keys().join(', ')).toMatchSnapshot();
      });
    });
  });

  given(
    '[case14] null-condition combinations at the absent/expired boundary',
    () => {
      when('[t0] a must-be-absent delete on an already-absent key', () => {
        then(
          'the no-op delete succeeds (condition holds — the key is absent)',
          () => {
            const { set, get, keys } = createCache<string>();

            // delete-if-absent on a key that is already open: condition.version null holds, delete no-ops
            set('ghost', undefined, { condition: { version: null } });

            expect(get('ghost')).toEqual(undefined);
            expect(keys()).toEqual([]);
          },
        );
      });

      when('[t1] a must-be-absent get on a present-but-expired key', () => {
        then(
          'the expired key reads as absent → the get returns undefined, no throw',
          () => {
            const { set, get } = createCache<string>({
              expiration: { seconds: 0 },
            });
            set('slot', 'worker-a'); // expires immediately

            // the expired entry is treated as absent, so the must-be-absent condition holds
            expect(get('slot', { condition: { version: null } })).toEqual(
              undefined,
            );
          },
        );
      });

      when('[t2] a must-be-absent delete on a present (live) key', () => {
        // .why = the null-condition delete is the mirror of case14 t0: on a live key the must-be-absent
        //        precondition fails, so the delete must throw (no silent removal of a held entry).
        then(
          'the delete throws SimpleCacheConditionError (key is not absent)',
          async () => {
            const { set, get } = createCache<string>();
            set('held', 'worker-a'); // a live entry

            const error = await getError(() =>
              set('held', undefined, { condition: { version: null } }),
            );
            expect(error).toBeInstanceOf(SimpleCacheConditionError);
            expect(get('held')).toEqual('worker-a'); // not removed
          },
        );
      });

      when('[t3] a token-conditioned delete against a never-set key', () => {
        // .why = the compare-and-delete mirror of case3 t2: a token precondition on an absent key finds
        //        no live version, so the delete throws (cannot compare-and-delete what was never there).
        then(
          'the delete throws SimpleCacheConditionError (cannot CAS-delete an absent key)',
          async () => {
            const { set, keys } = createCache<string>();

            const error = await getError(() =>
              set('ghost', undefined, { condition: { version: 'v-ghost' } }),
            );
            expect(error).toBeInstanceOf(SimpleCacheConditionError);
            expect(keys()).toEqual([]); // still absent
          },
        );
      });
    },
  );

  given(
    '[case15] a conditional renewal extends the ttl (the mutex-renew aha)',
    () => {
      // .why = the vision's headline usecase is mutex renewal: a conditional set that BOTH proves
      //        ownership (CAS) AND extends the lease. case12 proves the token rotates; this proves the
      //        compound effect — a CAS renewal with a longer expiration keeps the key alive past its
      //        ORIGINAL ttl. this is the exact behavior with-simple-mutex's renew-loop depends on.
      when(
        '[t0] a holder acquires with a short ttl then renews with a longer one',
        () => {
          then(
            'the key outlives its original ttl and the token has rotated',
            async () => {
              const { set, version, get } = createCache<string>();

              // acquire with a short 1s lease
              set('lock', 'worker-a', {
                condition: { version: null },
                expiration: { seconds: 1 },
              });
              const acquired = tokenOf({ token: version('lock') });

              // renew via CAS with a much longer lease — extends the ttl and rotates the token
              set('lock', 'worker-a', {
                condition: { version: acquired },
                expiration: { minutes: 5 },
              });

              // wait past the ORIGINAL 1s ttl
              await sleep({ ms: 1200 });

              // the renewal extended the lease → the key is still alive
              expect(get('lock')).toEqual('worker-a');
              // and the acquired token is stale — the successful renewal rotated it
              expect(version('lock')).not.toEqual(acquired);
            },
          );
        },
      );
    },
  );

  given(
    '[case16] optimistic concurrency round-trip (version-checked get → compute → conditional set)',
    () => {
      // .why = this is the vision's headline "star" usecase (pattern 3): read a value guarded by its
      //        version, derive a new value FROM it, then write-back guarded on the SAME version — so a
      //        writer that raced in between cannot clobber a fresher value. case4 tests the guarded get
      //        alone and case11 tests the ?? null idiom alone; this composes them into the actual loop
      //        and proves the failure mode that matters: a racer's write makes the write-back throw.
      when(
        '[t0] no one writes between the guarded read and the write-back',
        () => {
          then(
            'the read-compute-write round-trip commits the derived value',
            () => {
              const { set, get, version } = createCache<number>();
              set('counter', 1);

              // read the value guarded by its version
              const v = tokenOf({ token: version('counter') });
              const current = get('counter', { condition: { version: v } });

              // derive the next value FROM the observed value
              const next = (current ?? 0) + 1;

              // write-back guarded on the SAME version → commits, since no one raced
              set('counter', next, { condition: { version: v } });

              expect(get('counter')).toEqual(2);
            },
          );
        },
      );

      when(
        '[t1] another writer commits between the read and the write-back',
        () => {
          then(
            'the write-back throws — the value acted on was stale, so retry',
            async () => {
              const { set, get, version } = createCache<number>();
              set('counter', 1);

              // read the value guarded by its version
              const v = tokenOf({ token: version('counter') });
              const current = get('counter', { condition: { version: v } });
              const next = (current ?? 0) + 1;

              // a racer moves 'counter' AFTER our read but BEFORE our write-back
              set('counter', 99);

              // the write-back guarded on the now-stale version is refused (no clobber of the fresher 99)
              const error = await getError(() =>
                set('counter', next, { condition: { version: v } }),
              );
              expect(error).toBeInstanceOf(SimpleCacheConditionError);
              expect(get('counter')).toEqual(99); // the racer's value stands
            },
          );
        },
      );
    },
  );

  given(
    '[case17] the undefined-vs-null footgun — an undefined token never means put-if-absent',
    () => {
      // .why = version() yields string | undefined but a condition wants string | null. typescript guards
      //        this, but plain-js/browser callers do not get that guard. pin the readme's falsifiable
      //        claim: a raw undefined token (a js caller who forgot the `?? null` bridge) falls into the
      //        compare-and-set branch and ALWAYS throws — it is never read as put-if-absent.
      when(
        '[t0] a js caller passes an undefined token on an absent key',
        () => {
          then(
            'the write throws instead of a silent put-if-absent',
            async () => {
              const { set, get } = createCache<string>();

              // a js caller who meant put-if-absent but forgot `?? null` — undefined is NOT null
              const error = await getError(() =>
                set('slot', 'first', {
                  condition: { version: undefined as unknown as null },
                }),
              );
              expect(error).toBeInstanceOf(SimpleCacheConditionError);
              expect(get('slot')).toEqual(undefined); // no write happened
            },
          );
        },
      );

      when('[t1] the same caller bridges the absent read with ?? null', () => {
        then('the write takes the put-if-absent branch and commits', () => {
          const { set, get, version } = createCache<string>();

          // the correct pattern: bridge undefined → null
          const v = version('slot'); // undefined — key is open
          set('slot', 'first', { condition: { version: v ?? null } });

          expect(get('slot')).toEqual('first');
        });
      });
    },
  );

  given(
    '[case18] the full mutex lifecycle in one continuous journey (the with-simple-mutex story)',
    () => {
      // .why = pattern 2 (mutex) is proven transition-by-transition across case6/case12/case15, but a
      //        consumer reads the story best as one unbroken chain: acquire → renew → renew-again →
      //        release. this pins that whole journey in a single test, and re-reads the rotated token
      //        after every successful write (a renew mints a FRESH token, so the prior one goes stale).
      when('[t0] one holder acquires, renews twice, then releases', () => {
        then(
          'each step guards on the current token and the lock ends open',
          () => {
            const { set, version, keys, get } = createCache<string>();
            const me = 'worker-a';

            // acquire — put-if-absent claims the open key, mints the first token
            set('lock:report', me, { condition: { version: null } });
            const tokenAcquire = tokenOf({ token: version('lock:report') });
            expect(keys()).toEqual(['lock:report']);

            // renew #1 — CAS on the acquired token; success ROTATES the token
            set('lock:report', me, { condition: { version: tokenAcquire } });
            const tokenRenew1 = tokenOf({ token: version('lock:report') });
            expect(tokenRenew1).not.toEqual(tokenAcquire); // rotated, so the old token is now stale

            // renew #2 — CAS on the freshly-read token (a naive reuse of tokenAcquire would throw)
            set('lock:report', me, { condition: { version: tokenRenew1 } });
            const tokenRenew2 = tokenOf({ token: version('lock:report') });
            expect(tokenRenew2).not.toEqual(tokenRenew1);

            // release — compare-and-delete on the token we currently hold
            set('lock:report', undefined, {
              condition: { version: tokenRenew2 },
            });

            // the lock is open again — a fresh holder could re-acquire
            expect(get('lock:report')).toEqual(undefined);
            expect(version('lock:report')).toEqual(undefined);
            expect(keys()).toEqual([]);
          },
        );
      });
    },
  );
});
