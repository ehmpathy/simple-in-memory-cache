# simple-in-memory-cache

![test](https://github.com/ehmpathy/simple-in-memory-cache/workflows/test/badge.svg)
![publish](https://github.com/ehmpathy/simple-in-memory-cache/workflows/publish/badge.svg)

A simple in-memory cache, for nodejs and the browser, with time based expiration policies.

# Install

```sh
npm install --save simple-in-memory-cache
```

# Example

Quickly set and get from the cache:

```ts
import { createCache } from 'simple-in-memory-cache';

const { set, get } = createCache();
set('meaning of life', 42);
const meaningOfLife = get('meaning of life'); // returns 42
```

Items in the cache live 5 minutes until expiration, by default.

You can change this default when creating the cache:

```ts
const { set, get } = createCache({ defaultSecondsUntilExpiration: 10 * 60 }); // updates the default seconds until expiration to 10 minutes
```

And you can also override this when setting an item:

```ts
set('acceleration due to gravity', 9.81, { secondsUntilExpiration: Infinity }); // gravity will not change, so we dont need to expire it
```
