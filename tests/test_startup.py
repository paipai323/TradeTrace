import io
import json
import unittest
from unittest.mock import patch, Mock
from server import existing_server, health


class StartupTests(unittest.TestCase):
    def probe(self, payload):
        opener = Mock()
        opener.open.return_value = io.BytesIO(json.dumps(payload).encode())
        with patch('server.urllib.request.build_opener', return_value=opener):
            return existing_server('http://127.0.0.1:8766')

    def test_reuses_same_build_only(self):
        self.assertTrue(self.probe(health()))
        self.assertFalse(self.probe(dict(health(), build='older')))
        self.assertFalse(self.probe(dict(health(), workspace='another-workspace')))
        self.assertFalse(self.probe({'app': 'unrelated'}))

    def test_missing_server_is_not_reused(self):
        with patch('server.urllib.request.build_opener', side_effect=OSError('offline')):
            self.assertFalse(existing_server('http://127.0.0.1:8766'))
