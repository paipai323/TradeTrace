"""Interactive console controlling only the server process it starts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser


ROOT = Path(__file__).resolve().parent


class Launcher:
    def __init__(self, port=8766):
        self.port = port
        self.url = f'http://127.0.0.1:{port}'
        self.process = None
        self.log_path = ROOT / 'work' / 'server.log'
        self.workspace = hashlib.sha256(str(ROOT).encode()).hexdigest()[:12]

    def probe(self):
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(self.url + '/health', timeout=1) as response:
                info = json.load(response)
            return info if info.get('app') == 'local-mt5-replay' and info.get('workspace') == self.workspace else None
        except (OSError, ValueError, AttributeError):
            return None

    def running(self):
        return self.process is not None and self.process.poll() is None

    def status(self):
        info = self.probe()
        if info:
            owner = '' if self.running() else ' (started outside this console)'
            return f'Running v{info.get("version", "?")}{owner}'
        return 'Starting / not responding' if self.running() else 'Stopped'

    def start(self):
        if self.running():
            return 'Already running.'
        if self.probe():
            return 'Already running outside this console. Close its old server window first to enable Start / Stop / Restart here.'
        if self.process is not None and self.process.stdin is not None:
            self.process.stdin.close()
        self.log_path.parent.mkdir(exist_ok=True)
        # Hide the child console on Windows; keep all server output out of the menu.
        with self.log_path.open('ab') as log:
            self.process = subprocess.Popen(
                [sys.executable, str(ROOT / 'server.py'), '--port', str(self.port), '--no-browser', '--managed'],
                cwd=ROOT, stdin=subprocess.PIPE, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                return f'Start failed. See {self.log_path} (the port may already be occupied).'
            if self.probe():
                return 'Server started.'
            time.sleep(.15)
        return f'Server has not responded yet. Check status or view {self.log_path}.'

    def stop(self):
        if not self.running():
            return 'No server owned by this console is running. If another server window is open, close that window.' if self.probe() else 'Already stopped.'
        process = self.process
        try:
            process.stdin.write(b'stop\n')
            process.stdin.flush()
        except (OSError, ValueError):
            pass
        try:
            process.wait(timeout=25)
        except subprocess.TimeoutExpired:
            # A broker request may still be finishing. Never interrupt its result
            # or kill a process by port/name; shutdown waits for the request.
            return 'Stop requested; waiting for an active server request to finish. Refresh status shortly.'
        finally:
            process.stdin.close()
        return 'Server stopped. MT5 stays open; broker positions and orders are unchanged.'

    def restart(self):
        if not self.running() and self.probe():
            return 'Server belongs to another console. Close its old window first, then choose Start.'
        self.stop()
        return self.start()

    def open_browser(self):
        if not self.probe():
            return 'Server is stopped or not ready. Choose Start first.'
        webbrowser.open(self.url)
        return 'Browser opened.'

    def logs(self):
        if not self.log_path.exists():
            return 'No server log yet.'
        # Read only the tail even after a long-running market session.
        with self.log_path.open('rb') as stream:
            stream.seek(0, 2)
            stream.seek(max(0, stream.tell() - 12000))
            return '\n'.join(stream.read().decode('utf-8', errors='replace').splitlines()[-20:])


def main():
    parser = argparse.ArgumentParser(description='TradeTrace interactive server controls')
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    launcher = Launcher(args.port)
    try:
        message = launcher.start()
        if launcher.probe():
            launcher.open_browser()
        while True:
            os.system('cls' if os.name == 'nt' else 'clear')
            print('TradeTrace | Server Control\n')
            print(f'Status: {launcher.status()}\nBrowser: {launcher.url}')
            print('\n[1] Start   [2] Stop   [3] Restart   [4] Open browser')
            print('[5] Refresh status   [6] View recent logs   [0] Exit\n')
            print(message + '\n')
            action = input('Choose an action: ').strip().lower()
            if action in ('0', 'q', 'exit'):
                break
            commands = {'1': launcher.start, 'start': launcher.start,
                        '2': launcher.stop, 'stop': launcher.stop,
                        '3': launcher.restart, 'restart': launcher.restart,
                        '4': launcher.open_browser, 'open': launcher.open_browser,
                        '5': launcher.status, 'status': launcher.status}
            if action in ('6', 'logs'):
                print('\n' + launcher.logs())
                input('\nPress Enter to return to controls...')
                message = 'Server logs are saved in work/server.log.'
            else:
                message = commands[action]() if action in commands else 'Choose 0 through 6, or type start / stop / restart / open / status / logs.'
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        print(launcher.stop())


if __name__ == '__main__':
    main()
