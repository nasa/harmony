import StatusChangeLinks from '../status-change-links.js';
import jobsTable from './jobs-table.js';

const resumeLink = {
  title: 'Resumes the job.',
  href: '/jobs/resume',
  type: 'application/json',
  rel: 'resumer',
};

const cancelLink = {
  title: 'Cancels the job.',
  href: '/jobs/cancel',
  type: 'application/json',
  rel: 'canceler',
};

const pauseLink = {
  title: 'Pauses the job.',
  href: '/jobs/pause',
  type: 'application/json',
  rel: 'pauser',
};

/**
 * Links for changing job status(es) (for the jobs page of the Workflow UI).
 */
class JobsStatusChangeLinks extends StatusChangeLinks {
  /**
   * Responds to a nav link click event
   * (hits relevant Harmony url, shows user the response).
   * @param {Event} event - the click event
   */
  async handleClick(event) {
    event.preventDefault();
    console.log(jobsTable.getJobIds());
  }

  /**
   * Get job state change links (pause, resume, etc.) from Harmony.
   * @param {boolean} fetchAll - fetch all links or only those relevent to the
   * job's current status
   */
  async fetchLinks(fetchAll) {
    return [resumeLink, cancelLink, pauseLink];
  }
}

export default JobsStatusChangeLinks;
