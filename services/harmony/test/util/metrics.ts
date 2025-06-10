import { expect } from 'chai';
import { describe, it } from 'mocha';

import DataOperation from '../../app/models/data-operation';
import HarmonyRequest from '../../app/models/harmony-request';
import { JobStatus } from '../../app/models/job';
import db from '../../app/util/db';
import { getProductMetric, getRequestMetric, getResponseMetric } from '../../app/util/metrics';
import { parseSchemaFile } from '../helpers/data-operation';
import { buildJob } from '../helpers/jobs';

const operation = new DataOperation(parseSchemaFile('valid-operation-input.json'));
const request = { headers: { 'x-forwarded-for': '1.2.3.4, 5.1.2.3' } } as unknown as HarmonyRequest;

describe('Metrics construction', function () {
  describe('Getting the request metric', function () {
    describe('when an operation contains all fields', function () {
      const metric = getRequestMetric(request, operation, 'a neat service', 'S123-PROV1');

      it('includes all of the fields in the metric', function () {
        expect(Object.keys(metric)).to.eql([
          'request_id', 'user_ip', 'user_id', 'parameters', 'bbox', 'rangeBeginDateTime', 'rangeEndDateTime',
        ]);
      });

      it('sets the request ID correctly', function () {
        expect(metric.request_id).to.equal(operation.requestId);
      });

      it('sets the user IP correctly the first forwarded IP address', function () {
        expect(metric.user_ip).to.equal('1.2.3.4');
      });

      it('sets the user ID correctly', function () {
        expect(metric.user_id).to.equal('test-user');
      });

      it('sets the service name correctly', function () {
        expect(metric.parameters.service_name).to.equal('a neat service');
      });

      it('always sets the service provider to harmony', function () {
        expect(metric.parameters.service_provider).to.equal('harmony');
      });

      it('sets the service id correctly', function () {
        expect(metric.parameters.service_id).to.equal('S123-PROV1');
      });

      it('sets the bbox correctly', function () {
        expect(metric.bbox).to.eql({ west: -130, south: -45, north: 45, east: 130 });
      });

      it('sets the rangeBeginDateTime correctly', function () {
        expect(metric.rangeBeginDateTime).to.equal('1999-01-01T10:00:00.000Z');
      });

      it('sets the rangeEndDateTime correctly', function () {
        expect(metric.rangeEndDateTime).to.equal('2020-02-20T15:00:00.000Z');
      });
    });

    describe('when the operation does not include bbox subsetting', function () {
      const operationNoBbox = new DataOperation(parseSchemaFile('valid-operation-input.json'));
      operationNoBbox.boundingRectangle = null;

      const metric = getRequestMetric(request, operationNoBbox, 'a neat service', 'S123-PROV1');

      it('does not include a bbox in the metric', function () {
        expect(Object.keys(metric)).to.eql([
          'request_id', 'user_ip', 'user_id', 'parameters', 'rangeBeginDateTime', 'rangeEndDateTime',
        ]);
      });
    });

    describe('when the operation does not include a range beginning time', function () {
      const operationNoBeginTime = new DataOperation(parseSchemaFile('valid-operation-input.json'));
      operationNoBeginTime.temporal.start = null;

      const metric = getRequestMetric(request, operationNoBeginTime, 'a neat service', 'S123-PROV1');

      it('does not include a rangeBeginDateTime in the metric', function () {
        expect(Object.keys(metric)).to.eql([
          'request_id', 'user_ip', 'user_id', 'parameters', 'bbox', 'rangeEndDateTime',
        ]);
      });
    });

    describe('when the operation does not include a range ending time', function () {
      const operationNoEndTime = new DataOperation(parseSchemaFile('valid-operation-input.json'));
      operationNoEndTime.temporal.end = null;

      const metric = getRequestMetric(request, operationNoEndTime, 'a neat service', 'S123-PROV1');

      it('does not include a rangeEndDateTime in the metric', function () {
        expect(Object.keys(metric)).to.eql([
          'request_id', 'user_ip', 'user_id', 'parameters', 'bbox', 'rangeBeginDateTime',
        ]);
      });
    });

    describe('when the request does not include an IP address', function () {
      const operationNoEndTime = new DataOperation(parseSchemaFile('valid-operation-input.json'));
      operationNoEndTime.temporal.end = null;

      const metric = getRequestMetric({} as HarmonyRequest, operation, 'a neat service', 'S123-PROV1');

      it('includes a blank string for the user_ip', function () {
        expect(metric.user_ip).to.eql('');
      });
    });

    describe('when the request does not include a UMM-S concept ID', function () {
      const operationNoEndTime = new DataOperation(parseSchemaFile('valid-operation-input.json'));
      operationNoEndTime.temporal.end = null;

      const metric = getRequestMetric({} as HarmonyRequest, operation, 'a neat service', undefined);

      it('does not set a service_id', function () {
        expect(metric.parameters.service_id).to.be.undefined;
      });
    });
  });

  describe('Getting the product metric', function () {
    describe('when the job was successful', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.SUCCESSFUL;
        await job.save(db);
        this.job = job;
        this.metric = getProductMetric(operation, job);
      });

      it('includes all of the fields', function () {
        expect(Object.keys(this.metric)).to.eql([
          'request_id', 'product_data', 'job_data', 'http_response_code',
        ]);
      });

      it('sets the http response code to 200', function () {
        expect(this.metric.http_response_code).to.equal(200);
      });

      it('sets the request ID correctly', function () {
        expect(this.metric.request_id).to.equal(operation.requestId);
      });

      it('sets the product_data correctly', function () {
        expect(this.metric.product_data).to.eql({
          collectionId: 'harmony_example___1',
          shortName: 'harmony_example',
          versionId: '1',
          variables: ['alpha_var'],
        });
      });

      it('sets the job_data correctly', function () {
        expect(this.metric.job_data).to.eql({
          job_id: this.job.jobID,
          startTime: this.job.createdAt.toISOString(),
          endTime: this.job.updatedAt.toISOString(),
          status: this.job.status,
          sub_services: {
            regridding: true,
            subsetting: true,
            formatConversion: true,
          },
        });
      });

    });

    describe('when the job failed', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.FAILED;
        await job.save(db);
        this.job = job;
        this.metric = getProductMetric(operation, job);
      });

      it('sets the http status code to 500', function () {
        expect(this.metric.http_response_code).to.equal(500);
      });
    });

    describe('when the operation does not include reprojection', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.FAILED;
        await job.save(db);
        this.job = job;
        const operationNoReprojection = new DataOperation(parseSchemaFile('valid-operation-input.json'));
        operationNoReprojection.crs = null;
        this.metric = getProductMetric(operationNoReprojection, job);
      });

      it('sets regridding to false', function () {
        expect(this.metric.job_data.sub_services.regridding).to.be.false;
      });
    });

    describe('when the operation does not include format conversion', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.FAILED;
        await job.save(db);
        this.job = job;
        const operationNoReformat = new DataOperation(parseSchemaFile('valid-operation-input.json'));
        operationNoReformat.outputFormat = null;
        this.metric = getProductMetric(operationNoReformat, job);
      });

      it('sets format conversion to false', function () {
        expect(this.metric.job_data.sub_services.formatConversion).to.be.false;
      });
    });

    describe('when the operation does not include any type of subsetting', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.FAILED;
        await job.save(db);
        this.job = job;
        const operationNoSubsetting = new DataOperation(parseSchemaFile('valid-operation-input.json'));
        operationNoSubsetting.geojson = null;
        operationNoSubsetting.boundingRectangle = null;
        operationNoSubsetting.sources[0].variables = null;
        operationNoSubsetting.dimensions = [];
        operationNoSubsetting.temporal = {};
        this.metric = getProductMetric(operationNoSubsetting, job);
      });

      it('sets subsetting to false', function () {
        expect(this.metric.job_data.sub_services.subsetting).to.be.false;
      });
    });
  });

  describe('getting the response metric', function () {
    describe('when the job was successful', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.SUCCESSFUL;
        await job.save(db);
        this.job = job;
        this.metric = await getResponseMetric(operation, job, 123.45, 0.13);
      });

      it('includes all of the fields', function () {
        expect(Object.keys(this.metric)).to.eql([
          'request_id', 'job_ids', 'http_response_code', 'time_completed', 'total_time', 'original_size', 'output_size',
        ]);
      });

      it('sets the request ID correctly', function () {
        expect(this.metric.request_id).to.equal('c045c793-19f1-43b5-9547-c87a5c7dfadb');
      });

      it('sets the job IDs correctly', function () {
        expect(this.metric.job_ids).to.eql([this.job.jobID]);
      });

      it('sets the http response code to 200', function () {
        expect(this.metric.http_response_code).to.equal(200);
      });

      it('sets the time completed correctly', function () {
        expect(this.metric.time_completed).to.equal(this.job.updatedAt.toISOString());
      });

      it('sets the total_time correctly', function () {
        expect(this.metric.total_time).to.equal((this.job.updatedAt.getTime() - this.job.createdAt.getTime()) / 1000);
      });

      it('sets the original size correctly', function () {
        expect(this.metric.original_size).to.equal(123.45);
      });

      it('sets the output size correctly', function () {
        expect(this.metric.output_size).to.equal(0.13);
      });
    });

    describe('when the job failed', function () {
      before(async function () {
        const job = buildJob();
        job.status = JobStatus.FAILED;
        await job.save(db);
        this.job = job;
        this.metric = await getResponseMetric(operation, job, 123.45, 0.13);
      });

      it('sets the http response code to 500', function () {
        expect(this.metric.http_response_code).to.equal(500);
      });
    });
  });
});