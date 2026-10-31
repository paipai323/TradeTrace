"""Windows user-scoped DPAPI storage. Plaintext credentials never touch disk."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(raw, decrypt=False):
    if os.name != 'nt':
        raise ValueError('Saving the API key requires Windows encryption.')
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    # CRYPTPROTECT_UI_FORBIDDEN; no machine-wide scope, so only this Windows user can decrypt.
    if decrypt:
        call = crypt.CryptUnprotectData
        call.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = call(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        call = crypt.CryptProtectData
        call.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        ok = call(ctypes.byref(source), 'MT5 Replay local API key', None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise ValueError('Windows could not unlock the saved API key. Re-enter it under your normal Windows account.')
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


class KeyStore:
    def __init__(self, path=None):
        self.path = Path(path) if path else Path(__file__).parent / '.local' / 'native-key.bin'

    def save(self, url, key):
        encrypted = dpapi(json.dumps(dict(url=url, key=key)).encode('utf-8'))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        try:
            temporary.write_bytes(encrypted)
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def load(self):
        if not self.path.exists():
            return None
        try:
            value = json.loads(dpapi(self.path.read_bytes(), decrypt=True))
            if not isinstance(value.get('url'), str) or not isinstance(value.get('key'), str) or not value['key']:
                raise ValueError()
            return value
        except (OSError, ValueError, UnicodeError):
            raise ValueError('Cannot unlock the saved API key. Enter it again or use Forget saved key.')

    def forget(self):
        self.path.unlink(missing_ok=True)
