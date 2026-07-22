# simple-in-memory-cache

![test](https://github.com/ehmpathy/simple-in-memory-cache/workflows/test/badge.svg)
![publish](https://github.com/ehmpathy/simple-in-memory-cache/workflows/publish/badge.svg)

A simple, typed, in-memory cache for nodejs and the browser with time-based expiration policies.

## install

```sh
npm install --save simple-in-memory-cache
```

## usage

### set and get

```ts
import { createCache } from 'simple-in-memory-cache';

const { set, get } = createCache();
set('purpose of life', 42);
const purpose = get('purpose of life'); // returns 42
```

### expiration

items in the cache expire after 5 minutes by default.

change the default expiration on cache creation:

```ts
const { set, get } = createCache({ expiration: { minutes: 10 } });
```

override expiration per item:

```ts
set('ice cream state', 'solid', { expiration: { seconds: 30 } });
```

set an item to never expire:

```ts
set('speed of light', 299792458, { expiration: null });
```

### invalidation

invalidate a cached item with `set(key, undefined)`:

```ts
set('purpose of life', 42);
get('purpose of life'); // returns 42

set('purpose of life', undefined);
get('purpose of life'); // returns undefined
```

### keys

list all non-expired keys in the cache:

```ts
const { set, keys } = createCache();
set('a', 1);
set('b', 2);
keys(); // returns ['a', 'b']
```

### conditional writes (put-if-absent + compare-and-set)

gate a write on a version precondition, so it succeeds only when the key is in the state you
expect. on a precondition miss the write throws `SimpleCacheConditionError` (never a silent
clobber). this makes the cache usable as a coordination primitive (locks, leases, stampede
control, optimistic concurrency).

read the current opaque version token for a key with `version(key)`:

```ts
import { createCache, SimpleCacheConditionError } from 'simple-in-memory-cache';

const { set, get, version } = createCache<string>();
```

**put-if-absent** — write only if no live entry exists (`condition: { version: null }`):

```ts
set('lock', 'worker-a', { condition: { version: null } }); // ✓ wins — key was open

try {
  set('lock', 'worker-b', { condition: { version: null } }); // ✋ throws — key held
} catch (error) {
  if (!(error instanceof SimpleCacheConditionError)) throw error;
  // worker-b lost the race, loudly — no silent overwrite
}
```

**compare-and-set** — write only if the stored version matches a token from a *prior*
observation. `version()` returns `string | undefined` while a condition wants `string | null`, so
bridge an absent read with `?? null` (absent → put-if-absent, present → compare-and-set):

```ts
set('counter', '1');
const v = version('counter'); // capture the token now

set('counter', '2', { condition: { version: v ?? null } }); // ✓ still at v
// ✋ if someone else wrote 'counter' since you read v, this throws
```

**version-checked get** — read the value only if it is still the version you last saw:

```ts
const v = version('counter');
const current = get('counter', { condition: { version: v ?? null } });
// ✓ returns the value IF it is still at version v
// ✋ throws SimpleCacheConditionError if the version drifted (the value you were about to
//    act on is stale)
```

**compare-and-delete** — release a lock only if it is still yours (`set(key, undefined, …)`):

```ts
set('lock', 'worker-a', { condition: { version: null } });
const mine = version('lock');
set('lock', undefined, { condition: { version: mine ?? null } }); // release, only if still mine
```

> ⚠️ the token must come from a *prior* observation (a `get`/`version`/acquire taken before the
> write). a fresh `version(key)` read taken immediately before its own conditional write always
> matches the current token and so guards no state — the whole point of a condition is to compare
> against a value you saw earlier.

> ⚠️ a **successful conditional write also mints a fresh token**, so the token you used to authorize
> it is immediately dead. in a renew-loop (mutex renewal), re-observe `version(key)` before *each*
> renewal — do not carry the token you acquired at lock time into the second renewal, or it will throw:
>
> ```ts
> set('lock', me, { condition: { version: null } }); // acquire
> let held = version('lock'); // token now
> set('lock', me, { condition: { version: held ?? null } }); // renew #1 → mints a new token
> held = version('lock'); // re-observe before the next renewal
> set('lock', me, { condition: { version: held ?? null } }); // renew #2 ✓ (the old token would throw)
> ```

> ⚠️ **always bridge an absent read with `?? null`.** `version()` yields `string | undefined`, but a
> condition wants `string | null`. typescript callers are safe — a bare `{ version: v }` where
> `v: string | undefined` fails to compile against the condition type. but plain-js/browser callers get
> no such guard: a `{ condition: { version: someUndefinedVar } }` meant as put-if-absent falls into the
> compare-and-set branch and **always throws**, since an `undefined` token never equals the found
> version. use `{ version: v ?? null }` so an absent read means put-if-absent, not a guaranteed miss.

## types

the cache is fully typed:

```ts
import { createCache, SimpleInMemoryCache } from 'simple-in-memory-cache';

const cache: SimpleInMemoryCache<number> = createCache<number>();
cache.set('answer', 42);
const answer: number | undefined = cache.get('answer');
```

## api

### `createCache<T>(options?)`

creates a new cache instance.

**options:**
- `expiration?: IsoDuration | null` — default expiration for items (default: `{ minutes: 5 }`)

**returns:** `SimpleInMemoryCache<T>`

### `SimpleInMemoryCache<T>`

- `get(key, options?): T | undefined` — retrieve an item (returns `undefined` if absent or
  expired). with `options.condition`, verify the stored version before it yields the value; on a
  mismatch throw `SimpleCacheConditionError` (version-checked get).
- `set(key, value, options?): void` — store an item (or invalidate with `value: undefined`). with
  `options.condition`, gate the write: `{ version: null }` = put-if-absent, `{ version: '<token>' }`
  = compare-and-set; on a precondition miss throw `SimpleCacheConditionError`.
- `version(key): string | undefined` — read the current opaque version token for a live key
  (`undefined` if absent or expired). treat the token as equality-only; never parse or order it.
- `keys(): string[]` — list all non-expired keys

**options** (both `get` and `set`):
- `condition?: { version: string | null }` — the version precondition (see conditional writes above)

**options** (`set` only):
- `expiration?: IsoDuration | null` — override the item's expiration (`null` = never expire)

### `SimpleCacheConditionError`

thrown by `get`/`set` when a `condition.version` precondition is not met. extends `ConstraintError`
(from `helpful-errors`) — a caller-must-fix constraint (exit code 2). carries
`{ key, condition, found }` metadata for diagnosis.
