import fs, { promises } from 'fs';
import path from 'path';
import { stub, spy, SinonStub } from 'sinon';
import { default as defaultLogger } from '../../../harmony/app/util/log';
import * as query from '../../app/query';
import { doWork, QueryCmrRequest } from '../../app/routers/router';
import { asyncLocalStorage } from '../../../harmony/app/util/async-store';

/**
 * Stubs the queryGranulesScrolling method and calls doWork with the given args, unlinking
 * the written output file.  Does not delete any created directories
 *
 * @returns The URL prefix for use in matching responses
 */
export function hookDoWork(workReq: QueryCmrRequest, output): void {
  let outputDir = null;
  const fakeContext = {
    id: '1234',
    logger: defaultLogger,
  };
  before(async function () {
    stub(query, 'queryGranules').callsFake((...callArgs) => {
      this.callArgs = callArgs;
      return Promise.resolve(output);
    });
    spy(promises, 'mkdir');
    // eslint-disable-next-line prefer-destructuring
    outputDir = workReq.outputDir;
    await asyncLocalStorage.run(fakeContext, async () => {
      await doWork(workReq);
    });
  });
  after(function () {
    if (this.callArgs) {
      const indexFile = path.join(outputDir, 'index.json');
      if (fs.existsSync(indexFile)) {
        fs.unlinkSync(indexFile);
      }
      delete this.callArgs;
    }
    (promises.mkdir as SinonStub).restore();
    (query.queryGranules as SinonStub).restore();
  });
}