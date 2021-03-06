/* eslint-disable max-len */
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { getVariablesByIds } from '../../app/util/cmr';

describe('util/cmr', function () {
  describe('getVariablesByIds', function () {
    it('returns a valid response, given a huge number of variables', async function () {
      const validVariableId = 'V1233801695-EEDTEST';
      const ids = [...Array(300).keys()].map((num) => `V${num}-YOCLOUD`).concat(validVariableId);
      const variables = await getVariablesByIds(ids, '');
      expect(variables.length).to.eql(1);
    });
  });
});
