import { JobRecord, JobStatus, Job } from './../../app/models/job';
import {
  hookSkipPreview,
  buildJob,
  jobsEqual,
  hookSkipPreviewWithGET,
  adminUsername,
  hookAdminSkipPreviewWithGET,
  hookAdminSkipPreview,
  skipPreview,
  jobStatus,
} from './../helpers/jobs';

import { expect } from 'chai';
import { v4 as uuid } from 'uuid';
import _ from 'lodash';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction } from '../helpers/db';
import { hookRedirect } from '../helpers/hooks';
import { getWorkflowStepsByJobId } from '../../app/models/workflow-steps';
import db from '../../app/util/db';
import { createDecrypter, createEncrypter } from '../../app/util/crypto';
import env from '../../app/util/env';
import DataOperation from '../../app/models/data-operation';
import { buildWorkflowStep } from '../helpers/workflow-steps';
import { hookRangesetRequest } from '../helpers/ogc-api-coverages';
import { auth } from '../helpers/auth';

const normalUsername = 'joe';

// unit tests for skipping job preview

describe('Previewing jobs', function () {
  describe('When a job is previewing', function () {
    const requestId = uuid();
    const previewingJob = new Job({
      jobID: requestId,
      username: 'anonymous',
      requestId,
      status: JobStatus.PREVIEWING,
      request: 'foo',
      numInputGranules: 10,
      collectionIds: ['C123'],
    });

    describe('and it is resumed', function () {
      it('throws an error', function () {
        expect(previewingJob.resume.bind(previewingJob)).to.throw('Job status is previewing - only paused jobs can be resumed.');
      });
    });

    describe('and an attempt is made to skip the preview', function () {
      it('status is RUNNING', function () {
        previewingJob.skipPreview();
        expect(previewingJob.status).to.eql(JobStatus.RUNNING);
        expect(previewingJob.isPaused()).to.be.false;
      });
    });
  });
});

// integration tests for skipping preview

/**
 *
 * Define common tests to be run for skipping job preview to allow use with admin/normal endpoints
 *
 * @param skipPreviewEndpointHook - hook function to be used to skip job preview.
 * @param username - user to use when calling Harmony
 */
