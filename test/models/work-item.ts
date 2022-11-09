import { describe } from 'mocha';
import { buildJob } from '../helpers/jobs';
import { JobStatus } from '../../app/models/job';
import { computeWorkItemDurationOutlierThresholdForJobService } from '../../app/models/work-item';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildWorkItem } from '../helpers/work-items';
import { expect } from 'chai';
import { WorkItemStatus } from '../../app/models/work-item-interface';
import { buildWorkflowStep } from '../helpers/workflow-steps';


describe('WorkItem computeWorkItemDurationOutlierThresholdForJobService', function () {

  const jobWithTwoComplete = buildJob({ status: JobStatus.RUNNING });
  const jobWithOneComplete = buildJob({ status: JobStatus.RUNNING, ignoreErrors: true });

  hookTransaction();

  before(async function () {
    await jobWithTwoComplete.save(this.trx);
    await buildWorkItem({ jobID: jobWithTwoComplete.jobID, status: WorkItemStatus.SUCCESSFUL,
      workflowStepIndex: 0, startedAt: new Date(), serviceID: 'subsetter', duration: 100 }).save(this.trx);
    await buildWorkItem({ jobID: jobWithTwoComplete.jobID, status: WorkItemStatus.SUCCESSFUL,
      workflowStepIndex: 0, startedAt: new Date(), serviceID: 'subsetter', duration: 200 }).save(this.trx);
    await buildWorkflowStep({ jobID: jobWithTwoComplete.jobID, stepIndex: 0, serviceID: 'subsetter' }).save(this.trx);

    await jobWithOneComplete.save(this.trx);
    await buildWorkItem({ jobID: jobWithOneComplete.jobID, status: WorkItemStatus.SUCCESSFUL,
      workflowStepIndex: 0, startedAt: new Date(), serviceID: 'subsetter' }).save(this.trx);
    await buildWorkItem({ jobID: jobWithOneComplete.jobID, status: WorkItemStatus.RUNNING,
      workflowStepIndex: 0, startedAt: new Date(), serviceID: 'subsetter' }).save(this.trx);
    await buildWorkflowStep({ jobID: jobWithOneComplete.jobID, stepIndex: 0, serviceID: 'subsetter' }).save(this.trx);

    await this.trx.commit();
  });

  it('returns the default threshold when less than 2 items are successful', async function () {
    expect(await computeWorkItemDurationOutlierThresholdForJobService(
      jobWithOneComplete.jobID,
      'subsetter',
      0,
    )).to.equal(7200000);
  });
  
  it('returns 2*maxDuration when at least 2 items are successful', async function () {
    expect(await computeWorkItemDurationOutlierThresholdForJobService(
      jobWithTwoComplete.jobID,
      'subsetter',
      0,
    )).to.equal(400);
  });
});
