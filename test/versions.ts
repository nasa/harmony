import { expect } from 'chai';
import { describe, it } from 'mocha';
import hookServersStartStop from './helpers/servers';
import { hookServices } from './helpers/stub-service';
import { hookVersions } from './helpers/versions';
import hookDescribeImage from './helpers/container-registry';

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

      it('returns a listing of all of the turbo services from services.yml', function () {
        const services = JSON.parse(this.res.text);
        expect(services.map((s) => s.name)).to.eql([
          'nasa/harmony-gdal-adapter',
          'gesdisc/giovanni',
          'harmony/service-example',
          'podaac/l2-subsetter',
          'podaac/concise',
          'podaac/l2-subsetter-concise',
          'sds/swot-reproject',
          'sds/variable-subsetter',
          'sds/HOSS',
          'sds/maskfill',
          'sds/trajectory-subsetter',
          'harmony/netcdf-to-zarr',
          'harmony/podaac-l2-subsetter-netcdf-to-zarr',
          'harmony/swot-repr-netcdf-to-zarr',
        ]);
      });

      it('includes a name and list of images for each service', function () {
        const services = JSON.parse(this.res.text);
        for (const service of services) {
          expect(Object.keys(service)).to.eql(['name', 'images']);
        }
      });

      it('includes an image and tag for each of the images listed for each service', function () {
        const services = JSON.parse(this.res.text);
        for (const service of services) {
          for (const image of service.images) {
            expect(Object.keys(image)).to.eql(['image', 'tag']);
          }
        }
      });
    });
  });

  describe('when using a defined set of services', function () {
    const serviceConfigs = [
      {
        name: 'nexus-service',
        type: {
          name: 'turbo',
        },
        steps: [{
          image: 'fake-internal.earthdata.nasa.gov/nexus-service/foo:uat',
        }],
      },
      {
        name: 'my/dockerhub-service',
        type: {
          name: 'turbo',
        },
        steps: [{
          image: 'dockerhub-service/foo:v1.0.1',
        }],
      },
      {
        name: 'aws/ecr-service',
        type: {
          name: 'turbo',
        },
        steps: [{
          image: '1234567890.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/example-service:latest',
        }],
      },
      {
        name: 'an-http-service',
        type: {
          name: 'http',
        },
      },
      {
        name: 'complicated-service-chain',
        type: {
          name: 'turbo',
        },
        steps: [{
          image: 'fake-internal.earthdata.nasa.gov/nexus-service/foo:uat',
        }, {
          image: '1234567890.dkr.ecr.us-west-2.amazonaws.com/harmonyservices/example-service:latest',
          operations: ['reformat'],
        }, {
          image: 'dockerhub-service/foo:v1.0.1',
          operations: ['spatialSubset', 'variableSubset'],
          conditional: {
            exists: ['spatialSubset', 'variableSubset'],
          },
        }],
      },
    ];

    hookServices(serviceConfigs);
    hookDescribeImage({ imageDigest: 'sha256:0123456789abcdef', lastUpdated: new Date('1999-01-01') });
    describe('when hitting the versions endpoint', function () {
      hookVersions();

      describe('when an image is in a private Earthdata repo', function () {
        it('removes *.earthdata.nasa.gov from the image name', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'nexus-service');
          expect(nexusService.images[0].image).to.equal('nexus-service/foo');
        });

        it('correctly extracts the tag', function () {
          const services = JSON.parse(this.res.text);
          const nexusService = services.find((s) => s.name === 'nexus-service');
          expect(nexusService.images[0].tag).to.equal('uat');
        });
      });

      describe('when an image is in AWS ECR', function () {
        it('removes the AWS ECR account information from the image name', function () {
          const services = JSON.parse(this.res.text);
          const ecrService = services.find((s) => s.name === 'aws/ecr-service');
          expect(ecrService.images[0].image).to.equal('harmonyservices/example-service');
        });

        it('correctly extracts the tag', function () {
          const services = JSON.parse(this.res.text);
          const ecrService = services.find((s) => s.name === 'aws/ecr-service');
          expect(ecrService.images[0].tag).to.equal('latest');
        });

        it('returns the imageDigest from ECR', function () {
          const services = JSON.parse(this.res.text);
          const ecrService = services.find((s) => s.name === 'aws/ecr-service');
          expect(ecrService.images[0].imageDigest).to.equal('sha256:0123456789abcdef');
        });

        it('returns a lastUpdated field to match the imagePushedAt time from ECR', function () {
          const services = JSON.parse(this.res.text);
          const ecrService = services.find((s) => s.name === 'aws/ecr-service');
          expect(ecrService.images[0].lastUpdated).to.equal('1999-01-01T00:00:00Z');
        });
      });

      describe('when an image is a local or docker hub image', function () {
        it('does not modify the image name', function () {
          const services = JSON.parse(this.res.text);
          const dockerHubService = services.find((s) => s.name === 'my/dockerhub-service');
          expect(dockerHubService.images[0].image).to.equal('dockerhub-service/foo');
        });

        it('correctly extracts the tag', function () {
          const services = JSON.parse(this.res.text);
          const dockerHubService = services.find((s) => s.name === 'my/dockerhub-service');
          expect(dockerHubService.images[0].tag).to.equal('v1.0.1');
        });
      });

      describe('when a service chain includes multiple images', function () {
        it('includes all of the images defined in the steps for the chain', function () {
          const services = JSON.parse(this.res.text);
          const serviceChain = services.find((s) => s.name === 'complicated-service-chain');
          expect(serviceChain.images.length).to.equal(3);
          expect(serviceChain.images.map((i) => i.image)).to.eql(['nexus-service/foo', 'harmonyservices/example-service', 'dockerhub-service/foo']);
        });
      });

      it('only returns turbo services', function () {
        const services = JSON.parse(this.res.text);
        const httpService = services.find((s) => s.name === 'an-http-service');
        expect(httpService).to.be.undefined;
      });
    });
  });
});
