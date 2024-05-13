import { describe, it } from 'mocha';
import { expect } from 'chai';
import { spy } from 'sinon';
import { MemoryCache } from '../../app/util/cache/memory-cache';

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