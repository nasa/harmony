/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { MemoryCache } from '../../app/util/cache/memory-cache';
import { spy } from 'sinon';

describe('MemoryCache', function () {
  describe('fetch', async function () {
    // eslint-disable-next-line require-jsdoc
    async function fakeFetchMethod(_key: string): Promise<string> {
      return 'bar';
    }

    let fetchMethodSpy;
    let cache;

    beforeEach(function () {
      fetchMethodSpy = spy(fakeFetchMethod);
      cache = new MemoryCache(fetchMethodSpy);
    });

    it('calls the fetcher callback for missing keys', async function () {
      await cache.fetch('foo');
      expect(fetchMethodSpy.called).to.equal(true);
    });

    it('does not call the fetcher callback for set keys', async function () {
      await cache.set('foo', 'bar');
      await cache.fetch('foo');
      expect(fetchMethodSpy.called).to.equal(false);
    });

    it('does not call the fetcher callback more than once for a key', async function () {
      await cache.fetch('foo');
      await cache.fetch('foo');
      expect(fetchMethodSpy.calledOnce).to.equal(true);
    });

    it('returns the proper value for a given key', async function () {
      const value = await cache.fetch('foo');
      expect(value).to.equal('bar');
    });

    it('calls the fetch function only once on the same key', async function () {
      // eslint-disable-next-line require-jsdoc, @typescript-eslint/explicit-function-return-type
      let resolveFn;
      const deferred = new Promise<string>((resolve) => {
        resolveFn = resolve;
      });

      // Replace spy with one that returns a deferred promise
      fetchMethodSpy = spy(() => deferred);
      cache = new MemoryCache(fetchMethodSpy);

      const promise1 = cache.fetch('foo');
      const promise2 = cache.fetch('foo');

      expect(fetchMethodSpy.calledOnce).to.equal(true);

      // The promises returned from LRUCache will resolve to the same value, but they are different objects
      // expect(promise1).to.equal(promise2);

      // Check pending map contains only one entry for 'foo'
      expect((cache as any).pending.size).to.equal(1);
      const pendingPromise = (cache as any).pending.get('foo');
      expect(pendingPromise).to.exist;

      resolveFn('baz');

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).to.equal('baz');
      expect(result2).to.equal('baz');

      // Ensure the pending map has been cleaned up
      expect((cache as any).pending.has('foo')).to.be.false;
      expect((cache as any).pending.size).to.equal(0);
    });
  });

  describe('set and get', async function () {
    let fetchMethodSpy;
    let cache;

    beforeEach(function () {
      fetchMethodSpy = spy();
      cache = new MemoryCache(fetchMethodSpy);
    });

    it('returns `undefined` for missing keys', async function () {
      const value = await cache.get('foo');
      expect(value).to.equal(undefined);
    });

    it('does not call the fetcher callback function for missing keys', async function () {
      await cache.get('foo');
      expect(fetchMethodSpy.called).to.equal(false);
    });

    it('returns the proper value for a set key', async function () {
      await cache.set('foo', 'baz');
      const value = await cache.get('foo');
      expect(value).to.equal('baz');
    });
  });
});