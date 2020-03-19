/* eslint-disable max-len */
// const fs = require('fs');
// const path = require('path');
// const knex = require('knex');
const { describe, it } = require('mocha');
const { expect } = require('chai');
const cookieParser = require('cookie-parser');
const { hookServersStartStop } = require('../helpers/servers');
// const { hookPostRangesetRequest, postRangesetRequest } = require('../helpers/ogc-api-coverages');
const { postRangesetRequest } = require('../helpers/ogc-api-coverages');
// const { jobStatus, itIncludesRequestUrl } = require('../helpers/jobs');
// const { auth } = require('../helpers/auth');
// const { hookSignS3Object } = require('../helpers/object-store');
const { hookCmr } = require('../helpers/stub-cmr');
// const StubService = require('../helpers/stub-service');

// const isUUID = require('../../app/util/uuid');

// describe('dummy test', function () {
//   it('dummy', function () {
//     const x = 1;

//     expect(x).to.equal(1);
//   });
// });

describe('OGC API Coverages - getCoverageRangeset with shapefile', function () {
  const collection = 'C1233800302-EEDTEST';
  // const granuleId = 'G1233800343-EEDTEST';
  // const variableId = 'V1233801695-EEDTEST';
  const variableName = 'red_var';
  const version = '1.0.0';

  hookServersStartStop({ skipEarthdataLogin: false });

  // describe('when provided a valid set of parameters', function () {
  //   const form = {
  //     subset: ['time("2020-01-02T00:00:00.000Z":"2020-01-02T01:00:00.000Z")'],
  //     interpolation: 'near',
  //     scaleExtent: '0,2500000.3,1500000,3300000',
  //     scaleSize: '1.1,2',
  //     height: 500,
  //     width: 1000,
  //     outputCrs: 'CRS:84',
  //     shapefile: 'africa.zip',
  //   };

  //   describe('calling the backend service', function () {
  //     StubService.hook({ params: { redirect: 'http://example.com' } });
  //     hookPostRangesetRequest(version, collection, variableName, form);

  //     it('passes the source collection to the backend', function () {
  //       const source = this.service.operation.sources[0];
  //       expect(source.collection).to.equal(collection);
  //     });

  //     it('passes the source variable to the backend', function () {
  //       const source = this.service.operation.sources[0];
  //       expect(source.variables.length === 1);
  //       expect(source.variables[0].id).to.equal(variableId);
  //     });

  //     it('correctly identifies the granules based on the shapefile', function () {
  //       const source = this.service.operation.sources[0];
  //       expect(source.granules.length === 1);
  //       expect(source.granules[0].id).to.equal(granuleId);
  //     });

  //     it('passes the outputCrs parameter to the backend in Proj4 format', function () {
  //       expect(this.service.operation.crs).to.equal('+proj=longlat +datum=WGS84 +no_defs');
  //     });

  //     it('passes the client parameter to the backend', function () {
  //       expect(this.service.operation.client).to.equal('harmony-test');
  //     });

  //     it('passes the user parameter to the backend', function () {
  //       expect(this.service.operation.user).to.equal('anonymous');
  //     });

  //     it('passes the synchronous mode parameter to the backend and is set to true', function () {
  //       expect(this.service.operation.isSynchronous).to.equal(true);
  //     });

  //     it('passes the request id parameter to the backend', function () {
  //       expect(isUUID(this.service.operation.requestId)).to.equal(true);
  //     });

  //     it('passes the interpolation parameter to the backend', function () {
  //       expect(this.service.operation.interpolationMethod).to.equal('near');
  //     });
  //     it('passes the scaleExtent parameter to the backend', function () {
  //       expect(this.service.operation.scaleExtent).to.eql({
  //         x: { min: 0, max: 1500000 },
  //         y: { min: 2500000.3, max: 3300000 },
  //       });
  //     });
  //     it('passes the scaleSize parameter to the backend', function () {
  //       expect(this.service.operation.scaleSize).to.eql({ x: 1.1, y: 2 });
  //     });
  //     it('passes the height parameter to the backend', function () {
  //       expect(this.service.operation.outputHeight).to.equal(500);
  //     });
  //     it('passes the width parameter to the backend', function () {
  //       expect(this.service.operation.outputWidth).to.equal(1000);
  //     });
  //   });
  // });

  describe('Validation', function () {
    const secret = process.env.COOKIE_SECRET;
    // it('returns an HTTP 400 "Bad Request" error with explanatory message when the shapefile is corrupt', async function () {
    //   const res = await postRangesetRequest(
    //     this.frontend,
    //     version,
    //     collection,
    //     variableName,
    //     { shapefile }, // TODO: make correct form
    //   );
    //   expect(res.status).to.equal(400); // TODO: Set correct code
    //   expect(res.body).to.eql({
    //     code: 'harmony.RequestValidationError',
    //     description: 'Error: Coverages were not found for the provided CMR collection: NotAVariable',
    //   });
    // });

    describe('when the CMR returns a 5xx', function () {
      hookCmr('queryGranulesForCollectionWithMultipartForm', 500, 'Internal error');
      it('returns an HTTP 503 "Service unavailable" error', async function () {
        const res = await postRangesetRequest(
          this.frontend,
          version,
          collection,
          variableName,
          { shapefile: { path: './fixtures/southern_africa.zip', mimetype: 'application/shapefile+zip' } },
        );
        expect(res.status).to.equal(303);
        // TODO: Figure out how to follow the redirect (with cookies set)
        const cookies = res.headers['set-cookie'].map((cookie) => {
          const [key, value] = cookie.split('=');
          const decoded = cookieParser.signedCookie(value, secret);
          const rval = {};
          rval[key] = decoded;
          return rval;
        });
        console.log(cookies);
        expect(res.body).to.eql({
          code: 'harmony.CmrError',
          description: 'Service unavailable',
        });
      });
    });
  });
});
