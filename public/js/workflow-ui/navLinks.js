function buildLinksHtml(links) {
  // href: "http://localhost:3000/admin/jobs/501e2417-6f0e-4564-a4c7-6b9dc9044e0b/cancel"
  // rel: "canceler"
  // title: "Cancel the job."
  // type: "application/json"
  // <ul class="nav">
  //     <li><a href="#" class="nav-link px-2 link-secondary">Home</a></li>
  //     <li><a href="#" class="nav-link px-2 link-dark">Features</a></li>
  //     <li><a href="#" class="nav-link px-2 link-dark">Pricing</a></li>
  //     <li><a href="#" class="nav-link px-2 link-dark">FAQs</a></li>
  //     <li><a href="#" class="nav-link px-2 link-dark">About</a></li>
  // </ul>
  const linkToLi = (link) => 
    `<li>
      <a href="${link.href}" class="nav-link px-2 link-dark">
        ${link.href.split('/').pop()}
      </a>
    </li>`;
  return `
  <ul class="nav">
    ${links.map(linkToLi).join("")}
  </ul>
  `;
}

function refreshLinksHtml(links, linksContainerId) {
  const html = buildLinksHtml(links);
  document.getElementById(linksContainerId).innerHTML = html;
}

/**
 * 
 * @param
 * @returns
 */
 async function load(linksContainerId, jobId) {
    const linksUrl = `./${jobId}/links`;
    const res = await fetch(linksUrl);
    if (res.status === 200) {
      const links = await res.json();
      refreshLinksHtml(links, linksContainerId);
    } else {
      return false;
    }
  }
  
  export default {
  
    /**
     *
     * @param
     */
    async init(linksContainerId, jobId) {
      setInterval(
        async () => await load(linksContainerId, jobId), 
        5000,
      );
    }
  }