"""Read-only MT5 history reconstruction. No trading operations."""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
import ctypes
import json
import os
import subprocess
import re
import math
import time
from native_history import NativeHistory, objects


def recorded_levels(trade, closing_orders, entry_orders, exit_deals):
    """Recover explicit recorded levels, never substitute an execution price."""
    result = {}
    for level in ('sl', 'tp'):
        result[level] = 0
        result[level + '_source'] = 'not recorded'
        for records, source in [(exit_deals, 'exit deal'), (closing_orders, 'closing order')]:
            for record in records:
                value = float(getattr(record, level, 0) or 0)
                if value > 0 and math.isfinite(value):
                    result[level], result[level + '_source'] = value, source
                    break
            if result[level]:
                break
        # Brokers may preserve the trigger in an explicit [sl 123.45] / [tp 123.45]
        # comment even when the Python order SL/TP fields are zero.
        reason = trade.get('reason_code')
        if not result[level] and reason == (4 if level == 'sl' else 5):
            for record in list(exit_deals) + list(closing_orders):
                comment = getattr(record, 'comment', '') or ''
                match = re.fullmatch(r'\s*\[' + level + r'\s+([0-9]+(?:\.[0-9]+)?)\]\s*', comment, re.I)
                if match:
                    value = float(match[1])
                    if value > 0 and math.isfinite(value):
                        result[level], result[level + '_source'] = value, 'broker exit comment'
                        break
        if not result[level]:
            for record in entry_orders:
                value = float(getattr(record, level, 0) or 0)
                if value > 0 and math.isfinite(value):
                    result[level], result[level + '_source'] = value, 'entry order reference'
                    break
        if not result[level] and trade.get('reason_code') == (4 if level == 'sl' else 5):
            result[level + '_source'] = 'trigger confirmed; exact price unavailable'
    return result


def running_terminals():
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
    return paths


def running_terminal_path(requested=''):
    paths = running_terminals()
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
            reason={0: 'Desktop terminal closure', 1: 'Mobile app closure', 2: 'Web platform closure',
                3: 'EA / script closure', 4: 'Stop loss', 5: 'Take profit', 6: 'Stop out',
                7: 'Rollover', 8: 'Variation margin', 9: 'Instrument split',
                10: 'Corporate action'}.get(b.reason, f'Unknown exit reason (code {b.reason})'),
            reason_code=b.reason,
            net=round(sum(d.profit + d.commission + d.swap + getattr(d, 'fee', 0) for d in rows), 2),
            order=b.order, entry_order=a.order, exit_ticket=str(b.ticket)))
    return sorted(result, key=lambda p: p['end'], reverse=True), skipped


