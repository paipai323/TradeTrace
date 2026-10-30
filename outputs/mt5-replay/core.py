"""Read-only MT5 history reconstruction. No trading operations."""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
import ctypes
import json
import os
import subprocess


def running_terminal_path(requested=''):
    """Do not let initialize auto-select an installation that isn't running."""
    if os.name != 'nt':
        raise ValueError('Live MT5 connections require Windows.')
    from ctypes import wintypes
    token = wintypes.HANDLE()
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    security = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    security.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    security.IsTokenRestricted.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    if not security.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
        raise ValueError('Cannot verify Windows permissions. Start the replay using Start.cmd in File Explorer.')
    try:
        if security.IsTokenRestricted(token):
            raise ValueError('Replay is running with restricted Windows permissions. Close its console and double-click Start.cmd in File Explorer before connecting.')
    finally:
        kernel.CloseHandle(token)
    command = "@(Get-Process -Name terminal64 -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Where-Object { $_ } | Select-Object -Unique) | ConvertTo-Json -Compress"
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
            capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise ValueError('Cannot inspect running MT5 terminals. Run MT5 and replay as the same Windows user.')
        paths = json.loads(result.stdout.strip() or '[]')
        if isinstance(paths, str):
            paths = [paths]
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        raise ValueError('Cannot inspect running MT5 terminals. Open MT5 normally, then run Start.cmd yourself.')
    requested = requested.strip().strip('"')
    if requested:
        matches = [p for p in paths if os.path.normcase(os.path.abspath(p)) == os.path.normcase(os.path.abspath(requested))]
        if not matches:
            raise ValueError('That terminal is not visible as a running MT5. In Task Manager, right-click the signed-in terminal64.exe and choose Open file location to confirm its executable path. Run both apps as the same Windows user.')
        return matches[0]
    if len(paths) != 1:
        raise ValueError('Open exactly one MT5 installation and sign in, or enter the executable path of the running terminal.')
    return paths[0]


def closed_positions(deals):
    groups = defaultdict(list)
    for d in deals:
        if d.type in (0, 1) and d.position_id:
            groups[d.position_id].append(d)
    result, skipped = [], 0
    for pid, rows in groups.items():
        rows.sort(key=lambda d: (d.time_msc, d.ticket))
        ins = [d for d in rows if d.entry == 0]
        outs = [d for d in rows if d.entry in (1, 3)]
        # V1 deliberately excludes scale-ins, partial closes and reversals.
        if (len(ins) != 1 or len(outs) != 1 or len(rows) != 2
                or abs(ins[0].volume - outs[0].volume) > 1e-8
                or ins[0].type == outs[0].type):
            skipped += 1
            continue
        a, b = ins[0], outs[0]
        result.append(dict(id=str(pid), symbol=a.symbol, side='BUY' if a.type == 0 else 'SELL',
            volume=a.volume, start=a.time_msc, end=b.time_msc, entry=a.price, exit=b.price,
            reason={4: 'Stop loss', 5: 'Take profit', 6: 'Stop out'}.get(b.reason, 'Other closure'),
            net=round(sum(d.profit + d.commission + d.swap + getattr(d, 'fee', 0) for d in rows), 2),
            order=b.order))
    return sorted(result, key=lambda p: p['end'], reverse=True), skipped


def utc(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


class Bridge:
    def __init__(self):
        self.mt = None
        self.trades = {}

    def connect(self, path=''):
        path = running_terminal_path(path)
        try:
            import MetaTrader5 as mt
        except ImportError:
            raise ValueError('MT5 connector is missing. Run Install.cmd, then restart the app.')
        if self.mt:
            self.mt.shutdown()
        self.mt = None
        self.trades = {}
        ok = mt.initialize(path, timeout=15000)
        if not ok:
            raise ValueError(f'Cannot connect to MT5: {mt.last_error()}. Open MT5 and sign in first.')
        account = mt.account_info()
        terminal = mt.terminal_info()
        if account is None or not account.login or terminal is None or not terminal.connected:
            mt.shutdown()
            raise ValueError('MT5 has no signed-in account.')
        self.mt = mt
        self.account = account.login
        return dict(currency=account.currency, server=account.server, account=str(account.login))

    def check(self):
        if not self.mt:
            raise ValueError('Connect to MT5 first.')
        info = self.mt.account_info()
        if info is None or info.login != self.account:
            self.trades = {}
            raise ValueError('MT5 account changed or disconnected. Reconnect and load trades again.')

    def history(self, start, end):
        self.check()
        # Query all available entries so a position opened before the selected period is retained.
        rows = self.mt.history_deals_get(datetime(2000, 1, 1, tzinfo=timezone.utc), end)
        if rows is None:
            raise ValueError(f'History unavailable: {self.mt.last_error()}')
        trades, skipped = closed_positions(rows)
        trades = [t for t in trades if start.timestamp()*1000 <= t['end'] < end.timestamp()*1000]
        self.trades = {t['id']: t for t in trades}
        return dict(trades=trades, skipped=skipped)

    def replay(self, pid):
        self.check()
        if pid not in self.trades:
            raise ValueError('Load trades again and select a position.')
        trade = self.trades[pid].copy()
        mt = self.mt
        if trade['end'] - trade['start'] > 7 * 86400000:
            raise ValueError('This version supports positions lasting up to 7 days.')
        if not mt.symbol_select(trade['symbol'], True):
            raise ValueError('Symbol is unavailable in this terminal.')
        orders = mt.history_orders_get(ticket=trade['order'])
        trade.update(sl=orders[0].sl if orders else 0, tp=orders[0].tp if orders else 0)
        points = []
        cursor, end = utc(trade['start']), utc(trade['end'])
        while cursor <= end:
            stop = min(cursor + timedelta(hours=1), end)
            ticks = mt.copy_ticks_range(trade['symbol'], cursor, stop, mt.COPY_TICKS_ALL)
            if ticks is not None:
                for t in ticks:
                    ts = int(t['time_msc'])
                    bid, ask = float(t['bid']), float(t['ask'])
                    if trade['start'] <= ts <= trade['end'] and bid > 0 and ask > 0:
                        point = [ts, bid, ask]
                        if not points or point != points[-1]:
                            points.append(point)
            if len(points) > 500000:
                raise ValueError('More than 500,000 ticks. This position is too large for this version.')
            if stop == end:
                break
            cursor = stop
        points.sort(key=lambda p: p[0])
        if not points:
            raise ValueError('No historical bid/ask ticks available. Replay cannot be reconstructed from this broker.')
        warnings = ['SL/TP lines are the closing order’s recorded levels; past modifications cannot be reconstructed. Floating movement is shown in price units, not account currency.']
        if points[0][0] - trade['start'] > 5000 or trade['end'] - points[-1][0] > 5000:
            warnings.append('Tick coverage does not reach within 5 seconds of entry or exit.')
        gaps = sum(b[0] - a[0] > 60000 for a, b in zip(points, points[1:]))
        if gaps:
            warnings.append(f'{gaps} gaps over 60 seconds; these may include closed market hours or missing ticks.')
        return dict(trade=trade, points=points, warnings=warnings, source='Broker historical ticks • coverage not guaranteed')
