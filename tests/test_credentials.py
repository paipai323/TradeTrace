import os
import tempfile
import unittest
from pathlib import Path
from credentials import KeyStore


@unittest.skipUnless(os.name == 'nt', 'Windows DPAPI required')
class CredentialsTests(unittest.TestCase):
    def test_encrypted_disk_roundtrip_and_forget(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / 'key.bin'
            store = KeyStore(path)
            self.assertIsNone(store.load())
            try:
                store.save('http://127.0.0.1:22346/mcp', 'fixture-secret-only')
            except ValueError:
                self.skipTest('Windows profile encryption unavailable in this sandbox')
            self.assertNotIn(b'fixture-secret-only', path.read_bytes())
            self.assertEqual(KeyStore(path).load()['key'], 'fixture-secret-only')
            self.assertFalse(path.with_suffix('.tmp').exists())
            store.forget()
            self.assertFalse(path.exists())
            self.assertIsNone(store.load())

    def test_corrupt_file_returns_clear_error(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / 'key.bin'
            path.write_bytes(b'invalid ciphertext')
            with self.assertRaisesRegex(ValueError, 'Cannot unlock'):
                KeyStore(path).load()