def utc(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


class Bridge:
    def __init__(self):
        self.mt = None
        self.trades = {}
        self.stage = 'terminal'
        self.native_levels = {}
        self.direct = None
        self.direct_synced = 0

    def connect(self, path=''):
        self.stage = 'terminal'
        path = running_terminal_path(path)
        self.stage = 'connector'
        try:
            import MetaTrader5 as mt
        except ImportError:
            raise ValueError('MT5 connector is missing. Run Install.cmd, then restart the app.')
        if self.mt:
            self.mt.shutdown()
        self.mt = None
        self.trades = {}
        self.native_levels = {}
        self.direct = None
        self.direct_synced = 0
        ok = mt.initialize(path, timeout=15000)
        if not ok:
            raise ValueError(f'Cannot connect to MT5: {mt.last_error()}. Open MT5 and sign in first.')
        self.stage = 'account'
        account = mt.account_info()
        terminal = mt.terminal_info()
        if account is None or not account.login or terminal is None or not terminal.connected:
            mt.shutdown()
            raise ValueError('MT5 has no signed-in account.')
        self.mt = mt
        self.account = account.login
        self.server = account.server
        return dict(currency=account.currency, server=account.server, account=str(account.login), path=path)

    def check(self):
        if not self.mt:
            raise ValueError('Connect to MT5 first.')
        info = self.mt.account_info()
        if info is None or info.login != self.account or (hasattr(self, 'server') and getattr(info, 'server', self.server) != self.server):
            self.trades = {}
            raise ValueError('MT5 account changed or disconnected. Reconnect and load trades again.')

    def history(self, start, end):
        self.stage = 'account'
        self.check()
        self.stage = 'history'
        # Query all available entries so a position opened before the selected period is retained.
        rows = self.mt.history_deals_get(datetime(2000, 1, 1, tzinfo=timezone.utc), end)
        if rows is None:
            raise ValueError(f'History unavailable: {self.mt.last_error()}')
        trades, skipped = closed_positions(rows)
        trades = [t for t in trades if start.timestamp()*1000 <= t['end'] < end.timestamp()*1000]
        self.trades = {t['id']: t for t in trades}
        self.direct_synced = 0
        self.sync_levels()
        return dict(trades=trades, skipped=skipped)

    def replay(self, pid, context_minutes=60):
        self.stage = 'account'
        self.check()
        self.stage = 'ticks'
        if context_minutes not in (15, 30, 60, 240):
            raise ValueError('Choose 15, 30, 60 or 240 minutes of context.')
        if pid not in self.trades:
            raise ValueError('Load trades again and select a position.')
        trade = self.trades[pid].copy()
        mt = self.mt
        if trade['end'] - trade['start'] > 7 * 86400000:
            raise ValueError('This version supports positions lasting up to 7 days.')
        if not mt.symbol_select(trade['symbol'], True):
            raise ValueError('Symbol is unavailable in this terminal.')
        orders = mt.history_orders_get(ticket=trade['order']) or ()
        entry_orders = ()
        if trade.get('entry_order'):
            entry_orders = mt.history_orders_get(ticket=trade['entry_order']) or ()
        deals = mt.history_deals_get(position=int(pid)) or ()
        exits = [d for d in deals if d.entry in (1, 3) and d.order == trade['order']]
        trade.update(recorded_levels(trade, orders, entry_orders, exits))
        self.sync_levels()
        native = self.native_levels.get((pid, str(trade['order']), str(trade['end'])))
        if native:
            for level in native:
                trade[level] = native[level]
                trade[level + '_source'] = 'direct MT5 position history' if native[level] else 'not set at close (direct MT5)'
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
        warnings = ['SL/TP lines prefer direct native MT5 position levels, then explicit Python fields, recognized broker trigger comments, or entry-order references. Sources are labeled above. Historical changes cannot be reconstructed, so these are reference lines throughout replay. Floating movement is in price units, not account currency.']
        if points[0][0] - trade['start'] > 5000 or trade['end'] - points[-1][0] > 5000:
            warnings.append('Tick coverage does not reach within 5 seconds of entry or exit.')
        gaps = sum(b[0] - a[0] > 60000 for a, b in zip(points, points[1:]))
        if gaps:
            warnings.append(f'{gaps} gaps over 60 seconds; these may include closed market hours or missing ticks.')
        context_start = max(0, trade['start'] - context_minutes * 60000)
        context = []
        rates = mt.copy_rates_range(trade['symbol'], mt.TIMEFRAME_M1, utc(context_start), utc(trade['start']))
        if rates is not None:
            for bar in rates:
                ms = int(bar['time']) * 1000
                # Only completed pre-entry candles: never reveal post-entry OHLC.
                if context_start <= ms and ms + 60000 <= trade['start']:
                    context.append([ms, float(bar['open']), float(bar['high']), float(bar['low']), float(bar['close'])])
        context.sort(key=lambda b: b[0])
        if not context:
            warnings.append('No completed M1 candles available for the requested pre-entry context.')
        elif context[0][0] - context_start > 60000:
            warnings.append('Pre-entry candle coverage starts later than requested; market hours or missing history may explain the gap.')
        return dict(trade=trade, points=points, context=context, context_start=context_start,
            warnings=warnings, source='Broker historical ticks + pre-entry M1 candles; coverage not guaranteed')

    def connect_native(self, url, key):
        self.stage = 'account'
        self.check()
        self.stage = 'levels'
        client = NativeHistory(url, key)
        client.verify_account(self.account, self.server)
        self.direct = client
        self.direct_synced = 0
        return self.sync_levels(force=True)

    def sync_levels(self, force=False):
        if not self.direct:
            return dict(state='setup', message='Connect the built-in MT5 local API for historical SL/TP. No EA, script or export is needed.', levels=[])
        if not self.trades:
            return dict(state='connected', message='Direct MT5 API connected. Load trade history to retrieve SL/TP.', levels=[])
        if force or time.monotonic() - self.direct_synced > 30:
            try:
                self.direct.verify_account(self.account, self.server)
                start = utc(min(t['start'] for t in self.trades.values())) - timedelta(days=1)
                end = utc(max(t['end'] for t in self.trades.values())) + timedelta(days=1)
                payload = self.direct.positions(start, end)
                pending = {}
                for row in objects(payload):
                    pid = row.get('position_id', row.get('position', row.get('identifier', row.get('ticket'))))
                    trade = self.trades.get(str(pid))
                    if not trade or row.get('symbol') != trade['symbol']:
                        continue
                    opening = row.get('price_open', row.get('open_price', row.get('entry_price')))
                    if opening is None or abs(float(opening) - trade['entry']) > max(1e-7, abs(trade['entry'])*1e-9):
                        continue
                    levels = {}
                    for key, aliases in [('sl', ('sl','stop_loss','stoploss')), ('tp', ('tp','take_profit','takeprofit'))]:
                        field = next((alias for alias in aliases if alias in row), None)
                        if field is not None and row[field] is not None:
                            value = float(row[field])
                            if not math.isfinite(value) or value < 0:
                                raise ValueError('MT5 returned an invalid historical level.')
                            levels[key] = value
                    if levels:
                        identity = (str(pid), str(trade['order']), str(trade['end']))
                        if identity in pending and pending[identity] != levels:
                            raise ValueError('MT5 returned conflicting position levels. No levels changed.')
                        pending[identity] = levels
                if not pending:
                    raise ValueError('The direct API returned no matching positions with SL/TP fields. This response format needs verification; no levels were invented or changed.')
                self.native_levels = pending
                self.direct_synced = time.monotonic()
            except (ValueError, OSError, TypeError) as error:
                return dict(state='waiting', message=str(error), levels=[])
        levels = []
        for pid, trade in self.trades.items():
            native = self.native_levels.get((pid, str(trade['order']), str(trade['end'])))
            if native is not None:
                levels.append(dict(id=pid, **native))
        return dict(state='active', levels=levels, message=f'Direct MT5 history: {len(levels)} positions matched. No EA or export.')

    def verify(self, pid):
        self.stage = 'account'
        self.check()
        self.stage = 'verification'
        if pid not in self.trades:
            raise ValueError('Reload history and select a position first.')
        rows = self.mt.history_deals_get(position=int(pid))
        if rows is None:
            raise ValueError('Cannot read the position’s execution records from MT5.')
        reconstructed, _ = closed_positions(rows)
        if len(reconstructed) != 1:
            raise ValueError('Position history has changed or is no longer supported. Reload history.')
        actual = reconstructed[0]
        fields = ['symbol', 'side', 'volume', 'start', 'end', 'entry', 'exit', 'reason', 'net']
        differences = [k for k in fields if actual[k] != self.trades[pid][k]]
        return dict(matches=not differences, differences=differences, position=actual,
            deals=[dict(ticket=str(d.ticket), time=d.time_msc, entry=d.entry, price=d.price,
                volume=d.volume, profit=d.profit, commission=d.commission, swap=d.swap,
                fee=getattr(d, 'fee', 0)) for d in sorted(rows, key=lambda d: (d.time_msc, d.ticket))
                if d.type in (0, 1)],
            note='Compared with a fresh read of MT5 execution history. This checks import consistency; compare the records below with MT5 History for independent confirmation.')
