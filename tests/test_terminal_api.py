import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import server


class TerminalApiTests(unittest.TestCase):
    def post(self, path, body, token=server.token):
        raw=json.dumps(body).encode()
        handler=server.Handler.__new__(server.Handler)
        handler.path=path;handler.rfile=io.BytesIO(raw)
        handler.headers={'Content-Length':str(len(raw)),'X-Replay-Token':token}
        result=[];handler.send=lambda value,status=200:result.append((status,value))
        handler.do_POST()
        return result[0]

    def test_terminal_routes_require_authentication_and_dispatch_explicitly(self):
        terminal=Mock()
        with patch.object(server,'terminal',terminal):
            for route in ('symbols','quotes','market','plan','preview','submit'):
                getattr(terminal,route).return_value={'route':route}
                self.assertEqual(self.post('/api/terminal/'+route,{'symbol':'EURUSD'}),(200,{'route':route}))
                self.assertEqual(self.post('/api/terminal/'+route,{},token='wrong')[0],403)
                getattr(terminal,route).assert_called_once()
            terminal.close_preview.return_value={'preview':'close-token'}
            self.assertEqual(self.post('/api/terminal/close-preview',{'position':'42'}),(200,{'preview':'close-token'}))
            self.assertEqual(self.post('/api/terminal/close-preview',{'position':'42'},token='wrong')[0],403)
            terminal.close_preview.assert_called_once_with({'position':'42'})
            terminal.cancel_preview.return_value={'preview':'cancel-token'}
            self.assertEqual(self.post('/api/terminal/cancel-preview',{'order':'88'}),(200,{'preview':'cancel-token'}))
            self.assertEqual(self.post('/api/terminal/cancel-preview',{'order':'88'},token='wrong')[0],403)
            terminal.cancel_preview.assert_called_once_with({'order':'88'})
            terminal.modify_preview.return_value={'preview':'modify-token'}
            self.assertEqual(self.post('/api/terminal/modify-preview',{'order':'88'}),(200,{'preview':'modify-token'}))
            self.assertEqual(self.post('/api/terminal/modify-preview',{'order':'88'},token='wrong')[0],403)
            terminal.modify_preview.assert_called_once_with({'order':'88'})

    def test_index_composes_terminal_template_and_serves_pinned_local_library(self):
        for path in ('/','/terminal-analysis.js','/vendor/lightweight-charts-5.0.9.js'):
            with self.subTest(path=path):
                handler=server.Handler.__new__(server.Handler)
                handler.path=path;handler.server=SimpleNamespace(server_port=8766)
                handler.headers={'Host':'127.0.0.1:8766'};handler.wfile=io.BytesIO()
                handler.send_response=Mock();handler.send_header=Mock();handler.end_headers=Mock()
                handler.do_GET()
                handler.send_response.assert_called_once_with(200)
                content=handler.wfile.getvalue().decode()
                if path=='/':
                    self.assertNotIn('__TERMINAL__',content)
                    self.assertIn('terminal-watchlist',content)
                    self.assertEqual(content.count('id="terminal-pane"'),1)
                    self.assertIn(server.token,content)
                    self.assertLess(content.index('/vendor/lightweight-charts-5.0.9.js'),content.index('/terminal.js'))
                else:self.assertTrue(content)
