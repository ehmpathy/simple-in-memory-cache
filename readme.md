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

- `get(key: string): T | undefined` — retrieve an item (returns `undefined` if absent or expired)
- `set(key: string, value: T, options?): void` — store an item (or invalidate with `undefined`)
- `keys(): string[]` — list all non-expired keys
