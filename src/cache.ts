export interface SimpleInMemoryCache {
  [index: string]: { value: any; expiresAtMse: number };
}

const getMseNow = () => new Date().getTime();

export const createCache = ({ defaultSecondsUntilExpiration = 5 * 60 }: { defaultSecondsUntilExpiration?: number } = {}) => {
  // initialize a fresh in-memory cache object
  const cache: SimpleInMemoryCache = {};

  // define how to set an item into the cache
  const set = (key: string, value: any, { secondsUntilExpiration = defaultSecondsUntilExpiration }: { secondsUntilExpiration?: number } = {}) => {
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

  // return the api
  return { set, get };
};