function skipJobPreviewCommonTests(
  skipPreviewEndpointHook: Function, username: string,
): void {
  describe('Common tests', function () {
    describe('when the job does not exist', function () {
      const idDoesNotExist = 'aaaaaaaa-1111-bbbb-2222-cccccccccccc';
      skipPreviewEndpointHook({ jobID: idDoesNotExist, username });
      it('returns a 404 HTTP Not found response', function () {
        expect(this.res.statusCode).to.equal(404);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.NotFoundError',
          description: `Error: Unable to find job ${idDoesNotExist}`,
        });
      });
    });

    describe('when the jobID is in an invalid format', function () {
      const invalidJobID = 'foo';
      skipPreviewEndpointHook({ jobID: invalidJobID, username });
      it('returns a 400 HTTP bad request', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON error response', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.RequestValidationError',
          description: `Error: Invalid format for Job ID '${invalidJobID}'. Job ID must be a UUID.`,
        });
      });
    });

    describe('when a job is running', function () {
      const runningJob = buildJob({ username: normalUsername });
      runningJob.status = JobStatus.RUNNING;

      hookTransaction();
      before(async function () {
        await new Job(runningJob).save(this.trx);
        this.trx.commit();
        this.trx = null;
      });

      const { jobID } = runningJob;

      describe('when trying to skip preview on the running job', function () {
        skipPreviewEndpointHook({ jobID, username });
        it('returns a 409 HTTP conflict', function () {
          expect(this.res.statusCode).to.equal(409);
        });

        it('returns a JSON error response indicating that skip preview cannot be called on the job', function () {
          const response = JSON.parse(this.res.text);
          expect(response).to.eql({
            code: 'harmony.ConflictError',
            description: 'Error: Job status is running - only previewing jobs can skip preview.',
          });
        });
      });
    });

    describe('when calling skip preview a successful job', function () {
      const successfulJob = buildJob({ username: normalUsername });
      successfulJob.status = JobStatus.SUCCESSFUL;
      hookTransaction();
      before(async function () {
        await new Job(successfulJob).save(this.trx);
        this.trx.commit();
        this.trx = null;
      });

      skipPreviewEndpointHook({ jobID: successfulJob.requestId, username });
      it('returns a 409 HTTP conflict', function () {
        expect(this.res.statusCode).to.equal(409);
      });

      it('returns a JSON error response indicating the job cannot be paused', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.ConflictError',
          description: 'Error: Job status is successful - only previewing jobs can skip preview.',
        });
      });
    });

    describe('when skipping preview on a failed job', function () {
      const failedJob = buildJob({ username: normalUsername });
      failedJob.status = JobStatus.FAILED;
      hookTransaction();
      before(async function () {
        await new Job(failedJob).save(this.trx);
        this.trx.commit();
        this.trx = null;
      });
      skipPreviewEndpointHook({ jobID: failedJob.requestId, username });
      it('returns a 409 HTTP conflict', function () {
        expect(this.res.statusCode).to.equal(409);
      });

      it('returns a JSON error response indicating that skip preview cannot be called on the job', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.ConflictError',
          description: 'Error: Job status is failed - only previewing jobs can skip preview.',
        });
      });
    });

    describe('when skipping preview on a canceled job', function () {
      const canceledJob = buildJob({ username: normalUsername });
      canceledJob.status = JobStatus.CANCELED;
      hookTransaction();
      before(async function () {
        await new Job(canceledJob).save(this.trx);
        this.trx.commit();
        this.trx = null;
      });

      skipPreviewEndpointHook({ jobID: canceledJob.requestId, username });
      it('returns a 409 HTTP conflict', function () {
        expect(this.res.statusCode).to.equal(409);
      });

      it('returns a JSON error response indicating that skip preview cannot be called on the job', function () {
        const response = JSON.parse(this.res.text);
        expect(response).to.eql({
          code: 'harmony.ConflictError',
          description: 'Error: Job status is canceled - only previewing jobs can skip preview.',
        });
      });
    });
  });
}

const encrypter = createEncrypter(env.sharedSecretKey);
const decrypter = createDecrypter(env.sharedSecretKey);

