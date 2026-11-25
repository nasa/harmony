import { expect } from 'chai';
import { describe, it } from 'mocha';

import { SchemaCache, SchemaInfo } from '../app/query/schema';

const schemaNamed = (name: string): SchemaInfo => ({ tables: [{ name, columns: [] }], warnings: [], loadedAt: '' });

describe('SchemaCache', () => {
  it('caches a loaded schema', async () => {
    const cache = new SchemaCache(60);
    let loads = 0;
    const load = async (): Promise<SchemaInfo> => { loads += 1; return schemaNamed('jobs'); };
    await cache.get(load);
    await cache.get(load);
    expect(loads).to.equal(1);
  });

  it('does not cache a schema whose load started before the cache was cleared', async () => {
    const cache = new SchemaCache(60);
    let finishLoad: (schema: SchemaInfo) => void;
    const stale = cache.get(() => new Promise((resolve) => { finishLoad = resolve; }));
    cache.clear();
    finishLoad(schemaNamed('old'));
    // The caller that started the load still gets what it loaded
    expect((await stale).tables[0].name).to.equal('old');
    expect((await cache.get(async () => schemaNamed('new'))).tables[0].name).to.equal('new');
  });
});
