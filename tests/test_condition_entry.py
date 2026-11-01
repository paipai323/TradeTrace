import unittest
from types import SimpleNamespace as Row
import test_terminal


class ConditionEntryTests(unittest.TestCase):
    def setUp(self):
        test_terminal.TerminalTests.setUp(self)
        self.mt.positions_get.return_value=[]
        self.account.equity=10000
        self.body.update(condition_entry=True,expected_account='123',expected_server='Demo')

    def test_condition_allows_existing_positions_and_pending_orders(self):
        self.mt.positions_get.return_value=[Row(symbol='EURUSD')]
        self.mt.orders_get.return_value=[Row(symbol='EURUSD')]
        self.terminal.submit(self.terminal.preview(self.body))
        self.mt.order_send.assert_called_once()
        self.assertNotIn('position',self.mt.order_send.call_args.args[0])

    def test_condition_allows_pending_entry_with_existing_exposure(self):
        self.mt.positions_get.return_value=[Row(symbol='EURUSD')]
        self.mt.orders_get.return_value=[Row(symbol='EURUSD')]
        self.body.update(order_kind='LIMIT',price=1.095)
        self.terminal.submit(self.terminal.preview(self.body))
        self.mt.order_send.assert_called_once()
        self.assertEqual(self.mt.order_send.call_args.args[0]['action'],self.mt.TRADE_ACTION_PENDING)

    def test_condition_allows_exposure_arriving_after_preview(self):
        preview=self.terminal.preview(self.body)
        self.mt.positions_get.return_value=[Row(symbol='EURUSD')]
        self.mt.orders_get.return_value=[Row(symbol='EURUSD')]
        self.terminal.submit(preview)
        self.mt.order_send.assert_called_once()

    def test_condition_cooldown_blocks_second_arm(self):
        self.terminal.submit(self.terminal.preview(self.body))
        with self.assertRaisesRegex(ValueError,'last 60 seconds'):
            self.terminal.submit(self.terminal.preview(self.body))
        self.mt.order_send.assert_called_once()

    def test_condition_risk_checked_again_at_send(self):
        self.body['condition_risk_auto']=True
        self.mt.order_calc_profit.return_value=-199
        preview=self.terminal.preview(self.body)
        self.mt.order_calc_profit.return_value=-201
        with self.assertRaisesRegex(ValueError,'2% equity'):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()

    def test_condition_requires_protection_and_same_account(self):
        with self.assertRaisesRegex(ValueError,'SL and TP'):self.terminal.preview({**self.body,'sl':0})
        with self.assertRaisesRegex(ValueError,'account changed'):self.terminal.preview({**self.body,'expected_account':'999'})
        self.mt.order_send.assert_not_called()

    def test_condition_unknown_send_is_never_retried(self):
        self.mt.order_send.return_value=None
        preview=self.terminal.preview(self.body)
        with self.assertRaisesRegex(ValueError,'unknown'):self.terminal.submit(preview)
        with self.assertRaisesRegex(ValueError,'already used'):self.terminal.submit(preview)
        with self.assertRaisesRegex(ValueError,'last 60 seconds'):self.terminal.submit(self.terminal.preview(self.body))
        self.mt.order_send.assert_called_once()


if __name__=='__main__':unittest.main()
