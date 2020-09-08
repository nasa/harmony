import { describe, it } from 'mocha';
import { expect } from 'chai';
import { parseAcceptHeader, isMimeTypeAccepted } from 'util/content-negotiation';

describe('util/content-negotiation', function () {
  describe('parseAcceptHeader', function () {
    it('treats no quality value parameter as 1.0', function () {
      expect(parseAcceptHeader('image/tiff')).to.eql([{
        mimeType: 'image/tiff',
        qualityValue: 1.0,
      }]);
    });
    it('orders the mime-types in descending quality value order', function () {
      expect(parseAcceptHeader('*/*;q=0.02, image/png;q=0.125, image/tiff;q=0.1')).to.eql([{
        mimeType: 'image/png',
        qualityValue: 0.125,
      }, {
        mimeType: 'image/tiff',
        qualityValue: 0.1,
      }, {
        mimeType: '*/*',
        qualityValue: 0.02,
      }]);
    });
    describe('when multiple accept headers share the same quality value', function () {
      it('orders the mime-types based on the order they were provided', function () {
        expect(parseAcceptHeader('text/plain;q=0.2, image/tiff;q=0.5, image/gif;q=0.6, image/png;q=0.5, application/zarr;q=0.5')).to.eql([{
          mimeType: 'image/gif',
          qualityValue: 0.6,
        }, {
          mimeType: 'image/tiff',
          qualityValue: 0.5,
        }, {
          mimeType: 'image/png',
          qualityValue: 0.5,
        }, {
          mimeType: 'application/zarr',
          qualityValue: 0.5,
        }, {
          mimeType: 'text/plain',
          qualityValue: 0.2,
        }]);
      });
    });

    it('treats multiple ways of representing 1 as the same value', function () {
      expect(parseAcceptHeader('image/png;q=1, application/zarr, image/tiff;q=1.000')).to.eql([{
        mimeType: 'image/png',
        qualityValue: 1,
      }, {
        mimeType: 'application/zarr',
        qualityValue: 1.0,
      }, {
        mimeType: 'image/tiff',
        qualityValue: 1.000,
      }]);
    });
    it('handles */* wildcard', function () {
      expect(parseAcceptHeader('*/*')).to.eql([{
        mimeType: '*/*',
        qualityValue: 1.0,
      }]);
    });
    it('handles type wildcard (*/xml)', function () {
      expect(parseAcceptHeader('*/xml')).to.eql([{
        mimeType: '*/xml',
        qualityValue: 1.0,
      }]);
    });
    it('handles subtype wildcard (image/*)', function () {
      expect(parseAcceptHeader('image/*; q=0.3')).to.eql([{
        mimeType: 'image/*',
        qualityValue: 0.3,
      }]);
    });
    it('ignores additional parameters', function () {
      expect(parseAcceptHeader('image/tiff; foo=bar; q=0.7; alpha=omega')).to.eql([{
        mimeType: 'image/tiff',
        qualityValue: 0.7,
      }]);
    });
    it('handles trailing whitespace', function () {
      expect(parseAcceptHeader('image/tiff  ;q=0.1    ,image/png;q=0.2 ')).to.eql([{
        mimeType: 'image/png',
        qualityValue: 0.2,
      }, {
        mimeType: 'image/tiff',
        qualityValue: 0.1,
      }]);
    });
    it('handles leading whitespace', function () {
      expect(parseAcceptHeader('   image/tiff;   q=0.1,   image/png ; q=0.2')).to.eql([{
        mimeType: 'image/png',
        qualityValue: 0.2,
      }, {
        mimeType: 'image/tiff',
        qualityValue: 0.1,
      }]);
    });
    it('handles multiple comma separated values with no spaces', function () {
      expect(parseAcceptHeader('*/*;q=0.2,image/bar')).to.eql([{
        mimeType: 'image/bar',
        qualityValue: 1.0,
      }, {
        mimeType: '*/*',
        qualityValue: 0.2,
      }]);
    });
  });
  describe('isMimeTypeAccepted', function () {
    it('returns true for any value when the header is */*', function () {
      expect(isMimeTypeAccepted('any garbage', '*/*')).to.be.true;
    });

    describe('when the header is image/*', function () {
      const header = 'image/*';
      it('returns true for image/tiff', function () {
        expect(isMimeTypeAccepted('image/tiff', header)).to.be.true;
      });
      it('returns true for image/png', function () {
        expect(isMimeTypeAccepted('image/png', header)).to.be.true;
      });
      it('returns false for application/zarr', function () {
        expect(isMimeTypeAccepted('application/zarr', header)).to.be.false;
      });
      it('returns false for application/image+tiff', function () {
        expect(isMimeTypeAccepted('application/image+tiff', header)).to.be.false;
      });
    });

    describe('when the header is */tiff', function () {
      const header = '*/tiff';
      it('returns true for image/tiff', function () {
        expect(isMimeTypeAccepted('image/tiff', header)).to.be.true;
      });
      it('returns true for application/tiff', function () {
        expect(isMimeTypeAccepted('application/tiff', header)).to.be.true;
      });
      it('returns false for image/geotiff', function () {
        expect(isMimeTypeAccepted('image/geotiff', header)).to.be.false;
      });
    });
    it('returns true when there is an exact match', function () {
      expect(isMimeTypeAccepted('application/zarr', 'application/zarr')).to.be.true;
    });

    describe('when the header is application/shapefile+zip', function () {
      it('returns true when there is an exact match', function () {
        expect(isMimeTypeAccepted('application/shapefile+zip', 'application/shapefile+zip')).to.be.true;
      });
    });
  });
});
