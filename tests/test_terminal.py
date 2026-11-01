import time
import unittest
from types import SimpleNamespace as Row
from unittest.mock import Mock
from terminal import Terminal


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.account = Row(login=123, server='Demo', currency='USD', trade_mode=0, trade_allowed=True, trade_expert=True)
        self.mt = Mock(ACCOUNT_TRADE_MODE_DEMO=0, ORDER_FILLING_FOK=0, ORDER_FILLING_IOC=1,
                       ORDER_FILLING_RETURN=2, TRADE_ACTION_DEAL=1, ORDER_TYPE_BUY=0,
                       ORDER_TYPE_SELL=1, ORDER_TIME_GTC=0, POSITION_TYPE_BUY=0, POSITION_TYPE_SELL=1)
        self.mt.account_info.return_value = self.account
        self.mt.terminal_info.return_value = Row(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.mt.symbol_info.return_value = Row(volume_min=.01, volume_max=10, volume_step=.01,
            trade_tick_size=.00001, trade_stops_level=10, point=.00001, filling_mode=2)
        self.tick = Row(time=time.time(), bid=1.1, ask=1.1001)
        self.mt.symbol_info_tick.return_value = self.tick
        self.mt.order_check.return_value = Row(retcode=0, comment='Done')
        self.mt.orders_get.return_value=[]
        self.mt.TRADE_ACTION_PENDING=5;self.mt.TRADE_ACTION_REMOVE=8
        self.mt.TRADE_ACTION_MODIFY=7
        self.mt.ORDER_TYPE_BUY_LIMIT=2;self.mt.ORDER_TYPE_SELL_LIMIT=3
        self.mt.ORDER_TYPE_BUY_STOP=4;self.mt.ORDER_TYPE_SELL_STOP=5
        self.mt.order_send.return_value = Row(retcode=10009,comment='Done',order=42,deal=43,price=1.1001,volume=.01)
        self.terminal = Terminal(Row(mt=self.mt, check=Mock()))
        self.body = dict(symbol='EURUSD',side='BUY',volume=.01,sl=1.09,tp=1.12)

    def test_preview_never_sends_and_single_use_submission(self):
        p=self.terminal.preview(self.body)
        self.mt.order_send.assert_not_called()
        self.assertEqual(self.terminal.submit(p)['deal'],'43')
        with self.assertRaises(ValueError): self.terminal.submit(p)
        self.mt.order_send.assert_called_once()

    def test_draft_estimates_signed_optional_levels_without_trading(self):
        for side in ('BUY','SELL'):
            self.mt.order_calc_profit.side_effect=[-12.5,25]
            result=self.terminal.estimate(dict(symbol='EURUSD',side=side,volume=.01,entry=1.1,sl=1.09,tp=1.12))
            self.assertEqual((result['sl'],result['tp'],result['currency']),(-12.5,25,'USD'))
            self.assertEqual(self.mt.order_calc_profit.call_args.args,(0 if side=='BUY' else 1,'EURUSD',.01,1.1,1.12))
        self.mt.order_calc_profit.side_effect=None;self.mt.order_calc_profit.return_value=7.5
        result=self.terminal.estimate(dict(symbol='EURUSD',side='BUY',volume=.01,entry=1.1,sl=1.105))
        self.assertEqual((result['sl'],result['tp']),(7.5,None))
        self.mt.order_send.assert_not_called();self.mt.order_check.assert_not_called()

    def test_closed_history_includes_older_entry_and_all_linked_costs(self):
        now=time.time()*1000
        def deal(ticket,entry,side,when,**values):
            return Row(**{**dict(ticket=ticket,position_id=42,type=side,entry=entry,time_msc=when,volume=.1,
                symbol='EURUSD',price=1.1,reason=0,order=ticket,profit=0,commission=-.5,swap=0,fee=0),**values})
        self.mt.history_deals_get.return_value=[deal(1,0,0,now-45*86400000),deal(2,1,1,now,profit=10,swap=-1,fee=-.2)]
        result=self.terminal.closed({})
        self.assertEqual(len(result['positions']),1)
        self.assertEqual(result['positions'][0]['net'],7.8)
        self.assertEqual(self.mt.history_deals_get.call_args.args[0].year,2000)
        self.mt.order_send.assert_not_called()

    def test_closed_history_failure_is_not_reported_as_empty(self):
        self.mt.history_deals_get.return_value=None
        with self.assertRaisesRegex(ValueError,'Cannot read'):self.terminal.closed({})

    def test_draft_estimates_reject_invalid_or_unavailable_values(self):
        body=dict(symbol='EURUSD',side='BUY',volume=.01,entry=1.1,sl=1.09)
        for change in [dict(entry=0),dict(volume=.015),dict(tp=-1),dict(sl=float('nan')),dict(side='invalid')]:
            with self.subTest(change=change),self.assertRaises(ValueError):self.terminal.estimate({**body,**change})
        self.mt.order_calc_profit.return_value=None
        with self.assertRaisesRegex(ValueError,'unavailable'):self.terminal.estimate(body)
        self.mt.order_send.assert_not_called()

    def position_fixture(self, side=0):
        self.mt.TRADE_ACTION_SLTP=6
        position=Row(ticket=42,symbol='EURUSD',volume=.1,type=side,price_open=1.09 if side==0 else 1.12,sl=0,tp=0)
        self.mt.positions_get.return_value=(position,)
        return position

    def test_position_protection_only_exact_ticket_and_profit_stops(self):
        for side,sl,tp in [(0,1.099,1.11),(1,1.101,1.09)]:
            self.position_fixture(side)
            self.mt.order_send.reset_mock()
            preview=self.terminal.position_preview(dict(position='42',sl=sl,tp=tp))
            self.assertEqual(preview['request'],dict(action=6,position=42,symbol='EURUSD',sl=sl,tp=tp))
            self.mt.order_send.assert_not_called()
            self.assertEqual(self.terminal.submit(preview)['operation'],'position-sltp')
            self.mt.order_send.assert_called_once_with(preview['request'])
            with self.assertRaises(ValueError):self.terminal.submit(preview)

    def test_position_protection_removal_and_concurrent_changes(self):
        for field,value in [('sl',1.09),('tp',1.12),('volume',.2),('type',1),('symbol','GBPUSD'),('price_open',1.08)]:
            position=self.position_fixture()
            preview=self.terminal.position_preview(dict(position='42',sl=0,tp=0))
            self.assertEqual(preview['request']['sl'],0)
            setattr(position,field,value)
            with self.assertRaisesRegex(ValueError,'changed'):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()

    def test_position_protection_revalidates_before_send(self):
        for failure in ['gone','stale','live','expired','broker']:
            self.account.trade_mode=0;self.tick.time=time.time();self.mt.order_check.return_value=Row(retcode=0)
            self.position_fixture()
            preview=self.terminal.position_preview(dict(position='42',sl=1.09,tp=1.12))
            if failure=='gone':self.mt.positions_get.return_value=()
            elif failure=='stale':self.tick.time=0
            elif failure=='live':self.account.trade_mode=2
            elif failure=='expired':self.terminal.previews[preview['preview']]['expires']=0
            else:self.mt.order_check.return_value=Row(retcode=10016,comment='Invalid stops')
            with self.assertRaises(ValueError):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()

    def test_position_protection_invalid_levels_and_tickets(self):
        self.position_fixture()
        for body in [dict(position='no'),dict(position='42',sl=float('nan')),dict(position='42',tp=-1),dict(position='42',sl=1.090001),dict(position='42',sl=1.11),dict(position='42',tp=1.09)]:
            with self.subTest(body=body),self.assertRaises(ValueError):self.terminal.position_preview(body)
        self.mt.order_send.assert_not_called()

    def test_live_account_cannot_preview_or_submit(self):
        p=self.terminal.preview(self.body)
        self.account.trade_mode=2
        with self.assertRaisesRegex(ValueError,'demo'): self.terminal.submit(p)
        with self.assertRaisesRegex(ValueError,'demo'): self.terminal.preview(self.body)
        self.mt.order_send.assert_not_called()

    def test_account_switch_and_expiration_block_submission(self):
        p=self.terminal.preview(self.body);self.account.login=456
        with self.assertRaisesRegex(ValueError,'Account changed'):self.terminal.submit(p)
        p=self.terminal.preview(self.body);self.terminal.previews[p['preview']]['expires']=0
        with self.assertRaisesRegex(ValueError,'expired'):self.terminal.submit(p)
        self.mt.order_send.assert_not_called()

    def test_stale_quote_and_invalid_inputs(self):
        self.tick.time=time.time()-120
        with self.assertRaisesRegex(ValueError,'stale'):self.terminal.preview(self.body)
        self.tick.time=time.time()
        for fields in [dict(volume=.015),dict(volume=float('nan')),dict(sl=1.11),dict(tp=1.09),dict(sl=1.090001)]:
            with self.subTest(fields=fields),self.assertRaises(ValueError):self.terminal.preview({**self.body,**fields})
        self.mt.order_send.assert_not_called()

    def test_broker_rejection_and_unknown_result_are_not_retried(self):
        self.mt.order_check.return_value=Row(retcode=10019,comment='No money')
        with self.assertRaisesRegex(ValueError,'No money'):self.terminal.preview(self.body)
        self.mt.order_check.return_value=Row(retcode=0,comment='Done')
        p=self.terminal.preview(self.body);self.mt.order_send.return_value=None
        with self.assertRaisesRegex(ValueError,'unknown'):self.terminal.submit(p)
        with self.assertRaises(ValueError):self.terminal.submit(p)
        self.mt.order_send.assert_called_once()

    def test_submit_rechecks_quote_and_broker(self):
        p=self.terminal.preview(self.body);self.tick.time=time.time()-120
        with self.assertRaisesRegex(ValueError,'stale'):self.terminal.submit(p)
        self.mt.order_send.assert_not_called()

    def test_closure_names_exact_ticket_and_reverses_side_at_closing_quote(self):
        for side,opposite,price in [(0,1,self.tick.bid),(1,0,self.tick.ask)]:
            with self.subTest(side=side):
                position=Row(ticket=42,symbol='EURUSD',volume=.1,type=side)
                self.mt.positions_get.side_effect=[(position,),(position,),()]
                self.mt.order_send.reset_mock()
                p=self.terminal.close_preview({'position':'42'})
                self.mt.order_send.assert_not_called()
                request=p['request']
                self.assertEqual((request['position'],request['volume'],request['type'],request['price']),(42,.1,opposite,price))
                self.assertEqual(self.mt.order_check.call_args.args[0]['position'],42)
                result=self.terminal.submit(p)
                self.assertEqual(result['operation'],'close');self.assertEqual(result['remaining_volume'],0)
                with self.assertRaises(ValueError):self.terminal.submit(p)
                self.mt.order_send.assert_called_once()

    def test_changed_or_disappeared_position_cannot_be_closed_from_old_preview(self):
        original=Row(ticket=42,symbol='EURUSD',volume=.1,type=0)
        for current in [(),(Row(ticket=42,symbol='EURUSD',volume=.2,type=0),),(Row(ticket=42,symbol='EURUSD',volume=.1,type=1),)]:
            self.mt.positions_get.side_effect=[(original,),current]
            p=self.terminal.close_preview({'position':'42'})
            with self.assertRaises(ValueError):self.terminal.submit(p)
        self.mt.order_send.assert_not_called()

    def test_close_blocks_live_accounts_expired_previews_and_stale_quotes(self):
        self.mt.positions_get.return_value=(Row(ticket=42,symbol='EURUSD',volume=.1,type=0),)
        p=self.terminal.close_preview({'position':'42'})
        self.terminal.previews[p['preview']]['expires']=0
        with self.assertRaisesRegex(ValueError,'expired'):self.terminal.submit(p)
        self.tick.time=time.time()-120
        with self.assertRaisesRegex(ValueError,'stale'):self.terminal.close_preview({'position':'42'})
        self.account.trade_mode=2
        with self.assertRaisesRegex(ValueError,'demo'):self.terminal.close_preview({'position':'42'})
        self.mt.order_send.assert_not_called()

    def test_close_partial_or_unknown_result_is_never_retried(self):
        position=Row(ticket=42,symbol='EURUSD',volume=.1,type=0)
        remaining=Row(ticket=42,symbol='EURUSD',volume=.05,type=0)
        self.mt.positions_get.side_effect=[(position,),(position,),(remaining,)]
        self.mt.order_send.return_value=Row(retcode=10010,comment='Partial',order=44,deal=45,price=1.1,volume=.05)
        p=self.terminal.close_preview({'position':'42'})
        self.assertEqual(self.terminal.submit(p)['remaining_volume'],.05)
        self.mt.positions_get.side_effect=None;self.mt.positions_get.return_value=(position,)
        self.mt.order_send.return_value=None
        p=self.terminal.close_preview({'position':'42'})
        with self.assertRaisesRegex(ValueError,'unknown'):self.terminal.submit(p)
        with self.assertRaises(ValueError):self.terminal.submit(p)
        self.assertEqual(self.mt.order_send.call_count,2)

    def test_four_pending_order_types_use_entry_and_return_filling(self):
        for side,kind,price,sl,tp,order_type in [('BUY','LIMIT',1.09,1.08,1.10,2),('SELL','LIMIT',1.11,1.12,1.10,3),('BUY','STOP',1.11,1.10,1.12,4),('SELL','STOP',1.09,1.10,1.08,5)]:
            with self.subTest(side=side,kind=kind):
                p=self.terminal.preview(dict(symbol='EURUSD',side=side,order_kind=kind,price=price,volume=.01,sl=sl,tp=tp))
                request=p['request']
                self.assertEqual((request['action'],request['type'],request['price'],request['type_filling']),(5,order_type,price,2))
                self.assertNotIn('position',request)
        self.mt.order_send.assert_not_called()

    def test_pending_bad_side_of_market_tick_and_protection_are_rejected(self):
        body=dict(symbol='EURUSD',side='BUY',order_kind='LIMIT',price=1.09,volume=.01,sl=1.08,tp=1.10)
        for fields in [dict(price=1.11),dict(price=1.090001),dict(price=float('nan')),dict(price=0),dict(sl=1.095),dict(tp=1.08),dict(order_kind='other')]:
            with self.subTest(fields=fields),self.assertRaises(ValueError):self.terminal.preview({**body,**fields})
        self.mt.order_send.assert_not_called()

    def test_pending_rechecks_market_and_submits_only_once(self):
        body=dict(symbol='EURUSD',side='BUY',order_kind='STOP',price=1.11,volume=.01)
        p=self.terminal.preview(body);self.tick.ask=1.12
        with self.assertRaises(ValueError):self.terminal.submit(p)
        self.mt.order_send.assert_not_called()
        self.tick.ask=1.1001;p=self.terminal.preview(body)
        self.assertEqual(self.terminal.submit(p)['operation'],'pending')
        with self.assertRaises(ValueError):self.terminal.submit(p)
        self.mt.order_send.assert_called_once()

    def test_cancellation_removes_exact_order_and_refuses_filled_order(self):
        order=Row(ticket=88,symbol='EURUSD',type=2)
        self.mt.orders_get.side_effect=[(order,),(order,)]
        p=self.terminal.cancel_preview({'order':'88'})
        self.mt.order_send.assert_not_called()
        self.assertEqual(p['request'],dict(action=8,order=88,symbol='EURUSD'))
        self.assertEqual(self.terminal.submit(p)['operation'],'cancel')
        with self.assertRaises(ValueError):self.terminal.submit(p)
        self.mt.orders_get.side_effect=[(order,),()]
        p=self.terminal.cancel_preview({'order':'88'})
        with self.assertRaisesRegex(ValueError,'no longer pending'):self.terminal.submit(p)
        self.mt.order_send.assert_called_once()

    def test_live_account_cannot_place_or_cancel_pending_orders(self):
        self.account.trade_mode=2
        with self.assertRaisesRegex(ValueError,'demo'):self.terminal.preview(dict(symbol='EURUSD',side='BUY',order_kind='LIMIT',price=1.09,volume=.01))
        with self.assertRaisesRegex(ValueError,'demo'):self.terminal.cancel_preview({'order':'88'})
        self.mt.order_send.assert_not_called()

    def test_pending_mode_infers_kind_and_freezes_it_for_confirmation(self):
        for side,price,expected in [('BUY',1.09,'LIMIT'),('BUY',1.11,'STOP'),('SELL',1.11,'LIMIT'),('SELL',1.09,'STOP')]:
            p=self.terminal.preview(dict(symbol='EURUSD',side=side,order_kind='PENDING',price=price,volume=.01))
            self.assertEqual(p['order_kind'],expected)
            self.assertEqual(self.terminal.previews[p['preview']]['body']['order_kind'],expected)
        p=self.terminal.preview(dict(symbol='EURUSD',side='BUY',order_kind='PENDING',price=1.11,volume=.01))
        self.tick.bid=1.1199;self.tick.ask=1.12
        with self.assertRaises(ValueError):self.terminal.submit(p) # Never silently turn a stop into a limit.
        self.mt.order_send.assert_not_called()

    def test_pending_amendment_preserves_ticket_type_expiration_and_sends_once(self):
        order=Row(ticket=88,symbol='EURUSD',type=2,volume_current=.01,price_open=1.09,sl=1.08,tp=1.1,type_time=2,time_expiration=2000000000)
        self.mt.orders_get.return_value=(order,)
        p=self.terminal.modify_preview(dict(order='88',price=1.085,sl=1.075,tp=1.095))
        r=p['request'];self.assertEqual((r['action'],r['order'],r['price'],r['type_time'],r['expiration']),(7,88,1.085,2,2000000000))
        self.mt.order_send.assert_not_called();self.assertEqual(self.terminal.submit(p)['operation'],'modify')
        with self.assertRaises(ValueError):self.terminal.submit(p)
        self.mt.order_send.assert_called_once()

    def test_amendment_cannot_replace_type_or_overwrite_concurrent_broker_changes(self):
        order=Row(ticket=88,symbol='EURUSD',type=2,volume_current=.01,price_open=1.09,sl=1.08,tp=1.1,type_time=0,time_expiration=0)
        self.mt.orders_get.return_value=(order,)
        with self.assertRaises(ValueError):self.terminal.modify_preview(dict(order='88',price=1.12,sl=1.08,tp=1.13))
        p=self.terminal.modify_preview(dict(order='88',price=1.085,sl=1.075,tp=1.095))
        order.sl=1.081
        with self.assertRaisesRegex(ValueError,'changed since review'):self.terminal.submit(p)
        p=self.terminal.modify_preview(dict(order='88',price=1.085,sl=1.075,tp=1.095))
        self.mt.orders_get.return_value=()
        with self.assertRaisesRegex(ValueError,'no longer pending'):self.terminal.submit(p)
        self.mt.order_send.assert_not_called()

    def test_position_plan_uses_read_only_account_currency_calculator(self):
        self.account.trade_mode=2 # Analysis works on live accounts too.
        self.mt.order_calc_profit.side_effect=[-10,25,3]
        result=self.terminal.plan(dict(symbol='EURUSD',side='BUY',volume=.01,entry=1.1,stop=1.09,target=1.125))
        self.assertEqual((result['risk'],result['reward'],result['mark_to_market']),(10,25,3))
        self.assertEqual(result['currency'],'USD')
        self.mt.order_calc_profit.assert_any_call(0,'EURUSD',.01,1.1,1.09)
        self.mt.order_send.assert_not_called();self.mt.order_check.assert_not_called()

    def test_short_plan_direction_and_bad_calculation_fail_cleanly(self):
        body=dict(symbol='EURUSD',side='SELL',volume=.01,entry=1.1,stop=1.11,target=1.08)
        self.mt.order_calc_profit.side_effect=[-10,20,-1]
        self.assertEqual(self.terminal.plan(body)['reward'],20)
        self.mt.order_calc_profit.assert_any_call(1,'EURUSD',.01,1.1,self.tick.ask)
        for fields in [dict(stop=1.09),dict(target=1.12),dict(entry=float('nan')),dict(volume=.015)]:
            with self.subTest(fields=fields),self.assertRaises(ValueError):self.terminal.plan({**body,**fields})
        self.mt.order_calc_profit.side_effect=[None,20,0]
        with self.assertRaisesRegex(ValueError,'unavailable'):self.terminal.plan(body)
        self.mt.order_send.assert_not_called()

    def test_symbol_search_includes_symbols_outside_market_watch(self):
        self.mt.symbols_get.return_value=[Row(name='XAUUSD',visible=False),Row(name='EURUSD',visible=True)]
        result=self.terminal.symbols()
        self.assertEqual(result['symbols'],['EURUSD','XAUUSD'])
        self.assertEqual(result['visible'],['EURUSD'])

    def test_watchlist_quotes_are_bounded_and_bad_quotes_are_omitted(self):
        self.mt.symbol_info.return_value=Row(visible=True)
        result=self.terminal.quotes({'symbols':['EURUSD','EURUSD']})
        self.assertEqual(result['quotes']['EURUSD']['bid'],1.1)
        self.mt.symbol_info_tick.assert_called_once()
        for symbols in ('EURUSD',[None],['EURUSD']*41):
            with self.assertRaises(ValueError):self.terminal.quotes({'symbols':symbols})
        self.tick.bid=float('nan')
        self.assertEqual(self.terminal.quotes({'symbols':['EURUSD']})['quotes'],{})

    def test_market_returns_candles_tick_volume_and_tick_size(self):
        self.account.balance=1000;self.account.equity=1000;self.account.margin_free=1000;self.account.currency='USD'
        self.mt.TIMEFRAME_M5=5
        info=self.mt.symbol_info.return_value;info.digits=5
        self.mt.copy_rates_from_pos.return_value=[dict(time=1000,open=1.1,high=1.2,low=1,close=1.15,tick_volume=42)]
        self.mt.positions_get.return_value=[]
        result=self.terminal.market({'symbol':'EURUSD','timeframe':'M5'})
        self.assertEqual(result['bars'],[[1000000,1.1,1.2,1,1.15,42]])
        self.assertEqual(result['tick_size'],.00001)
        self.mt.copy_rates_from_pos.assert_called_once_with('EURUSD',5,0,1000)
        with self.assertRaises(ValueError):self.terminal.market({'symbol':'EURUSD','timeframe':'bad'})
        self.mt.copy_rates_from_pos.return_value=None
        with self.assertRaises(ValueError):self.terminal.market({'symbol':'EURUSD'})

    def test_missing_account_and_disabled_python_trading_fail_cleanly(self):
        self.mt.account_info.return_value=None
        with self.assertRaisesRegex(ValueError,'disconnected'):self.terminal.symbols()
        self.mt.account_info.return_value=self.account
        self.mt.terminal_info.return_value.tradeapi_disabled=True
        with self.assertRaisesRegex(ValueError,'external Python'):self.terminal.preview(self.body)
        self.mt.order_send.assert_not_called()
