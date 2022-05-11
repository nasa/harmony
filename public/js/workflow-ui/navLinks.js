import workItemsTable from "./job/work-items-table.js";
import toasts from "./toasts.js";

/**
 * Transform link objects to an HTML string representing the links nav.
 * @param {Object[]} links - link array (of links with title, href, type, rel)
 * @returns HTML as a string
 */
function buildLinksHtml(links) {
  const linkToLi = (link) =>
    `<li>
      <a href="${link.href}" class="state-change-link nav-link py-0 px-2">
        ${link.href.split('/').pop()}
      </a>
    </li>`;
  return `
  <ul class="nav">
    ${links.map(linkToLi).join('')}
  </ul>
  `;
}

/**
 * Responds to a nav link click event
 * (hits relevant Harmony url, shows user the response).
 * @param {Event} event - the click event
 */
async function handleClick(event) {
  event.preventDefault();
  toasts.showUpper('Changing job state..');
  const link = event.target;
  const stateChangeUrl = link.getAttribute('href');
  const res = await fetch(stateChangeUrl);
  const data = await res.json();
  if (res.status === 200) {
    toasts.showUpper(`The job is now ${data.status}`);
    workItemsTable.refreshTable();
  } else if (data.description) {
    toasts.showUpper(data.description);
  } else {
    toasts.showUpper('The update failed.');
  }
}

/**
 * Transform the links to HTML and insert them in the specified container.
 * Also attaches a click event listener to the link.
 * @param {Object[]} links - link array (of links with title, href, type, rel)
 * @param {string} linksContainerId - id of the container to place the HTML within
 */
function insertLinksHtml(links, linksContainerId) {
  const html = buildLinksHtml(links);
  document.getElementById(linksContainerId).innerHTML = html;
  document.querySelectorAll('.state-change-link').forEach(function (link) {
    link.toasts = toasts;
    link.addEventListener('click', function (event) {
      handleClick(event);
    }, false);
  });
}

/**
 * Get job state change links (pause, resume, etc.) from Harmony and insert them in the UI.
 * @param {string} linksContainerId - id of the container to place the HTML within
 * @param {string} jobId - the job id to fetch links for
 */
async function fetchAndInsertLinks(linksContainerId, jobId) {
  const linksUrl = `./${jobId}/links`;
  const res = await fetch(linksUrl);
  if (res.status === 200) {
    const data = await res.json();
    insertLinksHtml(data, linksContainerId);
  }
}

/**
 * Builds job state change navigation links and handles
 * all relevant user interactions with those links.
 */
export default {

  /**
   * Initialize job state change nav links.
   * @param {string} linksContainerId - id of the container to place the links within
   * @param {string} jobId - the job id to fetch links for
   */
  async init(linksContainerId, jobId) {
    fetchAndInsertLinks(linksContainerId, jobId);
  }
}