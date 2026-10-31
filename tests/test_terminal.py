import time
import unittest
from types import SimpleNamespace as Row
from unittest.mock import Mock
from terminal import Terminal


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.account = Row(login=123, server='Demo', trade_mode=0, trade_allowed=True, trade_expert=True)
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
