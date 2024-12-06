import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  getEdlGroupInformation,
} from '../../app/util/edl-api';
import { stubEdlRequest, token, unstubEdlRequest } from '../helpers/auth';
import { asyncLocalStorage } from '../../app/util/async-store';

const fakeContext = {
  id: '1234',
};

describe('util/edl-api', function () {
  describe('getEdlGroupInformation', function () {
    before(function () {
      stubEdlRequest(
        '/oauth/token',
        { grant_type: 'client_credentials' },
        token({ accessToken: 'fake_access' }),
      );
    });
    after(function () {
      unstubEdlRequest();
    });
    describe('when the user is not part of the service deployers group', function () {
      it('returns isServiceDeployer:false', async function () {
        await asyncLocalStorage.run(fakeContext, async () => {
          const groups = await getEdlGroupInformation('joe');
          expect(groups.isServiceDeployer).is.false;
        });
      });
    });
    describe('when the user is part of the service deployers and log viewers group', function () {
      it('returns isServiceDeployer:true', async function () {
        await asyncLocalStorage.run(fakeContext, async () => {
          const groups = await getEdlGroupInformation('eve');
          expect(groups.isServiceDeployer).is.true;
        });
      });
    });
    describe('when the user is part of the service deployers group', function () {
      it('returns isServiceDeployer:true', async function () {
        await asyncLocalStorage.run(fakeContext, async () => {
          const groups = await getEdlGroupInformation('buzz');
          expect(groups.isServiceDeployer).is.true;
        });
      });
    });
  });
});