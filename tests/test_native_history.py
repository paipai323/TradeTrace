import io
import json
import unittest
from unittest.mock import Mock, patch
from native_history import NativeHistory, decode_result, date_arguments
from datetime import datetime, timezone


class NativeHistoryTests(unittest.TestCase):
    def test_rejects_remote_urls_and_trading_calls(self):
        with self.assertRaises(ValueError):
            NativeHistory('https://example.com/mcp', 'key')
        client = NativeHistory.__new__(NativeHistory)
        with self.assertRaises(ValueError):
            client.call('trade_send_market_order', {})

    def test_json_and_sse_response_and_session(self):
        for event_stream in (False, True):
            client = NativeHistory.__new__(NativeHistory)
            client.url, client.key, client.session, client.request_id = 'http://127.0.0.1:22346/mcp', 'test-only', None, 0
            client.protocol = '2025-03-26'
            message = json.dumps(dict(jsonrpc='2.0', id=1, result={'tools':[]}))
            raw = ('event: message\ndata: ' + message + '\n\n').encode() if event_stream else message.encode()
            response = io.BytesIO(raw)
            response.headers = {'Content-Type':'text/event-stream' if event_stream else 'application/json', 'Mcp-Session-Id':'test-session'}
            client.opener = Mock()
            client.opener.open.return_value = response
            self.assertEqual(client.rpc('tools/list'), {'tools':[]})
            self.assertEqual(client.session, 'test-session')

    def test_account_identity_must_match_both_login_and_server(self):
        client = NativeHistory.__new__(NativeHistory)
        client.call = Mock(return_value={'account':{'login':123,'server':'BrokerA'}})
        client.verify_account(123, 'BrokerA')
        for account, server in [(456,'BrokerA'),(123,'BrokerB')]:
            with self.assertRaises(ValueError):
                client.verify_account(account, server)

    def test_unsupported_result_or_required_arguments_fail_explicitly(self):
        with self.assertRaises(ValueError):
            decode_result({'content':[{'type':'text','text':'not JSON'}]})
        with self.assertRaises(ValueError):
            date_arguments({'required':['unknown']}, datetime.now(timezone.utc), datetime.now(timezone.utc))

    def test_key_rejection_has_no_secret_in_error(self):
        import urllib.error
        client = NativeHistory.__new__(NativeHistory)
        client.url, client.key, client.session, client.request_id = 'http://127.0.0.1:22346/mcp', 'test-secret', None, 0
        client.protocol = '2025-03-26'
        client.opener = Mock()
        client.opener.open.side_effect = urllib.error.HTTPError(client.url, 401, 'Unauthorized', {}, None)
        with self.assertRaisesRegex(ValueError, 'key was rejected') as error:
            client.rpc('tools/list')
        self.assertNotIn('test-secret', str(error.exception))
