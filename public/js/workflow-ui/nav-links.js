import toasts from './toasts.js';
import PubSub from '../pub-sub.js';

class NavLinks {
  /**
   * Transform link objects to an HTML string representing the links nav.
   * @param {Object[]} links - link array (of links with title, href, type, rel)
   * @returns HTML as a string
   */
  buildLinksHtml(links) {
    const linkToLi = (link) => `<li>
        <a href="${link.href}" rel="${link.rel}" title="${link.title}" class="state-change-link nav-link py-0 px-2 d-none">
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
   * Transform the links to HTML and insert them in the specified container.
   * Also attaches a click event listener to the link.
   * @param {Object[]} links - link array (of links with title, href, type, rel)
   * @param {string} linksContainerId - id of the container to place the HTML within
   */
  insertLinksHtml(links, linksContainerId) {
    const html = this.buildLinksHtml(links);
    document.getElementById(linksContainerId).innerHTML = html;
    document.querySelectorAll('.state-change-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        this.handleClick(event);
      }, false);
    });
  }

  /**
   * Get job state change links (pause, resume, etc.) from Harmony and insert them in the UI.
   * @param {string} linksContainerId - id of the container to place the HTML within
   * @param {string} jobId - the job id to fetch links for
   */
  async fetchAndInsertLinks(linksContainerId, jobId) {
    const linksUrl = `./${jobId}/links?all=true`;
    const res = await fetch(linksUrl);
    if (res.status === 200) {
      const links = await res.json();
      if (links.length) {
        this.insertLinksHtml(links, linksContainerId);
      }
    }
  }

  /**
   * Hide/show links depending on the job state.
   * @param {string} jobId the id of the current job
   */
   async enableLinks(jobId) {
    const linksUrl = `./${jobId}/links?all=false`;
    const res = await fetch(linksUrl);
    if (res.status === 200) {
      const validLinks = await res.json();
      document.querySelectorAll('.state-change-link').forEach((el) => {
        const rel = el.getAttribute('rel');
        if (validLinks.find((l) => l.rel === rel)) {
          el.classList.remove('d-none');
        } else {
          el.classList.add('d-none');
        }
      });
    }
  }

  /**
   * Initialize job state change nav links.
   * @param {string} linksContainerId - id of the container to place the links within
   * @param {string} jobId - the job id to fetch links for
   */
  async init(linksContainerId, jobId) {
    await this.fetchAndInsertLinks(linksContainerId, jobId);
    // keep the hidden/visible state of the links in sync with
    // the work items table
    PubSub.subscribe(
      'work-items-table-loaded',
      () => this.enableLinks(jobId),
    );
  }
}

export default NavLinks;
