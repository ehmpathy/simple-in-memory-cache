import { type IsoDuration, toMilliseconds } from 'iso-time';
import { getUuid } from 'uuid-fns';

import type { SimpleCacheCondition } from './SimpleCacheCondition';
import { SimpleCacheConditionError } from './SimpleCacheConditionError';

export interface SimpleInMemoryCache<T> {
  /**
   * .what = read the value at a key (undefined if absent or expired)
   * .why = an optional `condition` (see SimpleCacheCondition) gates the read — the version-checked
   *        get: on a version mismatch it throws SimpleCacheConditionError instead of the value, so a
   *        caller never acts on a value that drifted since it observed it. see cache.conditionals.test.ts case4.
   */
  get: (
    key: string,
    options?: { condition?: SimpleCacheCondition },
  ) => T | undefined;
  /**
   * .what = write (or invalidate) the value at a key, optionally gated on a version precondition
   * .why = an optional `condition` (see SimpleCacheCondition) gates the write: put-if-absent
   *        (version: null) or compare-and-set (version: token); on a precondition miss it throws
   *        SimpleCacheConditionError instead of a silent clobber. `value: undefined` invalidates
   *        (deletes) the key — so `set(key, undefined, { condition })` is a compare-and-delete: the
   *        condition is checked before the delete, for a safe "release only if still mine" (mutex
   *        release). see cache.conditionals.test.ts case6.
   * .note = a *successful* conditional write mints a FRESH version token, so the token used to
   *         authorize it is immediately stale. in a renew-loop, re-observe version(key) before each
   *         renewal — do not carry a prior token across renewals, or it throws. see case12.
   */
  set: (
    key: string,
    value: T | undefined,
    options?: {
      expiration?: IsoDuration | null;
      condition?: SimpleCacheCondition;
    },
  ) => void;
  /**
   * .what = read the current opaque version token for a live key (undefined if absent or expired)
   * .why = the conditional-write vocabulary — a caller observes this token, then guards a later
   *        get/set on it
   * .note
   * - treat the token as an equality-only value; never parse or order it (it is a uuid — unorderable
   *   by construction)
   * - the token you pass to a condition must come from a *prior* observation (a get/version/acquire
   *   taken before the write). a fresh version(key) read taken right before its own conditional write
   *   always matches the current token and so guards no state at all — the whole point of a condition
   *   is to compare against a value you saw earlier. see cache.conditionals.test.ts case9.
   */
  version: (key: string) => string | undefined;
  /**
   * .what = list the keys that currently hold a live (unexpired) entry
   * .why = an expired entry reads as absent, so this enumerates exactly what the cache still holds
   */
  keys: () => string[];
}

// .note = internal store shape; not exported — a consumer that reached for it would couple to a
//         representation free to change (the public contract is SimpleInMemoryCache<T> in index.ts)
interface SimpleInMemoryCacheState<T> {
  [index: string]: { value: T; expiresAtMse: number; version: string };
}

const getMseNow = () => new Date().getTime();

/**
 * .what = decide whether a stored entry is still live (not yet expired)
 * .why = the single liveness predicate shared by version(), get-condition, and set-condition,
 *        so an expired entry reads as "absent" identically across all three paths
 */
const isLive = <T>(entry: SimpleInMemoryCacheState<T>[string]): boolean =>
  entry.expiresAtMse > getMseNow();

/**
 * .what = assert a version precondition holds against the current version
 * .why = the shared compare-and-set gate; throws SimpleCacheConditionError on a miss
 */
const assertConditionMet = (input: {
  key: string;
  condition: SimpleCacheCondition;
  found: string | null;
}): void => {
  const { key, condition, found } = input;

  // must-be-absent precondition (version: null)
  if (condition.version === null) {
    if (found !== null)
      throw new SimpleCacheConditionError(
        `cache condition failed: expected key '${key}' to be absent, but found a live entry at version ${found}`,
        { key, condition, found },
      );
    return;
  }

  // must-match precondition (version: token) — parallel prose shape with the must-be-absent message
  // above ("expected key 'X' to …, but found …") so both misses read as one error family
  if (found !== condition.version)
    throw new SimpleCacheConditionError(
      `cache condition failed: expected key '${key}' to match version ${condition.version}, but found ${found ? `a live entry at version ${found}` : 'no live entry'}`,
      { key, condition, found },
    );
};

