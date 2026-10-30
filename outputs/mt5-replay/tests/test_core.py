import unittest
from unittest.mock import patch, Mock
from types import SimpleNamespace as Row
from core import closed_positions, Bridge


def deal(ticket, entry, side, **kw):
    fields = dict(ticket=ticket, position_id=77, type=side, entry=entry, time_msc=ticket*1000,
        volume=.1, symbol='EURUSD', price=1.1, reason=0, order=ticket,
        profit=0., commission=-.5, swap=0., fee=0.)
    fields.update(kw)
    return Row(**fields)


class ReconstructionTests(unittest.TestCase):
    def test_guard_blocks_connector_initialization(self):
        connector = Mock()
        with patch('core.running_terminal_path', side_effect=ValueError('restricted Windows permissions')):
            with patch.dict('sys.modules', {'MetaTrader5': connector}):
                with self.assertRaisesRegex(ValueError, 'restricted'):
                    Bridge().connect()
        connector.initialize.assert_not_called()

    def test_actual_stop_reason_and_net_include_both_sides(self):
        trades, skipped = closed_positions([deal(2, 1, 1, reason=4, profit=-10, swap=-1), deal(1, 0, 0)])
        self.assertEqual(skipped, 0)
        self.assertEqual(trades[0]['reason'], 'Stop loss')
        self.assertEqual(trades[0]['net'], -12)
        self.assertEqual(trades[0]['side'], 'BUY')

    def test_sell_take_profit_and_close_by(self):
        trades, _ = closed_positions([deal(1, 0, 1), deal(2, 3, 0, reason=5)])
        self.assertEqual(trades[0]['side'], 'SELL')
        self.assertEqual(trades[0]['reason'], 'Take profit')

    def test_complex_and_open_are_not_misrepresented(self):
        cases = [[deal(1, 0, 0)], [deal(1, 0, 0), deal(2, 1, 1, volume=.05)],
            [deal(1, 0, 0), deal(2, 0, 0), deal(3, 1, 1, volume=.2)],
            [deal(1, 0, 0), deal(2, 2, 1)]]
        for rows in cases:
            with self.subTest(rows=rows):
                self.assertEqual(closed_positions(rows), ([], 1))

    def test_account_change_invalidates_selection(self):
        b = Bridge()
        b.account = 1
        b.mt = Row(account_info=lambda: Row(login=2))
        b.trades = {'77': {}}
        with self.assertRaisesRegex(ValueError, 'account changed'):
            b.check()
        self.assertEqual(b.trades, {})

    def test_tick_replay_preserves_bid_ask_and_closing_levels(self):
        class Tick(dict):
            pass
        b = Bridge()
        b.account = 1
        b.trades = {'77': dict(id='77', symbol='EURUSD', side='SELL', start=1000,
            end=5000, entry=1.1, exit=1.09, order=2)}
        b.mt = Row(account_info=lambda: Row(login=1), symbol_select=lambda *a: True,
            history_orders_get=lambda **kw: [Row(sl=1.12, tp=1.09)], COPY_TICKS_ALL=0,
            copy_ticks_range=lambda *a: [Tick(time_msc=500, bid=1.1, ask=1.11),
                Tick(time_msc=1000, bid=1.1, ask=1.1001),
                Tick(time_msc=5000, bid=1.0899, ask=1.09),
                Tick(time_msc=6000, bid=1.08, ask=1.09)])
        replay = b.replay('77')
        self.assertEqual(replay['points'], [[1000, 1.1, 1.1001], [5000, 1.0899, 1.09]])
        self.assertEqual(replay['trade']['sl'], 1.12)
        self.assertEqual(replay['trade']['tp'], 1.09)
        b.mt.copy_ticks_range = lambda *a: []
        with self.assertRaisesRegex(ValueError, 'No historical'):
            b.replay('77')


if __name__ == '__main__':
    unittest.main()
