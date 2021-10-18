import { describe } from 'mocha';
import MockDate from 'mockdate';
import { buildJob } from '../helpers/jobs';
import { JobStatus } from '../../app/models/job';
import { WorkItemStatus } from '../../app/models/work-item';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildWorkItem } from '../helpers/work-items';

describe('WorkFailer', function () {
  // used to mock work items (create date), for items that have not been running for long
  const newDate = '1/1/2000';
  // used to mock work items (create date), for items that are taking too long to complete
  const oldDate = '1/1/1900';

  hookTransaction();

  before(async function () {
    // this job has two long-running work items
    const shouldFailJob1 = buildJob({ status: JobStatus.RUNNING });
    await shouldFailJob1.save(this.trx);
    MockDate.set(oldDate); // make the below two work items "old" (has been running for a while)
    const shouldFailJob1Item1 = buildWorkItem({ jobID: shouldFailJob1.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob1Item1.save(this.trx);
    const shouldFailJob1Item2 = buildWorkItem({ jobID: shouldFailJob1.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob1Item2.save(this.trx);
    MockDate.reset();

    // this job has 1 (out of 2) long-running work items
    const shouldFailJob2 = buildJob({ status: JobStatus.RUNNING });
    await shouldFailJob2.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const shouldFailJob2Item1 = buildWorkItem({ jobID: shouldFailJob2.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob2Item1.save(this.trx);
    MockDate.set(oldDate); // make the below work item "old" (has been running for a while)
    const shouldFailJob2Item2 = buildWorkItem({ jobID: shouldFailJob2.jobID, status: WorkItemStatus.RUNNING });
    await shouldFailJob2Item2.save(this.trx);
    MockDate.reset();

    // this job has 0 long-running work items
    const unproblematicJob = buildJob({ status: JobStatus.RUNNING });
    await unproblematicJob.save(this.trx);
    MockDate.set(newDate); // make the below work item "new"
    const unproblematicJobItem1 = buildWorkItem({ jobID: unproblematicJob.jobID, status: WorkItemStatus.RUNNING });
    await unproblematicJobItem1.save(this.trx);
    MockDate.reset();
  });

  after(async function () {
    await truncateAll();
  });

});
