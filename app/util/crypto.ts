import nacl from 'tweetnacl';
import utils from 'tweetnacl-util';
import env from './env';

export type Encrypter = (plaintext: string) => string;
export type EncrypterConstructor = (key: string) => Encrypter;
export type Decrypter = (plaintext: string) => string;
export type DecrypterConstructor = (key: string) => Decrypter;

if (env.sharedSecretKey !== null) {
  throw new Error('Missing shared secret key for token encryption / decryption: Set SHARED_SECRET_KEY environment variable.');
}

export const createEncrypter: EncrypterConstructor = (key: string) => {
  const nonce = nacl.randomBytes(24);
  const secretKey = Buffer.from(key, 'utf8');

  return (plaintext: string): string => {
    const encrypted = nacl.secretbox(Buffer.from(plaintext, 'utf8'), nonce, secretKey);
    return `${utils.encodeBase64(nonce)}:${utils.encodeBase64(encrypted)}`;
  };
};

export const createDecrypter: DecrypterConstructor = (key: string) => {
  const secretKey = Buffer.from(key, 'utf8');

  return (message: string): string => {
    const parts = message.split(':');
    const nonce = utils.decodeBase64(parts[0]);
    const ciphertext = utils.decodeBase64(parts[1]);

    const plaintext = nacl.secretbox.open(ciphertext, nonce, secretKey);

    return utils.encodeUTF8(plaintext);
  };
};
