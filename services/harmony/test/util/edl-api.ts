import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  getEdlGroupInformation,
} from '../../app/util/edl-api';
import { stubEdlRequest, token, unstubEdlRequest } from '../helpers/auth';

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
        const groups = await getEdlGroupInformation({ id: '1234' }, 'joe');
        expect(groups.isServiceDeployer).is.false;
      });
    });
    describe('when the user is part of the service deployers and log viewers group', function () {
      it('returns isServiceDeployer:true', async function () {
        const groups = await getEdlGroupInformation({ id: '1234' }, 'eve');
        expect(groups.isServiceDeployer).is.true;
      });
    });
    describe('when the user is part of the service deployers group', function () {
      it('returns isServiceDeployer:true', async function () {
        const groups = await getEdlGroupInformation({ id: '1234' }, 'buzz');
        expect(groups.isServiceDeployer).is.true;
      });
    });
  });
});