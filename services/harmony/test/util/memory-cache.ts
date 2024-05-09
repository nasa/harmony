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
    beforeEach(function () {
      fetchMethodSpy = spy(fakeFetchMethod);
    });

    it('calls fetchMethod for missing keys', async function () {
      const cache = new MemoryCache(fetchMethodSpy);
      await cache.fetch('foo');
      expect(fetchMethodSpy.called);
    });
  });
});