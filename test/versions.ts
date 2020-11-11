import { expect } from 'chai';
import { describe, it } from 'mocha';
import { stub } from 'sinon';
import hookServersStartStop from './helpers/servers';
import { hookServices } from './helpers/stub-service';
import { hookVersions } from './helpers/versions';
import env from '../app/util/env';

describe('Versions endpoint', function () {
  hookServersStartStop();
  describe('when using the services from services.yml', function () {
    describe('when hitting the versions endpoint', function () {
      hookVersions();

      it('returns a 200 success', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns a JSON response', function () {
        expect(this.res.get('Content-Type')).to.equal('application/json; charset=utf-8');
      });

      it('returns a listing of all of the argo services from services.yml', function () {
        const services = JSON.parse(this.res.text);
        expect(services.map((s) => s.name)).to.eql([
          'asfdataservices/gdal-subsetter',
          'harmony/gdal',
          'podaac/l2-subsetter',
          'ds/swot-reproject',
          'sds/variable-subsetter',
          'harmony/chaining-example',
          'podaac/ps3',
          'podaac/netcdf-converter',
          'harmony/netcdf-to-zarr',
        ]);
      });

      it('includes a name, image, tag, and imagePullPolicy fields for each service', function () {
        const services = JSON.parse(this.res.text);
        for (const service of services) {
          expect(Object.keys(service)).to.eql(['name', 'image', 'tag', 'image_pull_policy']);
        }
      });
    });
  });

  describe('when using a defined set of services', function () {
    const serviceConfigs = [
      {
        name: 'nexus-service',
        type: {
          name: 'argo',
          params: {
            image: 'maven.earthdata.nasa.gov/nexus-service/foo:uat',
            image_pull_policy: 'Whenever I feel like it',
          },
        },
      },
      {
        name: 'my/dockerhub-service',
        type: {
          name: 'argo',
          params: {
            image: 'dockerhub-service/foo:v1.0.1',
            image_pull_policy: '¯\\_(ツ)_/¯',
          },
        },
      },
      {
        name: 'aws/ecr-service-no-pull-policy',
        type: {
          name: 'argo',
          params: {
            image: '1234567890.dkr.ecr.us-west-2.amazonaws.com/harmony/gdal:latest',
          },
        },
      },
      {
        name: 'an-http-service',
        type: {
          name: 'http',
        },
      },
    ];

    hookServices(serviceConfigs);
    describe('when hitting the versions endpoint', function () {
      let pullPolicyStub;
      before(() => {
        pullPolicyStub = stub(env, 'defaultImagePullPolicy').get(() => 'Default value');
      });
      after(() => {
        pullPolicyStub.restore();
      });

      hookVersions();

      describe('when an image is in the nexus repo', function () {
        it('removes maven.earthdata.nasa.gov from the image name', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'nexus-service');
          expect(nexusService.image).to.equal('nexus-service/foo');
        });

        it('correctly extracts the tag', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'nexus-service');
          expect(nexusService.tag).to.equal('uat');
        });

        it('correctly returns the image pull policy', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'nexus-service');
          expect(nexusService.image_pull_policy).to.equal('Whenever I feel like it');
        });
      });

      describe('when an image is in AWS ECR', function () {
        it('removes the AWS ECR account information from the image name', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'aws/ecr-service-no-pull-policy');
          expect(nexusService.image).to.equal('harmony/gdal');
        });

        it('correctly extracts the tag', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'aws/ecr-service-no-pull-policy');
          expect(nexusService.tag).to.equal('latest');
        });

        it('correctly returns the image pull policy', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'aws/ecr-service-no-pull-policy');
          expect(nexusService.image_pull_policy).to.equal('Default value');
        });
      });

      describe('when an image is a local or dockerhub image', function () {
        it('does not modify the image name', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'my/dockerhub-service');
          expect(nexusService.image).to.equal('dockerhub-service/foo');
        });

        it('correctly extracts the tag', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'my/dockerhub-service');
          expect(nexusService.tag).to.equal('v1.0.1');
        });

        it('correctly returns the image pull policy', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'my/dockerhub-service');
          expect(nexusService.image_pull_policy).to.equal('¯\\_(ツ)_/¯');
        });
      });

      it('only returns argo services', function () {
        const services = JSON.parse(this.res.text);
        const httpService = services.find((s) => s.name === 'an-http-service');
        expect(httpService).to.be.undefined;
      });
    });
  });
});
