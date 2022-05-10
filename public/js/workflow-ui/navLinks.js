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

async function handleClick(event, toasts, workItemsTable) {
  event.preventDefault();
  toasts.showUpper('Changing job state..');
  const link = event.target;
  const stateChangeUrl = link.getAttribute('href');
  const res = await fetch(stateChangeUrl);
  const data = await res.json();
  console.log(data);
  if (res.status === 200) {
    toasts.showUpper(`Success! The job is now ${data.status}`);
    workItemsTable.refreshTable();
  } else if (data.description) {
    toasts.showUpper(data.description);
  } else {
    toasts.showUpper('The update failed.');
  }
}

function insertLinksHtml(links, linksContainerId, toasts, workItemsTable) {
  const html = buildLinksHtml(links);
  document.getElementById(linksContainerId).innerHTML = html;
  document.querySelectorAll('.state-change-link').forEach(function (link) {
    link.toasts = toasts;
    link.addEventListener('click', function (event) {
      handleClick(event, toasts, workItemsTable);
    }, false);
  });
}

/**
 * 
 * @param
 * @returns
 */
async function fetchAndInsertLinks(linksContainerId, jobId, toasts, workItemsTable) {
  const linksUrl = `./${jobId}/links`;
  const res = await fetch(linksUrl);
  if (res.status === 200) {
    const data = await res.json();
    insertLinksHtml(data, linksContainerId, toasts, workItemsTable);
  }
}

export default {

  /**
   *
   * @param
   */
  async init(linksContainerId, jobId, toasts, workItemsTable) {
    fetchAndInsertLinks(linksContainerId, jobId, toasts, workItemsTable);
  }
}