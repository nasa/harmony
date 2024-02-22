import { expect } from 'chai';
import request from 'supertest';

import hookServersStartStop from './helpers/servers';
import { hookRedirect } from './helpers/hooks';
import { auth } from './helpers/auth';

//
// Tests for the service-image endpoint
//
// Note: this test relies on the EDL fixture that includes users `eve` and `buzz` in the
// deployers group and `adam` in the admin group, and `joe` in neither
//

const serviceImages = {
  'service-runner': 'latest',
  'harmony-gdal-adapter': 'latest',
  'hybig': 'latest',
  'harmony-service-example': 'latest',
  'harmony-netcdf-to-zarr': 'latest',
  'harmony-regridder': 'latest',
  'swath-projector': 'latest',
  'hoss': 'latest',
  'sds-maskfill': 'latest',
  'trajectory-subsetter': 'latest',
  'podaac-concise': 'sit',
  'podaac-l2-subsetter': 'sit',
  'podaac-ps3': 'latest',
  'podaac-netcdf-converter': 'latest',
  'query-cmr': 'latest',
  'giovanni-adapter': 'latest',
  'geoloco': 'latest',
  'batchee': 'latest',
  'stitchee': 'latest',
};

const errorMsg404 = 'Service foo does not exist.\nThe existing services and their images are\n' +
  JSON.stringify(serviceImages, null, 2);

const userErrorMsg = 'User joe is not in the service deployers or admin EDL groups';

const tagContentErrorMsg = 'A tag name may contain lowercase and uppercase characters, digits, underscores, periods and dashes. A tag name may not start with a period or a dash and may contain a maximum of 128 characters.';

describe('Service image endpoint', async function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('List service images', async function () {
    describe('when a user is not in the EDL service deployers or admin groups', async function () {
      before(async function () {
        hookRedirect('joe');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'joe' }));
      });

      after(function () {
        delete this.res;
      });

      it('rejects the user', async function () {
        expect(this.res.status).to.equal(403);
      });

      it('returns a meaningful error message', async function () {
        expect(this.res.text).to.equal(userErrorMsg);
      });
    });

    describe('when a user is in the EDL service deployers group', async function () {
      before(async function () {
        hookRedirect('buzz');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'buzz' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a map of images', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body).to.eql(serviceImages);
      });
    });

    describe('when a user is in the EDL admin group', async function () {
      before(async function () {
        hookRedirect('adam');
        this.res = await request(this.frontend).get('/service-image-tag').use(auth({ username: 'adam' }));
      });

      after(function () {
        delete this.res;
      });

      it('returns a map of images', async function () {
        expect(this.res.status).to.equal(200);
        expect(this.res.body).to.eql(serviceImages);
      });
    });
  });

//   describe('Get service image', async function () {
//     describe('when a user is not in the EDL service deployers or admin groups', async function () {

//       describe('when the service does not exist', async function () {
//         before(async function () {
//           hookRedirect('joe');
//           this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'joe' }));
//         });

//         after(function () {
//           delete this.res;
//         });

//         it('rejects the user', async function () {
//           expect(this.res.status).to.equal(403);
//         });

//         it('returns a meaningful error message', async function () {
//           expect(this.res.text).to.equal(userErrorMsg);
//         });

//       });

//       describe('when the service does exist', async function () {
//         before(async function () {
//           hookRedirect('joe');
//           this.res = await request(this.frontend).get('/service-image-tag/hoss').use(auth({ username: 'joe' }));
//         });

//         after(function () {
//           delete this.res;
//         });

//         it('rejects the user', async function () {
//           expect(this.res.status).to.equal(403);
//         });

//         it('returns a meaningful error message', async function () {
//           expect(this.res.text).to.equal(userErrorMsg);
//         });

//       });
//     });

//     describe('when a user is in the EDL service deployers group', async function () {

//       describe('when the service does not exist', async function () {
//         before(async function () {
//           hookRedirect('buzz');
//           this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'buzz' }));
//         });

//         after(function () {
//           delete this.res;
//         });

//         it('returns a status 404', async function () {
//           expect(this.res.status).to.equal(404);
//         });

//         it('returns a meaningful error message', async function () {
//           expect(this.res.text).to.equal(errorMsg404);
//         });

//       });

//       describe('when the service does exist', async function () {
//         before(async function () {
//           hookRedirect('buzz');
//           this.res = await request(this.frontend).get('/service-image-tag/hoss').use(auth({ username: 'buzz' }));
//         });

//         after(function () {
//           delete this.res;
//         });

//         it('returns a status 200', async function () {
//           expect(this.res.status).to.equal(200);
//         });

//         it('returns the service image information', async function () {
//           expect(this.res.body).to.eql({
//             'tag': 'latest',
//           });
//         });

//       });
//     });

//     describe('when a user is in the EDL admin group', async function () {

//       describe('when the service does not exist', async function () {
//         before(async function () {
//           hookRedirect('adam');
//           this.res = await request(this.frontend).get('/service-image-tag/foo').use(auth({ username: 'adam' }));
//         });

