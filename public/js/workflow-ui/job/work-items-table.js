import { formatDates } from "../table.js";

/**
 * Query the Harmony backend for an up to date version of 
 * a single HTML page of the work items table.
 * @param {string} jobId - id of the job that the work items are linked to
 * @param {number} page - page number for the work items
 * @param {number} limit - limit on the number of work items in a page
 * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
 * @returns Boolean indicating whether the job is still running. 
 */
async function load(jobId, page, limit, checkJobStatus) {
  const tableUrl = `./${jobId}/work-items?page=${page}&limit=${limit}`;
  const res = await fetch(tableUrl + `&checkJobStatus=${checkJobStatus}`);
  if (res.status === 200) {
    const template = await res.text();
    document.getElementById('workflow-items-table-container').innerHTML = template;
    formatDates();
    return true;
  } else {
    return false;
  }
}

export default {

  /**
   * Update the work items table while the job is processing.
   * @param {string} jobId - id of the job that the work items are linked to
   * @param {number} page - page number for the work items
   * @param {number} limit - limit on the number of work items in a page
   */
  async init(jobId, page, limit) {
    this.refreshTable = () => load(jobId, page, limit, false);
    const fiveSeconds = 5 * 1000;
    await load(jobId, page, limit, false);
    let jobIsRunning = true;
    while (jobIsRunning) {
      await new Promise(res => setTimeout(res, fiveSeconds));
      jobIsRunning = await load(jobId, page, limit, true);
    }
    // back off now since the work items are likely
    // close to being complete
    setInterval(
      async () => await load(jobId, page, limit, false), 
      fiveSeconds * 3,
    );
  },
}