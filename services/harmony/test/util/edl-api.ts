import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  getEdlGroupInformation,
} from '../../app/util/edl-api';
import logger from '../../app/util/log';

describe('util/edl-api', function () {
  describe('getEdlGroupInformation', function () {
    describe('when the user is not part of the service deployers group', function () {
      it('returns isServiceDeployer:false', async function () {
        const groups = await getEdlGroupInformation('woody', logger);
        expect(groups.isServiceDeployer).is.false;
      });
    });
    describe('when the user is part of the service deployers group', function () {
      it('returns isServiceDeployer:true', async function () {
        const groups = await getEdlGroupInformation('tim', logger);
        expect(groups.isServiceDeployer).is.true;
      });
    });
  });
});