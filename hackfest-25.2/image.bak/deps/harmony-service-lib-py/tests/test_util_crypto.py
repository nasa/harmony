from base64 import b64encode
import unittest

from nacl.secret import SecretBox
from nacl.utils import random

from harmony_service_lib import util


class TestDecrypter(unittest.TestCase):
    def test_when_using_nop_decrypter_the_plaintext_is_the_same_as_cyphertext(self):
        decrypter = util.nop_decrypter
        cyphertext = 'This is a terribly encrypted message.'
        expected = cyphertext

        actual = decrypter(cyphertext)

        self.assertEqual(actual, expected)

    def test_when_encrypting_with_a_key_the_decrypter_works_when_using_the_shared_key(self):
        nonce = random(SecretBox.NONCE_SIZE)
        shared_key = random(SecretBox.KEY_SIZE)
        box = SecretBox(shared_key)
        plaintext = 'The ship has arrived at the port'
        encrypted_msg = box.encrypt(bytes(plaintext, 'utf-8'), nonce)
        nonce_str = b64encode(encrypted_msg.nonce).decode("utf-8")
        encrypted_msg_str = b64encode(encrypted_msg.ciphertext).decode("utf-8")
        message = f'{nonce_str}:{encrypted_msg_str}'

        decrypter = util.create_decrypter(shared_key)
        decrypted_text = decrypter(message)

        self.assertNotEqual(plaintext, encrypted_msg.ciphertext)
        self.assertEqual(plaintext, decrypted_text)

    def test_when_encrypting_with_a_key_the_decrypter_fails_when_not_using_the_shared_key(self):
        nonce = random(SecretBox.NONCE_SIZE)
        shared_key = random(SecretBox.KEY_SIZE)
        box = SecretBox(shared_key)
        plaintext = b'The ship has arrived at the port'
        encrypted_msg = box.encrypt(plaintext, nonce)
        nonce_str = b64encode(encrypted_msg.nonce).decode("utf-8")
        encrypted_msg_str = b64encode(encrypted_msg.ciphertext).decode("utf-8")
        message = f'{nonce_str}:{encrypted_msg_str}'

        incorrect_key = random(SecretBox.KEY_SIZE)
        decrypter = util.create_decrypter(incorrect_key)
        with self.assertRaises(Exception):
            decrypter(message)

        self.assertNotEqual(plaintext, encrypted_msg.ciphertext)