describe('Skipping job preview', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  describe('User endpoint', function () {
    const skipPreviewEndpointHooks = {
      POST: hookSkipPreview,
      GET: hookSkipPreviewWithGET,
    };

    for (const [httpMethod, skipPreviewEndpointHook] of Object.entries(skipPreviewEndpointHooks)) {
      describe(`Skipping preview using ${httpMethod}`, function () {
        describe('When an end user request results in a job in the previewing state', function () {
          hookRangesetRequest('1.0.0', 'C1245618475-EEDTEST', 'all', { query: { maxResults: 500, format: 'application/x-zarr' }, username: 'joe' });
          hookRedirect('joe');

          it('puts the job in the previewing state', function () {
            const job = JSON.parse(this.res.text);
            expect(job.status).to.eql('previewing');
          });

          describe('when skipping the preview it sets the job to the running status', async function () {
            before(async function  () {
              const job = JSON.parse(this.res.text);
              await skipPreview(this.frontend, { jobID: job.jobID, username: 'joe' } as Job).use(auth({ username: 'joe' }));
              const jobStatusResponse = await jobStatus(this.frontend, { jobID: job.jobID, username: 'joe' } as Job).use(auth({ username: 'joe' }));
              const jobLater = JSON.parse(jobStatusResponse.text);

              expect(jobLater.status).to.eql('running');
            });

            it('workaround to make sure expectations in the before function are called', function () {
              expect(1).to.equal(1);
            });
          });
        });

        describe('When a simulated job is previewing', function () {
          let token;
          hookTransaction();
          const resultsLimitedMessage = 'CMR query identified 176 granules, but the request has been limited to process only the first 101 granules because you requested 101 maxResults.';
          const message = `The job is generating a preview before auto-pausing. ${resultsLimitedMessage}`;
          const previewingJob = buildJob({ username: normalUsername, message, status: JobStatus.PREVIEWING });
          previewingJob.setMessage(resultsLimitedMessage, JobStatus.RUNNING);
          before(async function () {
            await previewingJob.save(this.trx);
            const workflowStep = buildWorkflowStep({ jobID: previewingJob.requestId });
            await workflowStep.save(this.trx);
            const workflowSteps = await getWorkflowStepsByJobId(this.trx, previewingJob.requestId);
            const { operation } = workflowSteps[0];
            const dataOperation = new DataOperation(JSON.parse(operation), encrypter, decrypter);
            token = dataOperation.accessToken;
            this.trx.commit();
            this.trx = null;
          });
          const { jobID } = previewingJob;

          describe('and the user tries to skip the preview', function () {
            describe('For a user who is not logged in', function () {
              skipPreviewEndpointHook({ jobID });
              it('redirects to Earthdata Login', function () {
                expect(this.res.statusCode).to.equal(303);
                expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
              });

              it('sets the "redirect" cookie to the originally-requested resource', function () {
                expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/skip-preview`));
              });
            });

            describe('For a logged-in user who owns the job', async function () {
              hookSkipPreview({ jobID, username: normalUsername });

              it('returns a redirect to the running job', function () {
                expect(this.res.statusCode).to.equal(302);
                expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
              });

              it('updates the access token for the workflow steps', async function () {
                const workflowSteps = await getWorkflowStepsByJobId(db, jobID);
                for (const workflowStep of workflowSteps) {
                  const { operation } = workflowStep;
                  const op = new DataOperation(JSON.parse(operation), encrypter, decrypter);
                  expect(op.accessToken).to.not.equal(token);
                }
              });

              describe('When following the redirect to the resumed job', function () {
                hookRedirect(normalUsername);
                it('returns an HTTP success response', function () {
                  expect(this.res.statusCode).to.equal(200);
                });

                it('changes the status to running', function () {
                  const actualJob = JSON.parse(this.res.text);
                  expect(actualJob.status).to.eql('running');
                });

                it(`sets the message to the "${resultsLimitedMessage}"`, function () {
                  const actualJob = JSON.parse(this.res.text);
                  expect(actualJob.message).to.eql(resultsLimitedMessage);
                });

                it('does not modify any of the other job fields', function () {
                  const actualJob = JSON.parse(this.res.text);
                  const expectedJob: JobRecord = _.cloneDeep(previewingJob);
                  expectedJob.message = resultsLimitedMessage;
                  expectedJob.status = JobStatus.RUNNING;
                  expect(jobsEqual(expectedJob, actualJob)).to.be.true;
                });
              });
            });
          });

          describe('For a logged-in admin who does not own the job', function () {
            const joeJob2 = buildJob({ username: normalUsername });
            hookTransaction();
            before(async function () {
              await new Job(joeJob2).save(this.trx);
              this.trx.commit();
              this.trx = null;
            });
            skipPreviewEndpointHook({ jobID: joeJob2.requestId, username: adminUsername });
            it('returns a 404 not found', function () {
              expect(this.res.statusCode).to.equal(404);
            });

            it('returns a JSON error response', function () {
              const response = JSON.parse(this.res.text);
              expect(response).to.eql({
                code: 'harmony.NotFoundError',
                description: `Error: Unable to find job ${joeJob2.requestId}`,
              });
            });
          });

          skipJobPreviewCommonTests(skipPreviewEndpointHook, normalUsername);

        });

        describe('When a job is paused', function () {
          let token;
          hookTransaction();
          const message = 'The job is paused and may be resumed using the provided link';
          const pausedJob = buildJob({ username: normalUsername, message, status: JobStatus.PAUSED });
          before(async function () {
            await pausedJob.save(this.trx);
            const workflowStep = buildWorkflowStep({ jobID: pausedJob.requestId });
            await workflowStep.save(this.trx);
            const workflowSteps = await getWorkflowStepsByJobId(this.trx, pausedJob.requestId);
            const { operation } = workflowSteps[0];
            const dataOperation = new DataOperation(JSON.parse(operation), encrypter, decrypter);
            token = dataOperation.accessToken;
            this.trx.commit();
            this.trx = null;
          });
          const { jobID } = pausedJob;

          describe('and the user tries to skip the preview', function () {
            describe('For a user who is not logged in', function () {
              skipPreviewEndpointHook({ jobID });
              it('redirects to Earthdata Login', function () {
                expect(this.res.statusCode).to.equal(303);
                expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
              });

              it('sets the "redirect" cookie to the originally-requested resource', function () {
                expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/skip-preview`));
              });
            });

            describe('For a logged-in user who owns the job', async function () {
              hookSkipPreview({ jobID, username: normalUsername });

              it('returns a redirect to the running job', function () {
                expect(this.res.statusCode).to.equal(302);
                expect(this.res.headers.location).to.include(`/jobs/${jobID}`);
              });

              it('updates the access token for the workflow steps', async function () {
                const workflowSteps = await getWorkflowStepsByJobId(db, jobID);
                for (const workflowStep of workflowSteps) {
                  const { operation } = workflowStep;
                  const op = new DataOperation(JSON.parse(operation), encrypter, decrypter);
                  expect(op.accessToken).to.not.equal(token);
                }
              });

              describe('When following the redirect to the resumed job', function () {
                hookRedirect(normalUsername);
                it('returns an HTTP success response', function () {
                  expect(this.res.statusCode).to.equal(200);
                });

                it('changes the status to running', function () {
                  const actualJob = JSON.parse(this.res.text);
                  expect(actualJob.status).to.eql('running');
                });

                it('sets the message to the "The job is being processed"', function () {
                  const actualJob = JSON.parse(this.res.text);
                  expect(actualJob.message).to.eql('The job is being processed');
                });

                it('does not modify any of the other job fields', function () {
                  const actualJob = JSON.parse(this.res.text);
                  const expectedJob: JobRecord = _.cloneDeep(pausedJob);
                  expectedJob.message = 'The job is being processed';
                  expectedJob.status = JobStatus.RUNNING;
                  expect(jobsEqual(expectedJob, actualJob)).to.be.true;
                });
              });
            });
          });

          describe('For a logged-in admin who does not own the job', function () {
            const joeJob2 = buildJob({ username: normalUsername });
            hookTransaction();
            before(async function () {
              await new Job(joeJob2).save(this.trx);
              this.trx.commit();
              this.trx = null;
            });
            skipPreviewEndpointHook({ jobID: joeJob2.requestId, username: adminUsername });
            it('returns a 404 not found', function () {
              expect(this.res.statusCode).to.equal(404);
            });

            it('returns a JSON error response', function () {
              const response = JSON.parse(this.res.text);
              expect(response).to.eql({
                code: 'harmony.NotFoundError',
                description: `Error: Unable to find job ${joeJob2.requestId}`,
              });
            });
          });
        });
      });
    }
  });

  describe('Admin endpoint', function () {
    const skipPreviewEndpointHooks = {
      POST: hookAdminSkipPreview,
      GET: hookAdminSkipPreviewWithGET,
    };

    for (const [httpMethod, skipPreviewEndpointHook] of Object.entries(skipPreviewEndpointHooks)) {
      describe(`Skipping preview using ${httpMethod}`, function () {

        describe('When a job is previewing', function () {
          hookTransaction();
          const message = 'The job is generating a preview before auto-pausing';
          const previewingJob = buildJob({ username: normalUsername, message, status: JobStatus.PREVIEWING });
          before(async function () {
            await previewingJob.save(this.trx);
            this.trx.commit();
            this.trx = null;
          });
          const { jobID } = previewingJob;

          describe('and the user tries to skip the preview', function () {
            describe('For a user who is not logged in', function () {
              skipPreviewEndpointHook({ jobID });
              it('redirects to Earthdata Login', function () {
                expect(this.res.statusCode).to.equal(303);
                expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
              });

              it('sets the "redirect" cookie to the originally-requested resource', function () {
                expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/skip-preview`));
              });
            });
          });

          describe('For a logged-in user (but not admin) who owns the job', function () {
            skipPreviewEndpointHook({ jobID, username: normalUsername });
            it('returns a 403 forbidden because they are not an admin', function () {
              expect(this.res.statusCode).to.equal(403);
            });

            it('returns a JSON error response', function () {
              const response = JSON.parse(this.res.text);
              expect(response).to.eql({
                code: 'harmony.ForbiddenError',
                description: 'Error: You are not permitted to access this resource',
              });
            });
          });

          describe('For a logged-in admin', function () {
            skipPreviewEndpointHook({ jobID, username: adminUsername });
            it('returns a redirect to the running job', function () {
              expect(this.res.statusCode).to.equal(302);
              expect(this.res.headers.location).to.include(`/admin/jobs/${jobID}`);
            });

            describe('When following the redirect to the running job', function () {
              hookRedirect(adminUsername);
              it('returns an HTTP success response', function () {
                expect(this.res.statusCode).to.equal(200);
              });

              it('changes the status to running', function () {
                const actualJob = JSON.parse(this.res.text);
                expect(actualJob.status).to.eql('running');
              });
              it('sets the message to "The job is being processed"', function () {
                const actualJob = JSON.parse(this.res.text);
                expect(actualJob.message).to.eql('The job is being processed');
              });
              it('does not modify any of the other job fields', function () {
                const actualJob = JSON.parse(this.res.text);
                const expectedJob: JobRecord = _.cloneDeep(previewingJob);
                expectedJob.message = 'The job is being processed';
                expectedJob.status = JobStatus.RUNNING;
                expect(jobsEqual(expectedJob, actualJob)).to.be.true;
              });
            });
          });

          skipJobPreviewCommonTests(skipPreviewEndpointHook, adminUsername);

        });

        describe('When a job is paused', function () {
          hookTransaction();
          const message = 'The job is generating a preview before auto-pausing';
          const pausedJob = buildJob({ username: normalUsername, message, status: JobStatus.PAUSED });
          before(async function () {
            await pausedJob.save(this.trx);
            this.trx.commit();
            this.trx = null;
          });
          const { jobID } = pausedJob;

          describe('and the user tries to skip the preview', function () {
            describe('For a user who is not logged in', function () {
              skipPreviewEndpointHook({ jobID });
              it('redirects to Earthdata Login', function () {
                expect(this.res.statusCode).to.equal(303);
                expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
              });

              it('sets the "redirect" cookie to the originally-requested resource', function () {
                expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent(`/jobs/${jobID}/skip-preview`));
              });
            });
          });

          describe('For a logged-in user (but not admin) who owns the job', function () {
            skipPreviewEndpointHook({ jobID, username: normalUsername });
            it('returns a 403 forbidden because they are not an admin', function () {
              expect(this.res.statusCode).to.equal(403);
            });

            it('returns a JSON error response', function () {
              const response = JSON.parse(this.res.text);
              expect(response).to.eql({
                code: 'harmony.ForbiddenError',
                description: 'Error: You are not permitted to access this resource',
              });
            });
          });

          describe('For a logged-in admin', function () {
            skipPreviewEndpointHook({ jobID, username: adminUsername });
            it('returns a redirect to the running job', function () {
              expect(this.res.statusCode).to.equal(302);
              expect(this.res.headers.location).to.include(`/admin/jobs/${jobID}`);
            });

            describe('When following the redirect to the running job', function () {
              hookRedirect(adminUsername);
              it('returns an HTTP success response', function () {
                expect(this.res.statusCode).to.equal(200);
              });

              it('changes the status to running', function () {
                const actualJob = JSON.parse(this.res.text);
                expect(actualJob.status).to.eql('running');
              });
              it('sets the message to "The job is being processed"', function () {
                const actualJob = JSON.parse(this.res.text);
                expect(actualJob.message).to.eql('The job is being processed');
              });
              it('does not modify any of the other job fields', function () {
                const actualJob = JSON.parse(this.res.text);
                const expectedJob: JobRecord = _.cloneDeep(pausedJob);
                expectedJob.message = 'The job is being processed';
                expectedJob.status = JobStatus.RUNNING;
                expect(jobsEqual(expectedJob, actualJob)).to.be.true;
              });
            });
          });

          skipJobPreviewCommonTests(skipPreviewEndpointHook, adminUsername);

        });
      });
    }
  });
});