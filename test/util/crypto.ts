import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createEncrypter, createDecrypter } from '../../app/util/crypto';

describe('util/crypto', function () {
  describe('#createEncrypter', function () {
    it('encrypts plaintext into ciphertext', function () {
      const encrypter = createEncrypter('_THIS_IS_MY_32_CHARS_SECRET_KEY_');
      const plaintext = 'The secret code is the number 7';
      const ciphertext = encrypter(plaintext);

      expect(ciphertext).to.not.equal(plaintext);
    });
  });

  describe('#createDecrypter', function () {
    describe('when using the correct shared key', function () {
      it('decrypts ciphertext into the correct plaintext', function () {
        const sharedSecretKey = '_THIS_IS_MY_32_CHARS_SECRET_KEY_';
        const encrypter = createEncrypter(sharedSecretKey);
        const plaintext = 'ABCD1234567890';
        const ciphertext = encrypter(plaintext);
        console.log(ciphertext);

        const decrypter = createDecrypter(sharedSecretKey);
        const decodedPlaintext = decrypter(ciphertext);

        expect(decodedPlaintext).to.equal(plaintext);
      });
    });

    describe('when using the incorrect key', function () {
      it('fails to decrypt and returns null plaintext', function () {
        const encrypter = createEncrypter('_THIS_IS_MY_32_CHARS_SECRET_KEY_');
        const plaintext = 'The secret code is the number 7';
        const ciphertext = encrypter(plaintext);

        const decrypter = createDecrypter('_THIS_IS_A_DIFFERENT_SECRET_KEY_');
        const decodedPlaintext = decrypter(ciphertext);

        expect(decodedPlaintext).to.not.equal(plaintext);
        expect(decodedPlaintext).to.be.null;
      });
    });
  });
});
