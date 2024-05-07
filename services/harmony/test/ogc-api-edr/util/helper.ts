import { expect } from 'chai';
import { parseBbox } from '../../../app/frontends/ogc-edr/util/helper';
import { ParameterParseError } from '../../../app/util/parameter-parsing-helpers';

describe('parseBbox function', function () {
  it('parses 4-element bbox correctly', function () {
    const value = '10,20,30,40';
    const result = parseBbox(value);
    expect(result).to.eql([10, 20, 30, 40]);
  });

  it('parses 6-element bbox correctly', function () {
    const value = '10,20,30,40,50,60';
    const result = parseBbox(value);
    expect(result).to.eql([10, 20, 40, 50]);
  });

  it('throws error for invalid bbox length', function () {
    const value = '10,20,30';
    expect(() => parseBbox(value)).to.throw(ParameterParseError);
  });

  it('returns empty bbox value', function () {
    const value = '';
    const result = parseBbox(value);
    expect(result).to.be.undefined;
  });
});
