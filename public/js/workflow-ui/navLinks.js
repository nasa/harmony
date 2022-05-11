import workItemsTable from "./job/work-items-table.js";
import toasts from "./toasts.js";

function buildLinksHtml(links) {
  const linkToLi = (link) =>
    `<li>
      <a href="${link.href}" class="state-change-link nav-link py-0 px-2">
        ${link.href.split('/').pop()}
      </a>
    </li>`;
  return `
  <ul class="nav">
    ${links.map(linkToLi).join("")}
  </ul>
  `;
}

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
 * 
 * @param
 * @returns
 */
async function fetchAndInsertLinks(linksContainerId, jobId) {
  const linksUrl = `./${jobId}/links`;
  const res = await fetch(linksUrl);
  if (res.status === 200) {
    const data = await res.json();
    insertLinksHtml(data, linksContainerId);
  }
}

export default {

  /**
   *
   * @param
   */
  async init(linksContainerId, jobId) {
    fetchAndInsertLinks(linksContainerId, jobId);
  }
}