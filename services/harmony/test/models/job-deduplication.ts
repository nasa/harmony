import { expect } from 'chai';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import { getIDForDuplicateJob, Job, JobRecord, JobStatus } from '../../app/models/job';
import db from '../../app/util/db';
import env from '../../app/util/env';
import { rawSaveJob } from '../helpers/jobs';

const username = 'jdoe';
const requestChecksum = 'v1:abcdef0123456789';
const numInputGranules = 150;

/**
 * Saves a job whose username, request_checksum, and numInputGranules match the fixture values
 * above (so it is a dedupe candidate), overridden by whatever fields the test passes in.
 *
 * @param overrides - fields to use instead of the matching defaults, e.g. status or createdAt
 * @returns the saved job
 */
async function saveCandidateJob(overrides: Partial<JobRecord> = {}): Promise<Job> {
  return rawSaveJob(db, {
    username, request_checksum: requestChecksum, numInputGranules,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  });
}

describe('getIDForDuplicateJob', function () {
  afterEach(truncateAll);

  it('returns null when no job matches', async function () {
    const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules);
    expect(result).to.equal(null);
  });

  it('returns null when the checksum is empty, even if a matching job exists', async function () {
    await saveCandidateJob({ status: JobStatus.RUNNING });
    const result = await getIDForDuplicateJob(username, '', numInputGranules);
    expect(result).to.equal(null);
  });

  it('ignores a job with a different request checksum', async function () {
    await saveCandidateJob({ status: JobStatus.RUNNING });
    const result = await getIDForDuplicateJob(username, 'v1:somethingelse', numInputGranules);
    expect(result).to.equal(null);
  });

  it('ignores a job belonging to a different user', async function () {
    await saveCandidateJob({ status: JobStatus.RUNNING });
    const result = await getIDForDuplicateJob('notjdoe', requestChecksum, numInputGranules);
    expect(result).to.equal(null);
  });

  it('ignores a job covering a different number of granules', async function () {
    await saveCandidateJob({ status: JobStatus.RUNNING });
    const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules + 1);
    expect(result).to.equal(null);
  });

  describe('in-flight statuses', function () {
    const inFlightStatuses = [
      JobStatus.ACCEPTED, JobStatus.RUNNING, JobStatus.RUNNING_WITH_ERRORS, JobStatus.PREVIEWING,
      JobStatus.PAUSED,
    ];

    for (const status of inFlightStatuses) {
      it(`returns a matching job with status "${status}" no matter how old it is`, async function () {
        const job = await saveCandidateJob({ status, createdAt: new Date(0) });
        const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules);
        expect(result).to.equal(job.jobID);
      });
    }
  });

  describe('completed statuses', function () {
    const completedStatuses = [JobStatus.SUCCESSFUL, JobStatus.COMPLETE_WITH_ERRORS];
    const maxAgeMs = env.dedupeMaxAgeDays * 24 * 60 * 60 * 1000;

    for (const status of completedStatuses) {
      it(`returns a matching job with status "${status}" created within the dedupe window`, async function () {
        const job = await saveCandidateJob({ status, createdAt: new Date() });
        const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules);
        expect(result).to.equal(job.jobID);
      });

      it(`ignores a matching job with status "${status}" older than the dedupe window`, async function () {
        const tooOld = new Date(Date.now() - maxAgeMs - 1000);
        await saveCandidateJob({ status, createdAt: tooOld });
        const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules);
        expect(result).to.equal(null);
      });
    }
  });

  describe('terminal statuses that should not be deduplicated', function () {
    for (const status of [JobStatus.FAILED, JobStatus.CANCELED]) {
      it(`ignores a recent matching job with status "${status}"`, async function () {
        await saveCandidateJob({ status, createdAt: new Date() });
        const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules);
        expect(result).to.equal(null);
      });
    }
  });

  it('prefers the most recently created matching job when more than one exists', async function () {
    await saveCandidateJob({ status: JobStatus.SUCCESSFUL, createdAt: new Date(Date.now() - 1000) });
    const newerJob = await saveCandidateJob({ status: JobStatus.RUNNING, createdAt: new Date() });
    const result = await getIDForDuplicateJob(username, requestChecksum, numInputGranules);
    expect(result).to.equal(newerJob.jobID);
  });
});
