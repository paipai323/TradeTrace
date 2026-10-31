import argparse
import json
import secrets
import webbrowser
import hashlib
import urllib.request
import base64
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from core import Bridge, running_terminals
from terminal import Terminal

ROOT = Path(__file__).parent / 'static'
bridge = Bridge()
terminal = Terminal(bridge)
token = secrets.token_urlsafe(32)
VERSION = '1.7.0'
APP_ID = 'local-mt5-replay'
APP_ROOT = Path(__file__).resolve().parent
BUILD = hashlib.sha256(b''.join((APP_ROOT / f).read_bytes() for f in
    ['terminal.py', 'static/terminal.js', 'static/terminal.css', 'server.py', 'core.py', 'credentials.py', 'journal.py', 'static/journal.js', 'static/journal.css', 'static/app.js', 'static/connection.js', 'static/index.html', 'static/style.css', 'native_history.py'])).hexdigest()[:12]


def health():
    return dict(app=APP_ID, version=VERSION, build=BUILD,
        workspace=hashlib.sha256(str(APP_ROOT).encode()).hexdigest()[:12])


def existing_server(url):
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url + '/health', timeout=2) as response:
            info = json.load(response)
        return info == health()
    except (OSError, ValueError):
        return False


class Handler(BaseHTTPRequestHandler):
    def send(self, value, status=200):
        raw = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'):
            return self.send({'error': 'Invalid host'}, 403)
        if urlparse(self.path).path == '/health':
            return self.send(health())
        routes = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
        routes['/connection.js'] = ('connection.js', 'text/javascript')
        routes['/journal.js'] = ('journal.js', 'text/javascript')
        routes['/journal.css'] = ('journal.css', 'text/css')
        routes['/terminal.js'] = ('terminal.js', 'text/javascript')
        routes['/terminal.css'] = ('terminal.css', 'text/css')
        route = routes.get(urlparse(self.path).path)
        if not route:
            return self.send({'error': 'Not found'}, 404)
        raw = (ROOT / route[0]).read_text(encoding='utf-8').replace('__TOKEN__', token).replace('__VERSION__', VERSION).replace('__BUILD__', BUILD).encode()
        self.send_response(200)
        self.send_header('Content-Type', route[1] + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if self.headers.get('X-Replay-Token') != token:
            return self.send({'error': 'Unauthorized'}, 403)
        try:
            length = int(self.headers.get('Content-Length', 0))
            limit = 5 * 1024 * 1024 if self.path == '/api/journal/attach' else 128 * 1024
            if not 0 < length < limit:
                raise ValueError('Invalid request length')
            body = json.loads(self.rfile.read(length))
            if self.path == '/api/terminal/symbols':
                result = terminal.symbols()
            elif self.path == '/api/terminal/market':
                result = terminal.market(body)
            elif self.path == '/api/terminal/preview':
                result = terminal.preview(body)
            elif self.path == '/api/terminal/submit':
                result = terminal.submit(body)
            elif self.path == '/api/journal/overview':
                result = bridge.journal.overview(body.get('account') or bridge.journal_account)
            elif self.path == '/api/journal/entry':
                result = bridge.journal.entry(body['account'], str(body['position']))
            elif self.path == '/api/journal/draft':
                result = bridge.journal.save_draft(body['account'], str(body['position']), body['review'], body.get('base_updated'))
            elif self.path == '/api/journal/save':
                result = bridge.journal.save(body['account'], str(body['position']), body['review'])
            elif self.path == '/api/journal/attach':
                result = bridge.journal.attach(body['account'], str(body['position']), body.get('name', 'Screenshot'), body['data'])
            elif self.path == '/api/journal/image':
                raw,mime = bridge.journal.image(body['account'],body['id'])
                result = dict(data=base64.b64encode(raw).decode('ascii'),mime=mime)
            elif self.path == '/api/journal/remove-image':
                result = bridge.journal.remove_image(body['account'],body['id'])
            elif self.path == '/api/journal/backup':
                raw=bridge.journal.backup()
                self.send_response(200)
                self.send_header('Content-Type','application/octet-stream')
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                self.wfile.write(raw)
                return
            elif self.path == '/api/terminals':
                bridge.stage = 'terminal'
                result = dict(terminals=running_terminals())
            elif self.path == '/api/connect':
                result = bridge.connect(body.get('path', '').strip())
            elif self.path == '/api/connect-all':
                result = bridge.connect_all(body.get('path', '').strip(), body.get('url') or 'http://127.0.0.1:22346/mcp', body.get('key', ''))
            elif self.path == '/api/session':
                result = bridge.session_status()
            elif self.path == '/api/forget-key':
                bridge.key_store.forget()
                bridge.direct = None
                bridge.native_levels = {}
                result = dict(message='Saved API key removed. Enter a key to reconnect direct history.')
            elif self.path == '/api/history':
                start = datetime.strptime(body['start'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
                end = datetime.strptime(body['end'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(days=1)
                if end <= start:
                    raise ValueError('End date must be on or after start date.')
                result = bridge.history(start, end)
            elif self.path == '/api/replay':
                result = bridge.replay(str(body['id']), body.get('context_minutes', 'auto'), body.get('candle_timeframe','M1'), body.get('after_minutes',60))
            elif self.path == '/api/verify':
                result = bridge.verify(str(body['id']))
            elif self.path == '/api/connect-native':
                result = bridge.connect_native(body.get('url', ''), body.get('key', ''))
            elif self.path == '/api/sync-levels':
                bridge.check()
                result = bridge.sync_levels()
            else:
                return self.send({'error': 'Not found'}, 404)
            self.send(result)
        except (ValueError, KeyError, TypeError) as exc:
            self.send({'error': str(exc), 'stage': bridge.stage}, 400)
        except Exception:
            self.send({'error': 'Unexpected connector error. Check MT5 connection and retry.'}, 500)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}'
    try:
        server = HTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        if existing_server(url):
            print(f'MT5 Replay {VERSION} is already running: {url}', flush=True)
            if not args.no_browser:
                webbrowser.open(url)
            raise SystemExit(0)
        print(f'Port {args.port} is occupied by an older replay version or another app. Close the old replay console and run Start.cmd again. No process was stopped.', flush=True)
        raise SystemExit(1)
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'MT5 Replay {VERSION} ({BUILD}): {url}  (Ctrl+C to stop)', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if bridge.mt:
            bridge.mt.shutdown()
