import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookServiceMetrics } from './helpers/service-metrics';

describe('Backend service metrics endpoint', function () {

  hookServersStartStop({ skipEarthdataLogin: true });
  
  describe('when hitting the service/metrics endpoint without serviceID parameter', function () {
    hookServiceMetrics();

    it('returns 400 status code', function () {
      expect(this.res.statusCode).to.equal(400);
    });

    it('returns JSON content', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns expected message', function () {
      expect(this.res.text).to.equal('{"code":"harmony.RequestValidationError","description":"Error: required parameter \\"serviceID\\" was not provided"}');
    });
  });

  describe('when hitting the service/metrics endpoint with a non-existing serviceID', function () {
    const serviceID = 'noexisting/service:version';
    hookServiceMetrics(serviceID);

    it('returns 200 status code', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns JSON content', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns expected message', function () {
      expect(JSON.stringify(this.res.body)).to.equal(JSON.stringify({ availableWorkItems: 0 }));
    });
  });

  describe('when hitting the service/metrics endpoint with an existing serviceID', function () {
    const serviceID = 'harmony/query-cmr:latest';
    hookServiceMetrics(serviceID);

    it('returns 200 status code', function () {
      expect(this.res.statusCode).to.equal(200);
    });

    it('returns json content', function () {
      expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
    });

    it('returns expected message', function () {
      expect(JSON.stringify(this.res.body)).to.equal(JSON.stringify({ availableWorkItems: 0 }));
    });
  });

});