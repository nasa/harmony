import { describe, it } from 'mocha';
import { expect } from 'chai';
import * as tmp from 'tmp-promise';
import { promises as fs } from 'fs';

// do this before the import since the env module clones process.env on import 
const prevProcessEnv = process.env;
process.env.CLIENT_ID = 'client-007';
import { HarmonyEnv, getValidationErrors } from '../env';

describe('Environment validation', function () {

  afterEach(function () {
    process.env = prevProcessEnv;
  });

  describe('When the environment is valid', function () {
    before(async function () {
      this.envFile = await tmp.file();
      const envContent = 'DATABASE_TYPE=cassandra';
      await fs.writeFile(this.envFile.path, envContent, 'utf8');
      console.log(this.envFile.path);
      this.validEnv = new HarmonyEnv(undefined, this.envFile.path);
    });
    after(async function () {
      await this.envFile.cleanup();
    });

    it('does not throw an error when validated', function () {
      expect(() => this.validEnv.validate()).not.to.Throw;
    });

    it('does not log any errors', function () {
      expect(getValidationErrors(this.validEnv).length).to.eql(0);
    });

    it('sets special values (values that are set manually) using env-defaults', function () {
      expect(this.validEnv.useServiceQueues).to.eql(true);
    });

    it('sets non-special values using env-defaults', function () {
      expect(this.validEnv.localstackHost).to.eql('localstack');
    });

    it('converts non-string types', function () {
      expect(this.validEnv.defaultResultPageSize).to.eql(2000);
    });

    it('overrides env file config with values read from process.env', function () {
      expect(this.validEnv.clientId).to.eql('client-007');
    });

    it('overrides the env util env-defaults with .env file values', function () {
      expect(this.validEnv.databaseType).to.eql('cassandra');
    });

    it('sets service queue urls', function () {
      expect(this.validEnv.serviceQueueUrls['harmonyservices/service-example:latest'])
        .to.eql('http://localstack:4566/queue/harmony-service-example.fifo');
    });
    
    // todo .env override, process, subclass, etc
  });

  describe('When the environment is invalid', function () {
    
    before(function () {
      this.invalidEnv = new HarmonyEnv();
      this.invalidEnv.port = -1;
      this.invalidEnv.callbackUrlRoot = 'foo';
    });
    
    it('throws an error when validated', function () {
      expect(() => this.invalidEnv.validate()).to.throw;
    });

    it('logs two errors', function () {
      expect(getValidationErrors(this.invalidEnv)).to.eql([
        {
          'children': [],
          'constraints': {
            'isUrl': 'callbackUrlRoot must be a URL address',
          },
          'property': 'callbackUrlRoot',
          'value': 'foo',
        },
        {
          'children': [],
          'constraints': {
            'min': 'port must not be less than 0',
          },
          'property': 'port',
          'value': -1,
        },
      ]);
    });
  });
});