import PubSub from '../pub-sub.js';

/**
 * Links for changing job status.
 */
class StatusChangeLinks {
  /**
   * Initialize job status change links.
   * @param {string} linksContainerId - id of the container to place the links within
   * @param {string} linkEvent - the event name that should trigger visibility change for the links
   */
  init(linksContainerId, linkEvent) {
    this.fetchLinks(true).then((links) => {
      if (links.length) {
        this.insertLinksHtml(links, linksContainerId);
      }
    });
    // keep the hidden/visible state updated on this event
    PubSub.subscribe(
      linkEvent,
      () => this.enableLinks(),
    );
  }

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
    return `${links.map(linkToLi).join('')}`;
  }

  /**
   * Responds to a nav link click event
   * (e.g. hits relevant Harmony url, shows user the response).
   * @param {Event} event - the click event
   */
  async handleClick() {
    throw new Error('handleClick must be implemented.');
  }

  /**
   * Transform the links to HTML and insert them in the specified container.
   * Also attaches a click event listener to the link.
   * @param {Object[]} links - link array (of links with title, href, type, rel)
   * @param {string} linksContainerId - id of the container to place the HTML within
   */
  insertLinksHtml(links, linksContainerId) {
    const html = this.buildLinksHtml(links);
    const tmp = document.createElement('ul');
    tmp.innerHTML = html;
    document.getElementById(linksContainerId).appendChild(...tmp.childNodes);
    document.querySelectorAll('.state-change-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        this.handleClick(event);
      }, false);
    });
  }

  /**
   * Get job state change links (pause, resume, etc.) from Harmony.
   * @param {boolean} fetchAll - fetch all links or only those relevent to the
   * job's current status
   */
  async fetchLinks() {
    throw new Error('fetchLinks must be implemented');
  }

  /**
   * Hide/show links depending on the job state.
   */
   async enableLinks() {
    const validLinks = await this.fetchLinks(false);
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

export default StatusChangeLinks;
