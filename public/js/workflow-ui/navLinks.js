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
  const link = event.target;
  const stateChangeUrl = link.getAttribute('href');
  const res = await fetch(stateChangeUrl);
  const data = await res.json();
  console.log(data);
  if (res.status === 200) {
    
  }
}

function insertLinksHtml(links, linksContainerId) {
  const html = buildLinksHtml(links);
  document.getElementById(linksContainerId).innerHTML = html;
  document.querySelectorAll('.state-change-link').forEach(function (link) {
    link.addEventListener('click', handleClick);
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