import { ConstraintError } from 'helpful-errors';

import type { SimpleCacheCondition } from './SimpleCacheCondition';

/**
 * .what = thrown by a conditional cache's get(...) or set(...) when a condition.version precondition is not met
 * .why = the key was present/absent contrary to expectation, or the version did not match
 *
 * extends ConstraintError from helpful-errors — a caller-must-fix constraint violation (exit 2)
 * - metadata.key       — the cache key the condition was checked against
 * - metadata.condition — the version precondition that was required
 * - metadata.found     — the current version token found (null if absent), mirrors
 *                        SimpleCacheCondition.version which uses null for absence
 *
 * .caveat = this is a LOCAL class, distinct from the class of the same name in with-simple-cache. the two
 *           share a name + shape (both extend helpful-errors' ConstraintError) but are distinct prototypes,
 *           so `error instanceof theWrapperClass` is false for a throw from here. with-simple-cache@0.17.0's
 *           `exception: 'ignore'` converge path (withSimpleCache.ts) still keys off `instanceof` its own
 *           class, so that converge does NOT trigger for this cache until the upstream guard becomes
 *           structural (keys off constructor.name). callers that need the converge should compare
 *           `error.constructor.name === 'SimpleCacheConditionError'` (see cache.conditionals.test.ts case8).
 */
export class SimpleCacheConditionError extends ConstraintError<{
  key: string;
  condition: SimpleCacheCondition;
  found: string | null;
}> {}
