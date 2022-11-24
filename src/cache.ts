export interface SimpleInMemoryCache<T> {
  get: (key: string) => T | undefined;
  set: (key: string, value: T, options?: { secondsUntilExpiration?: number }) => void;
  keys: () => string[];
}

export interface SimpleInMemoryCacheState<T> {
  [index: string]: { value: T; expiresAtMse: number };
}

const getMseNow = () => new Date().getTime();

export const createCache = <T>({ defaultSecondsUntilExpiration = 5 * 60 }: { defaultSecondsUntilExpiration?: number } = {}): SimpleInMemoryCache<
  T
> => {
  // initialize a fresh in-memory cache object
  const cache: SimpleInMemoryCacheState<T> = {};

  // define how to set an item into the cache
  const set = (
    key: string,
    value: T | undefined,
    { secondsUntilExpiration = defaultSecondsUntilExpiration }: { secondsUntilExpiration?: number } = {},
  ) => {
    // handle cache invalidation
    if (value === undefined) {
      delete cache[key];
      return;
    }

    // handle setting
    const expiresAtMse = getMseNow() + secondsUntilExpiration * 1000;
    cache[key] = { value, expiresAtMse };
  };

  // define how to get an item from the cache
  const get = (key: string) => {
    const cacheContent = cache[key];
    if (!cacheContent) return undefined; // if not in cache, then undefined
    if (cacheContent.expiresAtMse < getMseNow()) return undefined; // if already expired, then undefined
    return cacheContent.value; // otherwise, its in the cache and not expired, so return the value
  };

  // define how to grab all valid keys
  const keys = () =>
    Object.entries(cache)
      .filter(([_, value]) => value.expiresAtMse > getMseNow())
      .map(([key]) => key);

  // return the api
  return { set, get, keys };
};
