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
        orders = mt.orders_get()
        if rates is None or tick is None or positions is None or orders is None:
            raise ValueError('Market data or positions unavailable. Check MT5 connection.')
        self.bridge.check()
        fields = ('ticket', 'symbol', 'type', 'volume', 'price_open', 'price_current', 'sl', 'tp', 'profit')
        return dict(bars=bars, interval_note=note,
                    bid=tick.bid, ask=tick.ask, quote_time=tick.time, digits=info.digits,
                    tick_size=info.trade_tick_size,stops_distance=info.trade_stops_level*info.point,
                    volume_min=info.volume_min, volume_max=info.volume_max, volume_step=info.volume_step,
                    balance=account.balance, equity=account.equity, margin_free=account.margin_free,
                    currency=account.currency, account=str(account.login), server=account.server,
                    demo=account.trade_mode == mt.ACCOUNT_TRADE_MODE_DEMO,
                    orders=[dict(ticket=str(o.ticket),symbol=o.symbol,type=o.type,volume=o.volume_current,
                                 price=o.price_open,sl=o.sl,tp=o.tp) for o in orders],
                    positions=[{k: str(getattr(p,k)) if k == 'ticket' else getattr(p,k) for k in fields} for p in positions])

    def plan(self, body):
        """Estimate a hypothetical position; never validates or sends an order."""
        mt,account=self.connection()
        symbol,side=str(body.get('symbol','')),body.get('side')
        info,tick=mt.symbol_info(symbol),mt.symbol_info_tick(symbol)
        if info is None or tick is None or side not in ('BUY','SELL'):
            raise ValueError('Select a valid broker symbol and side.')
        volume,entry,stop,target=[float(body.get(k) or 0) for k in ('volume','entry','stop','target')]
        if not all(math.isfinite(v) and v>0 for v in (volume,entry,stop,target)):
            raise ValueError('Enter positive finite prices and lot volume.')
        direction=1 if side=='BUY' else -1
        if direction*(entry-stop)<=0 or direction*(target-entry)<=0:
            raise ValueError('Stop and target must be on opposite sides of entry.')
        if not info.volume_min<=volume<=info.volume_max or abs(volume/info.volume_step-round(volume/info.volume_step))>1e-7:
            raise ValueError(f'Choose {info.volume_min}–{info.volume_max} lots in steps of {info.volume_step}.')
        action=mt.ORDER_TYPE_BUY if side=='BUY' else mt.ORDER_TYPE_SELL
        risk=mt.order_calc_profit(action,symbol,volume,entry,stop)
        reward=mt.order_calc_profit(action,symbol,volume,entry,target)
        quote=tick.bid if side=='BUY' else tick.ask
        mark=mt.order_calc_profit(action,symbol,volume,entry,quote) if math.isfinite(quote) and quote>0 else None
        if risk is None or reward is None or not math.isfinite(risk) or not math.isfinite(reward):
            raise ValueError('Broker profit calculation unavailable for this plan.')
        self.bridge.check()
        return dict(account=str(account.login),server=account.server,currency=account.currency,risk=abs(risk),reward=reward,
                    mark_to_market=mark if mark is not None and math.isfinite(mark) else None,quote_time=tick.time,
                    note='Hypothetical gross estimate; excludes commission, swap and slippage. This is not an open position.')

    def request(self, body, position=None, pending_order=None):
        if body.get('operation') == 'close':
            return self.close_request(body)
        if body.get('operation') == 'cancel':
            return self.cancel_request(body)
        if body.get('operation') == 'modify':
            return self.modify_request(body)
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
        kind=body.get('order_kind','MARKET')
        if kind not in ('MARKET','PENDING','LIMIT','STOP') or (position is not None and kind!='MARKET'):
            raise ValueError('Choose Market or Pending.')
        pending=kind!='MARKET'
        price=float(body.get('price') or 0) if pending else tick.ask if side=='BUY' else tick.bid
        if pending:
            if not math.isfinite(price) or price<=0 or abs(price/info.trade_tick_size-round(price/info.trade_tick_size))>1e-6:
                raise ValueError('Pending entry must be a positive price aligned with the broker tick size.')
            quote=tick.ask if side=='BUY' else tick.bid
            if kind=='PENDING':
                if price==quote:raise ValueError('Pending entry must be above or below the current quote.')
                kind='LIMIT' if (side=='BUY' and price<quote) or (side=='SELL' and price>quote) else 'STOP'
            below=(side=='BUY' and kind=='LIMIT') or (side=='SELL' and kind=='STOP')
            gap=quote-price if below else price-quote
            if gap<=0 or gap+info.trade_tick_size*1e-6<distance:
                raise ValueError(f'{side} {kind} entry must be {"below" if below else "above"} the current {"ask" if side=="BUY" else "bid"}, respecting broker stop distance.')
        reference = price if pending else tick.bid if side == 'BUY' else tick.ask
        if side == 'BUY' and ((sl and sl >= reference-distance) or (tp and tp <= reference+distance)):
            raise ValueError('Buy SL must be below bid and TP above bid, respecting broker stop distance.')
        if side == 'SELL' and ((sl and sl <= reference+distance) or (tp and tp >= reference-distance)):
            raise ValueError('Sell SL must be above ask and TP below ask, respecting broker stop distance.')
        filling = mt.ORDER_FILLING_FOK if info.filling_mode & 1 else mt.ORDER_FILLING_IOC if info.filling_mode & 2 else mt.ORDER_FILLING_RETURN
        order_type=getattr(mt,'ORDER_TYPE_'+side+'_'+kind) if pending else mt.ORDER_TYPE_BUY if side=='BUY' else mt.ORDER_TYPE_SELL
        request = dict(action=mt.TRADE_ACTION_PENDING if pending else mt.TRADE_ACTION_DEAL, symbol=symbol, volume=volume,
                       type=order_type,price=price, sl=sl, tp=tp, deviation=20,
                       type_time=mt.ORDER_TIME_GTC, type_filling=mt.ORDER_FILLING_RETURN if pending else filling, comment='TradeTrace demo close' if position is not None else 'TradeTrace demo')
        if position is not None:request['position']=position
        if pending_order is not None:
            request=dict(action=mt.TRADE_ACTION_MODIFY,order=pending_order.ticket,symbol=symbol,price=price,sl=sl,tp=tp,
                         type_time=pending_order.type_time,expiration=pending_order.time_expiration)
        checked = mt.order_check(request)
        if checked is None or checked.retcode != 0:
            raise ValueError('Broker order check failed: ' + (checked.comment if checked else str(mt.last_error())))
        return request, account

    def close_request(self, body):
        mt,account=self.connection(trading=True)
        ticket=str(body.get('position',''))
        if not ticket.isdigit() or not 0<int(ticket)<2**64:
            raise ValueError('Invalid position ticket.')
        positions=mt.positions_get(ticket=int(ticket))
        if positions is None:
            raise ValueError('Cannot read the position. Check MT5 before retrying.')
        position=next((p for p in positions if p.ticket==int(ticket)),None)
        if position is None:
            raise ValueError('This position is no longer open.')
        if position.type not in (mt.POSITION_TYPE_BUY,mt.POSITION_TYPE_SELL):
            raise ValueError('Unsupported position type.')
        if not mt.symbol_select(position.symbol,True):
            raise ValueError('Cannot load the position symbol.')
        # Closing a hedged position must name its exact ticket; an opposite order
        # without this field could open a second position instead.
        return self.request(dict(symbol=position.symbol,
            side='SELL' if position.type==mt.POSITION_TYPE_BUY else 'BUY',volume=position.volume),position=position.ticket)

    def close_preview(self, body):
        return self.preview(dict(operation='close',position=str(body.get('position',''))))

    def cancel_request(self, body):
        mt,account=self.connection(trading=True)
        ticket=str(body.get('order',''))
        if not ticket.isdigit() or not 0<int(ticket)<2**64:raise ValueError('Invalid pending order ticket.')
        orders=mt.orders_get(ticket=int(ticket))
        if orders is None:raise ValueError('Cannot read pending orders. Check MT5 before retrying.')
        order=next((o for o in orders if o.ticket==int(ticket)),None)
        if order is None:raise ValueError('This order is no longer pending. It may have filled; check positions.')
        allowed=(mt.ORDER_TYPE_BUY_LIMIT,mt.ORDER_TYPE_SELL_LIMIT,mt.ORDER_TYPE_BUY_STOP,mt.ORDER_TYPE_SELL_STOP)
        if order.type not in allowed:raise ValueError('Unsupported pending order type.')
        request=dict(action=mt.TRADE_ACTION_REMOVE,order=order.ticket,symbol=order.symbol)
        checked=mt.order_check(request)
        if checked is None or checked.retcode!=0:raise ValueError('Broker cancellation check failed: '+(checked.comment if checked else str(mt.last_error())))
        return request,account

    def cancel_preview(self, body):
        return self.preview(dict(operation='cancel',order=str(body.get('order',''))))

    def modify_request(self, body):
        mt,account=self.connection(trading=True)
        ticket=str(body.get('order',''))
        if not ticket.isdigit() or not 0<int(ticket)<2**64:raise ValueError('Invalid pending order ticket.')
        orders=mt.orders_get(ticket=int(ticket))
        if orders is None:raise ValueError('Cannot read pending order. Check MT5.')
        order=next((o for o in orders if o.ticket==int(ticket)),None)
        if order is None:raise ValueError('Order is no longer pending. Check open positions.')
        kinds={mt.ORDER_TYPE_BUY_LIMIT:('BUY','LIMIT'),mt.ORDER_TYPE_SELL_LIMIT:('SELL','LIMIT'),
               mt.ORDER_TYPE_BUY_STOP:('BUY','STOP'),mt.ORDER_TYPE_SELL_STOP:('SELL','STOP')}
        if order.type not in kinds:raise ValueError('This pending order type cannot be edited here.')
        snapshot={k:getattr(order,k) for k in ('symbol','type','volume_current','price_open','sl','tp','type_time','time_expiration')}
        if 'expected' in body and body['expected']!=snapshot:raise ValueError('Pending order changed since review. Review the current order again.')
        body['expected']=snapshot
        side,kind=kinds[order.type]
        # Keep its broker order type. Crossing the quote requires a new order,
        # rather than silently cancelling and replacing an existing order.
        return self.request(dict(symbol=order.symbol,side=side,order_kind=kind,price=body.get('price'),
                                 sl=body.get('sl',order.sl),tp=body.get('tp',order.tp),volume=order.volume_current),pending_order=order)

    def modify_preview(self, body):
        return self.preview(dict(operation='modify',order=str(body.get('order','')),price=body.get('price'),
                                 sl=body.get('sl',0),tp=body.get('tp',0)))

    def preview(self, body):
        request, account = self.request(body)
        resolved_kind=body.get('order_kind','MARKET')
        if resolved_kind=='PENDING':
            mt=self.bridge.mt
            resolved_kind='LIMIT' if request['type'] in (mt.ORDER_TYPE_BUY_LIMIT,mt.ORDER_TYPE_SELL_LIMIT) else 'STOP'
            body={**body,'order_kind':resolved_kind}
        now = time.monotonic()
        self.previews = {k:v for k,v in self.previews.items() if v['expires'] > now}
        if len(self.previews) >= 100:
            raise ValueError('Too many previews. Wait a minute.')
        key = secrets.token_urlsafe(24)
        self.previews[key] = dict(body=dict(body), request=dict(request), account=account.login, server=account.server, expires=now+60)
        return dict(preview=key, request=request, order_kind=resolved_kind, account=str(account.login), server=account.server, expires_in=60)

    def submit(self, body):
        preview = self.previews.pop(str(body.get('preview', '')), None)
        if not preview or preview['expires'] < time.monotonic():
            raise ValueError('Preview expired or already used. Review a new order.')
        request, account = self.request(preview['body'])
        if (account.login, account.server) != (preview['account'], preview['server']):
            raise ValueError('Account changed. Review a new order.')
        closing=preview['body'].get('operation')=='close'
        if closing and any(request.get(field)!=preview['request'].get(field) for field in ('position','symbol','type','volume')):
            raise ValueError('Position changed since review. Review the remaining position again.')
        result = self.bridge.mt.order_send(request)
        if result is None:
            raise ValueError('Execution outcome unknown. Check MT5 positions and history before placing another order.')
        remaining=None
        if closing:
            try:
                positions=self.bridge.mt.positions_get(ticket=request['position'])
                if positions is not None:remaining=sum(p.volume for p in positions if p.ticket==request['position'])
            except Exception:
                pass # A failed refresh must never conceal a completed send.
        operation='close' if closing else 'modify' if preview['body'].get('operation')=='modify' else 'cancel' if preview['body'].get('operation')=='cancel' else 'pending' if preview['body'].get('order_kind','MARKET')!='MARKET' else 'open'
        return dict(retcode=result.retcode, comment=result.comment, order=str(result.order), deal=str(result.deal),
                    operation=operation,remaining_volume=remaining,
                    price=result.price, volume=result.volume,
                    message='Check MT5 positions/history for final execution status. Do not automatically retry.')
