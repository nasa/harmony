function buildLinksHtml(links) {
  const linkToLi = (link) => 
    `<li>
      <a href="${link.href}" class="nav-link py-0 px-2">
        ${link.href.split('/').pop()}
      </a>
    </li>`;
  return `
  <ul class="nav">
    ${links.map(linkToLi).join("")}
  </ul>
  `;
}

function insertLinksHtml(links, linksContainerId) {
  const html = buildLinksHtml(links);
  document.getElementById(linksContainerId).innerHTML = html;
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