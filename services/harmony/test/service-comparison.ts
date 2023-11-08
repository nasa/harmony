import { ServiceConfig } from '../app/models/services/base-service';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { allValidations } from '../../../scripts/service-comparison';


describe('service-comparison.ts', function () {
  describe('validateConcatenation', async function () {
    const validateConcatenationFn = allValidations[3];
    describe('when concatenate by default is true for the Harmony config and false for the UMM-S record', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {
            Aggregation: {
              Concatenate: {
                ConcatenateDefault: false,
              },
            },
          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: true,
          concatenate_by_default: true,
        },
      };
      it('returns an error describing the condition', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('Concatenate by default mismatch: harmony is true and UMM-S is false.');
      });
    });
    describe('when concatenate by default is false for the Harmony config and true for the UMM-S record', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {
            Aggregation: {
              Concatenate: {
                ConcatenateDefault: true,
              },
            },
          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: true,
          concatenate_by_default: false,
        },
      };
      it('returns an error describing the condition', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('Concatenate by default mismatch: harmony is false and UMM-S is true.');
      });
    });
    describe('when the UMM-S record matches the Harmony config (both support concatenation and concatenate by default)', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {
            Aggregation: {
              Concatenate: {
                ConcatenateDefault: true,
              },
            },
          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: true,
          concatenate_by_default: true,
        },
      };
      it('returns an empty string', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('');
      });
    });
    describe('when the UMM-S record matches the Harmony config (both do not support concatenation)', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {

          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: false,
          concatenate_by_default: false,
        },
      };
      it('returns an empty string', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('');
      });
    });
    describe('when the UMM-S record has no Concatenate property and the Harmony config has concatenation=true', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {
            Aggregation: {
              
            },
          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: true,
          concatenate_by_default: true,
        },
      };
      it('returns an error describing the condition', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('Concatenation mismatch: harmony is true and UMM-S is false. Concatenate by default mismatch: harmony is true and UMM-S is false.');
      });
    });
    describe('when the UMM-S record has no Aggregation property and Harmony has concatenation=true', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {

          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: true,
          concatenate_by_default: true,
        },
      };
      it('returns an error describing the condition', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('Concatenation mismatch: harmony is true and UMM-S is false. Concatenate by default mismatch: harmony is true and UMM-S is false.');
      });
    });
    describe('when the UMM-S record has Concatenation and Harmony has concatenation=false', async function () {
      const ummRecord = {
        meta: {
          'concept-id': 'service-a',
        },
        umm: {
          Name: 'harmony subsetter',
          ServiceOptions: {
            Aggregation: {
              Concatenate: {
                ConcatenateDefault: false,
              },
            },
          },
        },
      };
      const harmonyConfig: ServiceConfig<unknown> = {
        capabilities: {
          concatenation: false,
          concatenate_by_default: false,
        },
      };
      it('returns an error describing the condition', function () {
        const error = validateConcatenationFn(ummRecord, harmonyConfig);
        expect(error).to.eq('Concatenation mismatch: harmony is false and UMM-S is true.');
      });
    });
  });
});
