import { given, then, when } from 'test-fns';
// type-only import — erased at compile, adds no runtime edge (with-simple-cache is dev-only)
import type { SimpleCacheSync, WithCacheConditionals } from 'with-simple-cache';

import { createCache } from './cache';

/**
 * .what = compile-time proof that our cache satisfies the shipped conditional-write contract
 * .why = the #19 acceptance — a consumer can require WithCacheConditionals<SimpleCacheSync<T>>
 *        of this cache and it structurally fits. the assignment below fails to compile if the
 *        interface ever drifts (absent version, narrowed get/set condition slot, etc.)
 */
describe('cache.conformance', () => {
  given('[case1] a cache created by createCache', () => {
    when('[t0] typechecked against the shipped contract', () => {
      then('it satisfies WithCacheConditionals<SimpleCacheSync<T>>', () => {
        const cache = createCache<string>();

        // the assertion: our cache is assignable to the shipped conditional-write contract
        const conformant: WithCacheConditionals<SimpleCacheSync<string>> =
          cache;

        expect(conformant).toBe(cache);
      });
    });
  });
});
