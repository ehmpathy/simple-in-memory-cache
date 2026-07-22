/**
 * .what = a version precondition for a conditional cache operation — usable on both get and set
 *
 * - version: null      → "must be absent" (put-if-absent)
 * - version: '<token>' → "must match the current version" (compare-and-set)
 *
 * .note
 * - the version token is opaque; treat it as an equality-only value, never parse or order it
 */
export type SimpleCacheCondition = { version: string | null };
