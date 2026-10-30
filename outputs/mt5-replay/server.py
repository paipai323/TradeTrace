import argparse
import json
import secrets
import webbrowser
from datetime import datetime, timezone, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from core import Bridge

ROOT = Path(__file__).parent / 'static'
bridge = Bridge()
token = secrets.token_urlsafe(32)


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
        routes = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
        route = routes.get(urlparse(self.path).path)
        if not route:
            return self.send({'error': 'Not found'}, 404)
        raw = (ROOT / route[0]).read_text(encoding='utf-8').replace('__TOKEN__', token).encode()
        self.send_response(200)
        self.send_header('Content-Type', route[1] + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if self.headers.get('X-Replay-Token') != token:
            return self.send({'error': 'Unauthorized'}, 403)
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length < 8192:
                raise ValueError('Invalid request length')
            body = json.loads(self.rfile.read(length))
            if self.path == '/api/connect':
                result = bridge.connect(body.get('path', '').strip())
            elif self.path == '/api/history':
                start = datetime.strptime(body['start'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
                end = datetime.strptime(body['end'], '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(days=1)
                if end <= start:
                    raise ValueError('End date must be on or after start date.')
                result = bridge.history(start, end)
            elif self.path == '/api/replay':
                result = bridge.replay(str(body['id']))
            else:
                return self.send({'error': 'Not found'}, 404)
            self.send(result)
        except (ValueError, KeyError, TypeError) as exc:
            self.send({'error': str(exc)}, 400)
        except Exception:
            self.send({'error': 'Unexpected connector error. Check MT5 connection and retry.'}, 500)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    server = HTTPServer(('127.0.0.1', args.port), Handler)
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'MT5 Replay: {url}  (Ctrl+C to stop)', flush=True)
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
