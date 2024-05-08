import { expect } from 'chai';
import { parseBbox, parseDatetime } from '../../../app/frontends/ogc-edr/util/helper';
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

describe('parseDatetime function', function () {
  // TODO: This parsing is wrong and needs to be changed
  it('parses date-time correctly', function () {
    const value = '2018-02-12T23:20:50Z';
    const result = parseDatetime(value);
    expect(result).to.eql({ start: '2018-02-12T23:20:50Z' });
  });

  it('parses bounded interval correctly', function () {
    const value = '2018-02-12T00:00:00Z/2018-03-18T12:31:12Z';
    const result = parseDatetime(value);
    expect(result).to.eql({
      start: '2018-02-12T00:00:00Z',
      end: '2018-03-18T12:31:12Z',
    });
  });

  it('parses half-bounded start interval correctly', function () {
    const value = '../2018-03-18T12:31:12Z';
    const result = parseDatetime(value);
    expect(result).to.eql({
      end: '2018-03-18T12:31:12Z',
    });
  });

  it('parses half-bounded end interval correctly', function () {
    const value = '2018-02-12T00:00:00Z/..';
    const result = parseDatetime(value);
    expect(result).to.eql({
      start: '2018-02-12T00:00:00Z',
    });
  });

  it('returns empty object for empty input', function () {
    const value = '';
    const result = parseDatetime(value);
    expect(result).to.eql({});
  });

  it('returns empty object for undefined input', function () {
    const value = undefined;
    const result = parseDatetime(value as string);
    expect(result).to.eql({});
  });
});
