

import { expect } from 'chai';

import logger from '../../harmony/app/util/log';
import { getGranuleSizeInBytes } from '../app/query';

describe('#getGranuleSizeInBytes', () => {
  it('should return 0 for undefined archiveInfo', () => {
    expect(getGranuleSizeInBytes(logger, undefined)).to.equal(0);
  });

  it('should return 0 for null archiveInfo', () => {
    expect(getGranuleSizeInBytes(logger, null)).to.equal(0);
  });

  it('should return 0 for empty archiveInfo array', () => {
    expect(getGranuleSizeInBytes(logger, [])).to.equal(0);
  });

  it('should correctly handle a single entry with SizeInBytes', () => {
    expect(getGranuleSizeInBytes(logger, [{ SizeInBytes: 5000 }])).to.equal(5000);
  });

  it('should correctly handle a single entry with Size and SizeUnit', () => {
    expect(getGranuleSizeInBytes(logger, [{ Size: 2, SizeUnit: 'MB' }])).to.equal(2 * 1024 * 1024);
  });

  it('should correctly sum multiple entries with different units', () => {
    const archiveInfo = [
      { SizeInBytes: 5000 },
      { Size: 1, SizeUnit: 'KB' },
      { Size: 2, SizeUnit: 'MB' },
      { Size: 3, SizeUnit: 'GB' },
      { Size: 4, SizeUnit: 'TB' },
    ];
    const expectedSize =
      5000 +
      1 * 1024 +
      2 * 1024 * 1024 +
      3 * 1024 * 1024 * 1024 +
      4 * 1024 * 1024 * 1024 * 1024;
    expect(getGranuleSizeInBytes(logger, archiveInfo)).to.equal(expectedSize);
  });

  it('should treat an entry with an unknown SizeUnit as 0', () => {
    expect(getGranuleSizeInBytes(logger, [{ Size: 10, SizeUnit: 'NA' }])).to.equal(0);
  });

  it('should use SizeInBytes when all fields are present', () => {
    const archiveInfo = [{ Size: 2, SizeUnit: 'MB', SizeInBytes: 5000000 }];
    expect(getGranuleSizeInBytes(logger, archiveInfo)).to.equal(5000000);
  });
});
