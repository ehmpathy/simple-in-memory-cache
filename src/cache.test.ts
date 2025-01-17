import { createCache } from './cache';

jest.setTimeout(30 * 1000); // give up to 60 seconds, since we deal with timeouts that we want to test on the ~15 second range

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('cache', () => {
  it('should be able to add an item to the cache', () => {
    const { set } = createCache();
    set('meaning of life', 42);
  });
  it('should be able to get an item from the cache', () => {
    const { set, get } = createCache();
    set(
      'how many licks does it take to get to the center of a tootsie pop?',
      3,
    );
    const licks = get(
      'how many licks does it take to get to the center of a tootsie pop?',
    );
    expect(licks).toEqual(3);
  });
  it('should respect the default expiration for the cache', async () => {
    const { set, get } = createCache({ expiration: { seconds: 10 } }); // we're gonna use this cache to keep track of the popcorn in the microwave - we should check more regularly since it changes quickly!
    set('how popped is the popcorn?', 'not popped');

    // prove that we recorded the value and its accessible immediately after setting
    const popcornStatus = get('how popped is the popcorn?');
    expect(popcornStatus).toEqual('not popped');

    // prove that the value is still accessible after 9 seconds, since default ttl is 10 seconds
    await sleep(9 * 1000);
    const popcornStatusAfter9Sec = get('how popped is the popcorn?');
    expect(popcornStatusAfter9Sec).toEqual('not popped'); // still should say not popped

    // and prove that after a total of 9 seconds, the status is no longer in the cache
    await sleep(1 * 1000); // sleep 1 more second
    const popcornStatusAfter10Sec = get('how popped is the popcorn?');
    expect(popcornStatusAfter10Sec).toEqual(undefined); // no longer defined, since the default seconds until expiration was 15
  });
  it('should respect the item level expiration for the cache', async () => {
    const { set, get } = createCache(); // remember, default expiration is greater than 1 min
    set('ice cream state', 'solid', { expiration: { seconds: 5 } }); // ice cream changes quickly in the heat! lets keep a quick eye on this

    // prove that we recorded the value and its accessible immediately after setting
    const iceCreamState = get('ice cream state');
    expect(iceCreamState).toEqual('solid');

    // prove that the value is still accessible after 4 seconds, since default ttl is 5 seconds
    await sleep(4 * 1000);
    const iceCreamStateAfter4Sec = get('ice cream state');
    expect(iceCreamStateAfter4Sec).toEqual('solid'); // still should say solid

    // and prove that after a total of 5 seconds, the state is no longer in the cache
    await sleep(1 * 1000); // sleep 1 more second
    const iceCreamStateAfter5Sec = get('ice cream state');
    expect(iceCreamStateAfter5Sec).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 5
  });
  it('should consider secondsUntilExpiration of null as never expiring', async () => {
    const { set, get } = createCache({
      expiration: { seconds: 0 }, // expire immediately
    });

    // prove that setting something to the cache with default state will have it expired immediately
    await set('dory-memory', 'something'); // lets see if dory can remember something
    const doryMemory = await get('dory-memory');
    expect(doryMemory).toEqual(undefined); // its already gone! dang default expiration

    // prove that if we record the memory with expires-at Infinity, it persists
    await set('elephant-memory', 'something', {
      expiration: null,
    });
    const elephantMemory = await get('elephant-memory');
    expect(elephantMemory).toEqual('something');
  });
  it('should accurately get keys', () => {
    // create the cache
    const { set, keys } = createCache();

    // check key is added when value is set
    set('meaning-of-life', '42');
    const keys1 = keys();
    expect(keys1.length).toEqual(1);
    expect(keys1[0]).toEqual('meaning-of-life');

    // check that there are no duplicates when key value is updated
    set('meaning-of-life', '42.0');
    const keys2 = keys();
    expect(keys2.length).toEqual(1);
    expect(keys2[0]).toEqual('meaning-of-life');

    // check that multiple keys can be set
    set('purpose-of-life', 'propagation');
    const keys3 = keys();
    expect(keys3.length).toEqual(2);
    expect(keys3[1]).toEqual('purpose-of-life');

    // check that invalidation removes the key
    set('meaning-of-life', undefined);
    const keys4 = keys();
    expect(keys4.length).toEqual(1);
    expect(keys4[0]).toEqual('purpose-of-life');
  });
});
