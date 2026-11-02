import argparse
import json
import secrets
import webbrowser
import hashlib
import urllib.request
import base64
import sys
import threading
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from core import Bridge, running_terminals
from terminal import Terminal
from condition_monitor import ConditionMonitor

ROOT = Path(__file__).parent / 'static'
bridge = Bridge()
terminal = Terminal(bridge)
token = secrets.token_urlsafe(32)
api_lock = threading.RLock()
condition_monitor = ConditionMonitor(terminal, api_lock)
VERSION = '1.18.0'
APP_ID = 'local-mt5-replay'
APP_ROOT = Path(__file__).resolve().parent
BUILD = hashlib.sha256(b''.join((APP_ROOT / f).read_bytes() for f in
    ['entry_quality.py', 'condition_engine.py', 'condition_monitor.py', 'timeframes.py', 'terminal.py', 'static/terminal.js', 'static/terminal.css', 'static/terminal.html', 'static/terminal-analysis.js', 'static/terminal-conditions.js', 'static/vendor/lightweight-charts-5.0.9.js', 'server.py', 'core.py', 'credentials.py', 'journal.py', 'static/journal.js', 'static/journal.css', 'static/app.js', 'static/connection.js', 'static/index.html', 'static/style.css', 'native_history.py'])).hexdigest()[:12]


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


class AppServer(ThreadingHTTPServer):
    # Finish active broker requests before closing the process.
    daemon_threads = False


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

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
        routes['/favicon.svg'] = ('favicon.svg', 'image/svg+xml')
        routes['/journal.js'] = ('journal.js', 'text/javascript')
        routes['/journal.css'] = ('journal.css', 'text/css')
        routes['/terminal-conditions.js'] = ('terminal-conditions.js', 'text/javascript')
        routes['/terminal.js'] = ('terminal.js', 'text/javascript')
        routes['/terminal.css'] = ('terminal.css', 'text/css')
        routes['/terminal-analysis.js'] = ('terminal-analysis.js', 'text/javascript')
        routes['/vendor/lightweight-charts-5.0.9.js'] = ('vendor/lightweight-charts-5.0.9.js', 'text/javascript')
        route = routes.get(urlparse(self.path).path)
        if not route:
            return self.send({'error': 'Not found'}, 404)
        source = (ROOT / route[0]).read_text(encoding='utf-8')
        if route[0] == 'index.html':
            source = source.replace('__TERMINAL__', (ROOT / 'terminal.html').read_text(encoding='utf-8-sig'))
        raw = source.replace('__TOKEN__', token).replace('__VERSION__', VERSION).replace('__BUILD__', BUILD).encode()
        self.send_response(200)
        self.send_header('Content-Type', route[1] + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        # Record Stop intent before waiting for an in-flight broker read/preview.
        # Only the normal serialized handler mutates monitor/broker state.
        if self.path == '/api/terminal/conditions/stop' and self.headers.get('X-Replay-Token') == token:
            try:
                length=int(self.headers.get('Content-Length',0))
                if not 0<length<32768:raise ValueError('Invalid stop request length')
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):raise ValueError('Invalid stop request')
                condition_monitor.signal_stop(body)
                with api_lock:self.send(condition_monitor.stop(body))
            except (ValueError,TypeError) as error:self.send({'error':str(error)},400)
            return
        # MT5 and journal state remain serialized, while idle browser sockets
        # cannot block assets, health checks or new connections.
        with api_lock:
            self.handle_api()

    def handle_api(self):
        if self.headers.get('X-Replay-Token') != token:
            return self.send({'error': 'Unauthorized'}, 403)
        try:
            length = int(self.headers.get('Content-Length', 0))
            limit = 5 * 1024 * 1024 if self.path == '/api/journal/attach' else 128 * 1024
            if not 0 < length < limit:
                raise ValueError('Invalid request length')
            body = json.loads(self.rfile.read(length))
            if self.path == '/api/terminal/conditions/start':
                result = condition_monitor.start(body)
            elif self.path == '/api/terminal/conditions/status':
                result = condition_monitor.status(body)
            elif self.path == '/api/terminal/conditions/stop':
                result = condition_monitor.stop(body)
            elif self.path == '/api/terminal/symbols':
                result = terminal.symbols()
            elif self.path == '/api/terminal/quotes':
                result = terminal.quotes(body)
            elif self.path == '/api/terminal/market':
                result = terminal.market(body)
            elif self.path == '/api/terminal/plan':
                result = terminal.plan(body)
            elif self.path == '/api/terminal/estimate':
                result = terminal.estimate(body)
            elif self.path == '/api/terminal/closed':
                result = terminal.closed(body)
            elif self.path == '/api/terminal/preview':
                result = terminal.preview(body)
            elif self.path == '/api/terminal/close-preview':
                result = terminal.close_preview(body)
            elif self.path == '/api/terminal/cancel-preview':
                result = terminal.cancel_preview(body)
            elif self.path == '/api/terminal/modify-preview':
                result = terminal.modify_preview(body)
            elif self.path == '/api/terminal/position-preview':
                result = terminal.position_preview(body)
            elif self.path == '/api/terminal/condition-plan':
                result = terminal.condition_plan(body)
            elif self.path == '/api/terminal/submit':
                try:
                    condition_monitor.before_submission(body)
                    result = terminal.submit(body)
                except Exception as error:
                    condition_monitor.record_submission(body,error=error)
                    raise
                condition_monitor.record_submission(body,result=result)
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
    parser.add_argument('--managed', action='store_true', help='Stop when the launcher sends stop or closes its input pipe.')
    args = parser.parse_args()
    # NumPy/native DLL initialization can deadlock on Windows if the launcher's
    # stdin watcher is already blocked in a CRT read. Load MT5 first, on the main
    # thread; actual terminal/account connection still waits for an API request.
    try:
        import MetaTrader5
    except ImportError:
        pass  # The connection API retains its actionable Install.cmd error.
    url = f'http://127.0.0.1:{args.port}'
    try:
        server = AppServer(('127.0.0.1', args.port), Handler)
    except OSError:
        if existing_server(url):
            print(f'MT5 Replay {VERSION} is already running: {url}', flush=True)
            if not args.no_browser:
                webbrowser.open(url)
            raise SystemExit(0)
        print(f'Port {args.port} is occupied by an older replay version or another app. Close the old replay console and run Start.cmd again. No process was stopped.', flush=True)
        raise SystemExit(1)
    condition_monitor.launch()
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'MT5 Replay {VERSION} ({BUILD}): {url}  (Ctrl+C to stop)', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    if args.managed:
        def watch_launcher():
            # The anonymous pipe belongs only to the parent launcher. No HTTP
            # shutdown endpoint is exposed to browser pages or other apps.
            for command in sys.stdin:
                if command.strip().lower() == 'stop':
                    break
            condition_monitor.shutdown.set();condition_monitor.signal_stop({})
            server.shutdown()
        threading.Thread(target=watch_launcher, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        condition_monitor.shutdown.set();condition_monitor.signal_stop({})
        server.server_close()
        condition_monitor.close()
        if bridge.mt:
            bridge.mt.shutdown()
