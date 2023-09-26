import NavLinks from '../nav-links.js';
import toasts from '../toasts.js';
import PubSub from '../../pub-sub.js';

class JobLinks extends NavLinks {
  /**
   * Init the jobs links which allow the user to change the job state.
   * @param {string} jobId - ID of the job that the links are for
   * @param {string} linksContainerId - ID of the container to put the links in
   */
  constructor(jobId, linksContainerId) {
    super(linksContainerId, 'work-items-table-loaded');
    this.jobId = jobId;
  }

  /**
   * Responds to a nav link click event
   * (hits relevant Harmony url, shows user the response).
   * @param {Event} event - the click event
   */
  async handleClick(event) {
    event.preventDefault();
    toasts.showUpper('Changing job state...');
    const link = event.target;
    const stateChangeUrl = link.getAttribute('href');
    const res = await fetch(stateChangeUrl);
    const data = await res.json();
    if (res.status === 200) {
      toasts.showUpper(`The job is now ${data.status}`);
      PubSub.publish('table-state-change');
    } else if (data.description) {
      toasts.showUpper(data.description);
    } else {
      toasts.showUpper('The update failed.');
    }
  }

  /**
   * Get job state change links (pause, resume, etc.) from Harmony.
   * @param {boolean} fetchAll - fetch all links or only those relevent to the
   * job's current status
   */
  async fetchLinks(fetchAll) {
    const linksUrl = `./${this.jobId}/links?all=${fetchAll}`;
    const res = await fetch(linksUrl);
    if (res.status === 200) {
      const links = await res.json();
      return links;
    }
    return [];
  }
}

export default JobLinks;
