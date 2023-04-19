import { expect } from 'chai';
import { MemoryQueue } from  '../../app/util/queue/memory-queue';

describe('MemoryQueue', () => {
  let memoryQueue: MemoryQueue;

  beforeEach(() => {
    memoryQueue = new MemoryQueue();
  });

  it('should initialize messages to an empty array', () => {
    expect(memoryQueue.messages).to.eql([]);
  });

  describe('getMessage', () => {
    it('should return undefined if there are no messages', async () => {
      const message = await memoryQueue.getMessage();
      expect(message).to.be.undefined;
    });

    it('should return the first message and remove it from the queue', async () => {
      await memoryQueue.sendMessage('test1');
      await memoryQueue.sendMessage('test2');

      const message1 = await memoryQueue.getMessage();
      expect(message1?.body).to.equal('test1');

      const message2 = await memoryQueue.getMessage();
      expect(message2?.body).to.equal('test2');

      const message3 = await memoryQueue.getMessage();
      expect(message3).to.be.undefined;
    });
  });

  describe('getMessages', () => {
    it('should return an empty array if there are no messages', async () => {
      const messages = await memoryQueue.getMessages(1);
      expect(messages).to.eql([]);
    });

    it('should return the requested number of messages and remove them from the queue', async () => {
      await memoryQueue.sendMessage('test1');
      await memoryQueue.sendMessage('test2');
      await memoryQueue.sendMessage('test3');

      const messages = await memoryQueue.getMessages(2);
      expect(messages.length).to.equal(2);
      expect(messages[0]?.body).to.equal('test1');
      expect(messages[1]?.body).to.equal('test2');

      const remainingMessages = await memoryQueue.getMessages(1);
      expect(remainingMessages.length).to.equal(1);
      expect(remainingMessages[0]?.body).to.equal('test3');

      const emptyMessages = await memoryQueue.getMessages(1);
      expect(emptyMessages).to.eql([]);
    });
  });

  describe('sendMessage', () => {
    it('should add a new message to the queue', async () => {
      await memoryQueue.sendMessage('test');
      expect(memoryQueue.messages.length).to.equal(1);
      expect(memoryQueue.messages[0]?.body).to.equal('test');
    });
  });

  describe('deleteMessage', () => {
    it('should remove the message with the given receipt from the queue', async () => {
      await memoryQueue.sendMessage('test1');
      await memoryQueue.sendMessage('test2');
      const message1 = await memoryQueue.getMessage();

      await memoryQueue.deleteMessage(message1.receipt);

      expect(memoryQueue.messages.length).to.equal(1);
      expect(memoryQueue.messages[0]?.body).to.equal('test2');
    });

    it('should not remove any messages if the receipt does not match any messages', async () => {
      await memoryQueue.sendMessage('test1');
      await memoryQueue.sendMessage('test2');

      await memoryQueue.deleteMessage('invalid-receipt');

      expect(memoryQueue.messages.length).to.equal(2);
      expect(memoryQueue.messages[0]?.body).to.equal('test1');
      expect(memoryQueue.messages[1]?.body).to.equal('test2');
    });
  });

  describe('deleteMessages', () => {
    it('should remove the messages with the given receipts from the queue', async () => {
      await memoryQueue.sendMessage('test1');
      await memoryQueue.sendMessage('test2');
      await memoryQueue.sendMessage('test3');
      const message1 = await memoryQueue.getMessage();
      const _message2 = await memoryQueue.getMessage();
      const message3 = await memoryQueue.getMessage();

      await memoryQueue.deleteMessages([message1.receipt, message3.receipt]);

      expect(memoryQueue.messages.length).to.equal(1);
      expect(memoryQueue.messages[0]?.body).to.equal('test2');
    });
  });
});