/**
 * .what = create an in-memory key→value cache with time-based expiry and conditional writes
 * .why = a tiny, dependency-free cache that also answers "what version is this key at?" and gates
 *        writes on a version precondition (put-if-absent + compare-and-set), so it can back
 *        coordination primitives (mutex, stampede control) as WithCacheConditionals<SimpleCacheSync<T>>
 */
export const createCache = <T>(
  { expiration: defaultExpiration }: { expiration?: IsoDuration | null } = {
    expiration: { minutes: 5 },
  },
): SimpleInMemoryCache<T> => {
  // initialize a fresh in-memory cache object
  // .note = deliberate mutation — this store is mutated in place on every set (cache[key] = …) and
  //         delete (delete cache[key]); a mutable store is the essence of an in-memory cache and is
  //         scoped to this closure (see rule.require.immutable-vars — scoped, annotated mutation is permitted)
  const cache: SimpleInMemoryCacheState<T> = {};

  /**
   * .what = mint the next opaque version token for a write
   * .why = a fresh uuid per write guarantees a re-created key never re-mints a prior token, so a
   *        stale CAS token can never accidentally match a later entry — the same guarantee a
   *        monotonic counter gives, but with no per-instance counter state to carry
   * .note = the token is contract-opaque (equality-only) — a uuid is unorderable by construction, so
   *         it removes any temptation to parse or `<`/`>` compare it. callers must still treat it as
   *         an equality-only value (see the version() contract note above).
   */
  const nextVersion = (): string => getUuid();

  /**
   * .what = read the current live entry at a key (undefined if absent or expired)
   * .why = the single accessor both version() and get() route through, so a live-entry read is
   *        one lookup + one snapshot with no chance the two paths drift on what counts as live
   */
  const getLiveEntry = (input: {
    key: string;
  }): SimpleInMemoryCacheState<T>[string] | undefined => {
    const { key } = input;
    const entry = cache[key];
    if (!entry) return undefined; // absent
    if (!isLive(entry)) return undefined; // expired = absent
    return entry;
  };

  /**
   * .what = read the current opaque version token for a live key (undefined if absent or expired)
   * .why = the conditional-write vocabulary — a caller observes this token, then guards a later
   *        get/set on it; equality-only, so callers must never parse or order it
   * .note = positional `key` is contract-mandated — WithCacheConditionals<…> types version as
   *         (key: string) => string | undefined, so this signature must match to satisfy the typecheck
   */
  const version = (key: string): string | undefined =>
    getLiveEntry({ key })?.version;

  /**
   * .what = write (or invalidate) an item, optionally gated on a version precondition
   * .why = the one mutation path; a `condition` turns it into put-if-absent / compare-and-set /
   *        compare-and-delete, so a lost precondition throws instead of a silent clobber
   */
  const set = (
    key: string,
    value: T | undefined,
    {
      expiration = defaultExpiration,
      condition,
    }: {
      expiration?: IsoDuration | null;
      condition?: SimpleCacheCondition;
    } = {},
  ) => {
    // gate the write on the precondition, if any (checked before delete, too)
    // .note = read the live entry via the same getLiveEntry accessor get() uses, so both fns share
    //         one "read once, check, act" shape; map an absent version to null per the condition contract
    if (condition)
      assertConditionMet({
        key,
        condition,
        found: getLiveEntry({ key })?.version ?? null,
      });

    // handle cache invalidation
    if (value === undefined) {
      delete cache[key];
      return;
    }

    // handle the write; mint a fresh version for it
    const expiresAtMse =
      getMseNow() + (expiration ? toMilliseconds(expiration) : Infinity); // infinity if null
    cache[key] = { value, expiresAtMse, version: nextVersion() };
  };

  /**
   * .what = read an item, optionally gated on a version precondition (the version-checked get)
   * .why = a `condition` fuses "read the value" and "assert it is still the version i saw" into one
   *        atomic call, so a caller never acts on a value that drifted since the observation
   */
  const get = (
    key: string,
    { condition }: { condition?: SimpleCacheCondition } = {},
  ) => {
    // read the live entry once, so the condition check and the value read share one snapshot
    const entry = getLiveEntry({ key });

    // check the precondition against that snapshot's version, if any (null = absent)
    if (condition)
      assertConditionMet({ key, condition, found: entry?.version ?? null });

    // return the value of the live entry, or undefined when absent/expired
    return entry?.value;
  };

  // define how to grab all valid keys
  const keys = () =>
    Object.entries(cache)
      .filter(([_, entry]) => isLive(entry))
      .map(([key]) => key);

  // return the api
  return { set, get, version, keys };
};
