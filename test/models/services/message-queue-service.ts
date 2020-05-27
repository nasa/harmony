import { describe, it } from 'mocha';
import { expect } from 'chai';
import hookServersStartStop from 'harmony-test/servers';
import { defaultVersion, hookRangesetRequest } from 'harmony-test/ogc-api-coverages';
import { hookStubSend } from '../../helpers/message-queue';

describe('Message Queue Service', function () {
  const mqCollection = 'C1234088182-EEDTEST'; // Harmony Example L3 v2 in UAT
  hookServersStartStop();
  hookStubSend();
  hookRangesetRequest(defaultVersion, mqCollection);

  it('passes the incoming messages to the configured message queue', async function () {
    // Assert it resulted in a single message to SQS that contains the collection we requested
    expect(this.sendStub.calledOnce).to.be.true;

    const arg = this.sendStub.firstCall.args[0];
    expect(arg.QueueUrl).to.equal('http://localhost:4566/queue/harmony-gdal-queue');

    const message = JSON.parse(arg.MessageBody);
    expect(message.sources[0].collection).to.equal(mqCollection);
  });
});
