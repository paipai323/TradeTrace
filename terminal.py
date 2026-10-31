"""Local market workspace and single-use, demo-only market order previews."""
import math
import secrets
import time
from datetime import datetime, timezone, timedelta
from timeframes import NATIVE, interval, aggregate


class Terminal:
    def __init__(self, bridge):
        self.bridge = bridge
        self.previews = {}

    def connection(self, trading=False):
        self.bridge.check()
        mt = self.bridge.mt
        account, terminal = mt.account_info(), mt.terminal_info()
        if account is None or terminal is None or not terminal.connected:
            raise ValueError('MT5 is disconnected.')
        if trading:
            if account.trade_mode != mt.ACCOUNT_TRADE_MODE_DEMO:
                raise ValueError('This release only submits orders on demo accounts.')
            if not account.trade_allowed or not account.trade_expert or not terminal.trade_allowed or terminal.tradeapi_disabled:
                raise ValueError('Enable trading and external Python trading in MT5 settings.')
        return mt, account

    def symbols(self):
        mt, account = self.connection()
        rows = mt.symbols_get()
        if rows is None:
            raise ValueError('Cannot load broker symbols.')
        return dict(symbols=sorted(s.name for s in rows), visible=[s.name for s in rows if s.visible], account=str(account.login), server=account.server,
                    currency=account.currency, demo=account.trade_mode == mt.ACCOUNT_TRADE_MODE_DEMO)

    def quotes(self, body):
        mt, account = self.connection()
        symbols = body.get('symbols', [])
        if not isinstance(symbols, list) or len(symbols) > 40 or not all(isinstance(s, str) and 0 < len(s) <= 128 for s in symbols):
            raise ValueError('Choose up to 40 broker symbols.')
        quotes = {}
        for symbol in dict.fromkeys(symbols):
            info = mt.symbol_info(symbol)
            if info is None:
                continue
            if not info.visible and not mt.symbol_select(symbol, True):
                continue
            tick = mt.symbol_info_tick(symbol)
            if tick is not None and 0 < tick.bid <= tick.ask and math.isfinite(tick.bid) and math.isfinite(tick.ask):
                quotes[symbol] = dict(bid=tick.bid, ask=tick.ask, time=tick.time)
        self.bridge.check()
        return dict(quotes=quotes, account=str(account.login), server=account.server)

    def market(self, body):
        mt, account = self.connection()
        symbol = str(body.get('symbol', ''))
        timeframe = body.get('timeframe', 'M5')
        unit,count = interval(timeframe)
        info = mt.symbol_info(symbol)
        if info is None or not mt.symbol_select(symbol, True):
            raise ValueError('Select an available broker symbol.')
        note = ''
        if unit == 'S':
            end=datetime.now(timezone.utc)
            rates=mt.copy_ticks_range(symbol,end-timedelta(minutes=20),end,mt.COPY_TICKS_INFO)
            bars=aggregate(rates,timeframe,ticks=True) if rates is not None else None
            note='Second candles use broker bid ticks from the last 20 minutes; intervals without ticks are omitted.'
        elif timeframe in NATIVE:
            rates=mt.copy_rates_from_pos(symbol,getattr(mt,'TIMEFRAME_'+timeframe),0,1000)
            bars=[[int(r['time'])*1000,float(r['open']),float(r['high']),float(r['low']),float(r['close']),int(r['tick_volume'])] for r in rates] if rates is not None else None
        else:
            source={'M':'M1','H':'H1','D':'D1','W':'W1','MN':'MN1'}[unit]
            rates=mt.copy_rates_from_pos(symbol,getattr(mt,'TIMEFRAME_'+source),0,min(60000,count*1001+count))
            bars=aggregate(rates,timeframe) if rates is not None else None
            note='Custom interval aggregated from broker '+source+' candles, aligned in UTC; history depends on MT5 coverage.'
        tick = mt.symbol_info_tick(symbol)
        positions = mt.positions_get()
        if rates is None or tick is None or positions is None:
            raise ValueError('Market data or positions unavailable. Check MT5 connection.')
        self.bridge.check()
        fields = ('ticket', 'symbol', 'type', 'volume', 'price_open', 'price_current', 'sl', 'tp', 'profit')
        return dict(bars=bars, interval_note=note,
                    bid=tick.bid, ask=tick.ask, quote_time=tick.time, digits=info.digits,
                    tick_size=info.trade_tick_size,
                    volume_min=info.volume_min, volume_max=info.volume_max, volume_step=info.volume_step,
                    balance=account.balance, equity=account.equity, margin_free=account.margin_free,
                    currency=account.currency, account=str(account.login), server=account.server,
                    demo=account.trade_mode == mt.ACCOUNT_TRADE_MODE_DEMO,
                    positions=[{k: str(getattr(p,k)) if k == 'ticket' else getattr(p,k) for k in fields} for p in positions])

    def request(self, body):
        mt, account = self.connection(trading=True)
        symbol, side = str(body.get('symbol', '')), body.get('side')
        info, tick = mt.symbol_info(symbol), mt.symbol_info_tick(symbol)
        if info is None or tick is None or side not in ('BUY', 'SELL'):
            raise ValueError('Select a valid symbol and side.')
        if time.time() - tick.time > 30 or tick.time > time.time() + 5 or not (0 < tick.bid <= tick.ask):
            raise ValueError('Quote is stale or invalid. Wait for a fresh market quote.')
        volume, sl, tp = [float(body.get(k) or 0) for k in ('volume', 'sl', 'tp')]
        if not all(math.isfinite(v) for v in (volume, sl, tp)) or min(sl, tp) < 0:
            raise ValueError('Enter finite, positive prices and volume.')
        if not info.volume_min <= volume <= info.volume_max or abs(volume/info.volume_step-round(volume/info.volume_step)) > 1e-7:
            raise ValueError(f'Volume must be {info.volume_min}–{info.volume_max} lots in steps of {info.volume_step}.')
        for value in (sl, tp):
            if value and abs(value/info.trade_tick_size-round(value/info.trade_tick_size)) > 1e-6:
                raise ValueError('SL/TP must align with the symbol price tick size.')
        distance = info.trade_stops_level * info.point
        reference = tick.bid if side == 'BUY' else tick.ask
        if side == 'BUY' and ((sl and sl >= reference-distance) or (tp and tp <= reference+distance)):
            raise ValueError('Buy SL must be below bid and TP above bid, respecting broker stop distance.')
        if side == 'SELL' and ((sl and sl <= reference+distance) or (tp and tp >= reference-distance)):
            raise ValueError('Sell SL must be above ask and TP below ask, respecting broker stop distance.')
        filling = mt.ORDER_FILLING_FOK if info.filling_mode & 1 else mt.ORDER_FILLING_IOC if info.filling_mode & 2 else mt.ORDER_FILLING_RETURN
        request = dict(action=mt.TRADE_ACTION_DEAL, symbol=symbol, volume=volume,
                       type=mt.ORDER_TYPE_BUY if side == 'BUY' else mt.ORDER_TYPE_SELL,
                       price=tick.ask if side == 'BUY' else tick.bid, sl=sl, tp=tp, deviation=20,
                       type_time=mt.ORDER_TIME_GTC, type_filling=filling, comment='TradeTrace demo')
        checked = mt.order_check(request)
        if checked is None or checked.retcode != 0:
            raise ValueError('Broker order check failed: ' + (checked.comment if checked else str(mt.last_error())))
        return request, account

    def preview(self, body):
        request, account = self.request(body)
        now = time.monotonic()
        self.previews = {k:v for k,v in self.previews.items() if v['expires'] > now}
        if len(self.previews) >= 100:
            raise ValueError('Too many previews. Wait a minute.')
        key = secrets.token_urlsafe(24)
        self.previews[key] = dict(body=dict(body), account=account.login, server=account.server, expires=now+60)
        return dict(preview=key, request=request, account=str(account.login), server=account.server, expires_in=60)

    def submit(self, body):
        preview = self.previews.pop(str(body.get('preview', '')), None)
        if not preview or preview['expires'] < time.monotonic():
            raise ValueError('Preview expired or already used. Review a new order.')
        request, account = self.request(preview['body'])
        if (account.login, account.server) != (preview['account'], preview['server']):
            raise ValueError('Account changed. Review a new order.')
        result = self.bridge.mt.order_send(request)
        if result is None:
            raise ValueError('Execution outcome unknown. Check MT5 positions and history before placing another order.')
        return dict(retcode=result.retcode, comment=result.comment, order=str(result.order), deal=str(result.deal),
                    price=result.price, volume=result.volume,
                    message='Check MT5 positions/history for final execution status. Do not automatically retry.')