//         after(function () {
//           delete this.res;
//         });

//         it('returns a status 404', async function () {
//           expect(this.res.status).to.equal(404);
//         });

//         it('returns a meaningful error message', async function () {
//           expect(this.res.text).to.equal(errorMsg404);
//         });

//       });

//       describe('when the service does exist', async function () {
//         before(async function () {
//           hookRedirect('adam');
//           this.res = await request(this.frontend).get('/service-image-tag/hoss').use(auth({ username: 'adam' }));
//         });

//         after(function () {
//           delete this.res;
//         });

//         it('returns a status 200', async function () {
//           expect(this.res.status).to.equal(200);
//         });

//         it('returns the service image information', async function () {
//           expect(this.res.body).to.eql({
//             'tag': 'latest',
//           });
//         });

//       });
//     });

//   });

//   describe('Update service image', function () {
//     describe('when a user is not in the EDL service deployers or admin groups', async function () {

//       before(async function () {
//         hookRedirect('joe');
//         this.res = await request(this.frontend).put('/service-image-tag/hoss').use(auth({ username: 'joe' }));
//       });

//       after(function () {
//         delete this.res;
//       });

//       it('rejects the user', async function () {
//         expect(this.res.status).to.equal(403);
//       });

//       it('returns a meaningful error message', async function () {
//         expect(this.res.text).to.equal(userErrorMsg);
//       });
//     });

//     describe('when the service does not exist', async function () {

//       before(async function () {
//         hookRedirect('buzz');
//         this.res = await request(this.frontend).put('/service-image-tag/foo').use(auth({ username: 'buzz' }));
//       });

//       after(function () {
//         delete this.res;
//       });

//       it('returns a status 404', async function () {
//         expect(this.res.status).to.equal(404);
//       });

//       it('returns a meaningful error message', async function () {
//         expect(this.res.text).to.equal(errorMsg404);
//       });
//     });

//     describe('when the tag is not sent in the request', async function () {

//       before(async function () {
//         hookRedirect('buzz');
//         this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' }));
//       });

//       after(function () {
//         delete this.res;
//       });

//       it('returns a status 400', async function () {
//         expect(this.res.status).to.equal(400);
//       });

//       it('returns a meaningful error message', async function () {
//         expect(this.res.text).to.equal('\'tag\' is a required body parameter');
//       });
//     });

//     describe('when the user is in the deployers group, but the tag has invalid characters', async function () {

//       before(async function () {
//         hookRedirect('buzz');
//         this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo:bar' });
//       });

//       after(function () {
//         delete this.res;
//       });

//       it('returns a status 400', async function () {
//         expect(this.res.status).to.equal(400);
//       });

//       it('returns a meaningful error message', async function () {
//         expect(this.res.text).to.equal(tagContentErrorMsg);
//       });
//     });

//     describe('when the user is in the deployers group and a valid tag is sent in the request', async function () {

//       before(async function () {
//         hookRedirect('buzz');
//         this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' })).send({ tag: 'foo' });
//       });

//       after(function () {
//         delete this.res;
//       });

//       it('returns a status 201', async function () {
//         expect(this.res.status).to.equal(201);
//       });

//       it('returns the tag we sent', async function () {
//         expect(this.res.body).to.eql({ 'tag': 'foo' });
//       });

//       // TODO HARMONY-1701 enable this test or remove it as you see fit
//       // describe('when the user checks the tag', async function () {
//       //   before(async function () {
//       //     hookRedirect('buzz');
//       //     this.res = await request(this.frontend).get('/service-image-tag/harmony-service-example').use(auth({ username: 'buzz' }));
//       //   });

//       //   after(function () {
//       //     delete this.res;
//       //   });

//       //   it('returns the updated tag', async function () {
//       //     expect(this.res.body).to.eql({
//       //       'tag': 'foo',
//       //     });
//       //   });
//       // });
//     });

//     describe('when the user is in the admin group and a valid tag is sent in the request', async function () {

//       before(async function () {
//         hookRedirect('adam');
//         this.res = await request(this.frontend).put('/service-image-tag/harmony-service-example').use(auth({ username: 'adam' })).send({ tag: 'foo' });
//       });

//       after(function () {
//         delete this.res;
//       });

//       it('returns a status 201', async function () {
//         expect(this.res.status).to.equal(201);
//       });

//       it('returns the tag we sent', async function () {
//         expect(this.res.body).to.eql({ 'tag': 'foo' });
//       });

//       // TODO HARMONY-1701 enable this test or remove it as you see fit
//       // describe('when the user checks the tag', async function () {
//       //   before(async function () {
//       //     hookRedirect('adam');
//       //     this.res = await request(this.frontend).get('/service-image-tag/harmony-service-example').use(auth({ username: 'adam' }));
//       //   });

//       //   after(function () {
//       //     delete this.res;
//       //   });

//       //   it('returns the updated tag', async function () {
//       //     expect(this.res.body).to.eql({
//       //       'tag': 'foo',
//       //     });
//       //   });
//       // });
//     });
//   });
});
