import { expect } from '@jest/globals';

/**
 * .what = mask opaque uuid version tokens to stable placeholders inside snapshots
 * .why = version tokens are now uuids (random per write), so embedding a raw token in a snapshot
 *        would make the snapshot non-deterministic and flaky. this masks each distinct uuid to a
 *        `<uuid-N>` placeholder (numbered by first-seen order within one value) so the message SHAPE
 *        stays locked for pr-diff review while the random token itself is not — and two distinct
 *        tokens stay visibly distinct (`<uuid-1>` vs `<uuid-2>`), which the conflict messages rely on.
 * .note = equality-only opaqueness is now carried by the token itself (a uuid is unorderable), and
 *         this serializer keeps that property visible in the recorded contract surface.
 */
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

expect.addSnapshotSerializer({
  test: (val: unknown): boolean =>
    typeof val === 'string' && new RegExp(UUID_PATTERN, 'i').test(val),
  serialize: (val: unknown): string => {
    // mask each distinct uuid to <uuid-N>, numbered by first appearance within this value
    const seen = new Map<string, string>();
    const masked = String(val).replace(new RegExp(UUID_PATTERN, 'gi'), (hit) => {
      const priorPlaceholder = seen.get(hit);
      if (priorPlaceholder) return priorPlaceholder;
      const freshPlaceholder = `<uuid-${seen.size + 1}>`;
      seen.set(hit, freshPlaceholder);
      return freshPlaceholder;
    });
    return `"${masked}"`;
  },
});
