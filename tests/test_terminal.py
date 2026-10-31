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
                       ORDER_TYPE_SELL=1, ORDER_TIME_GTC=0)
        self.mt.account_info.return_value = self.account
        self.mt.terminal_info.return_value = Row(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.mt.symbol_info.return_value = Row(volume_min=.01, volume_max=10, volume_step=.01,
            trade_tick_size=.00001, trade_stops_level=10, point=.00001, filling_mode=2)
        self.tick = Row(time=time.time(), bid=1.1, ask=1.1001)
        self.mt.symbol_info_tick.return_value = self.tick
        self.mt.order_check.return_value = Row(retcode=0, comment='Done')
        self.mt.order_send.return_value = Row(retcode=10009,comment='Done',order=42,deal=43,price=1.1001,volume=.01)
        self.terminal = Terminal(Row(mt=self.mt, check=Mock()))
        self.body = dict(symbol='EURUSD',side='BUY',volume=.01,sl=1.09,tp=1.12)

    def test_preview_never_sends_and_single_use_submission(self):
        p=self.terminal.preview(self.body)
        self.mt.order_send.assert_not_called()
        self.assertEqual(self.terminal.submit(p)['deal'],'43')
        with self.assertRaises(ValueError): self.terminal.submit(p)
        self.mt.order_send.assert_called_once()

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
