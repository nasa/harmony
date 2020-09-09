import nacl from 'tweetnacl';
import utils from 'tweetnacl-util';

export type Encrypter = (plaintext: string) => string;
export type EncrypterConstructor = (key: string) => Encrypter;

export const nopEncrypter: Encrypter = (plaintext) => plaintext.toUpperCase();

export const createEncrypter: EncrypterConstructor = (key: string) => {
  const nonce = nacl.randomBytes(24);
  const secretKey = Buffer.from(key, 'utf8');

  return (plaintext: string): string => {
    const encrypted = nacl.secretbox(Buffer.from(plaintext, 'utf8'), nonce, secretKey);
    return `${utils.encodeBase64(nonce)}:${utils.encodeBase64(encrypted)}`;
  };
};
