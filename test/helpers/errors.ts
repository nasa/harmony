import { describe, it, before, after } from 'mocha';
import request from 'supertest';
import { expect } from 'chai';

/**
 * Adds `it` statements that assert that the given error has occurred on the
 * response object contained in `this.res`
 *
 * @param {number} code the HTTP status code for the response (default: 404)
 * @param {string} message the error message
 * @param {number} html assert the page is EUI-themed HTML (default: true)
 * @returns {void}
 */
export function itRespondsWithError(code, message, html = true) {
  it(`returns an error page with status code ${code}`, function () {
    expect(this.res.status).to.equal(code);
  });

  if (message) {
    it(`provides the error message "${message}"`, function () {
      const expected = html ? `<span class="message">${message}</span>` : JSON.stringify(message);
      expect(this.res.text).to.have.string(expected);
    });
  }

  if (html) {
    it('styles the error page using the EUI', function () {
      expect(this.res.text).to.have.string('<div class="orbit"></div>'); // EUI template contents
    });
  }
}

/**
 * Adds a `describe` and `it` statement that call the given path
 * and assert an error is returned with the provided code.
 *
 * @param {object} config named parameters for this call
 * @param {string} [config.condition] the `describe` condition without leading "when "
 * @param {string} [config.path] the server path which should produce the error
 * @param {string} [config.message] the error message
 * @param {number} [config.code] the HTTP status code for the response (default: 404)
 * @param {number} [config.html] assert the page is EUI-themed HTML (default: true)
 * @returns {void}
 */
export function describeErrorCondition({ condition, path, message, code = 404, html = true }) {
  describe(`when ${condition}`, function () {
    before(async function () {
      this.res = await request(this.frontend).get(path);
    });
    after(function () {
      delete this.res;
    });

    itRespondsWithError(code, message, html);
  });
}
