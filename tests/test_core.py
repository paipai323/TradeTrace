import unittest
from unittest.mock import patch, Mock
from types import SimpleNamespace as Row
from core import closed_positions, Bridge, recorded_levels


def deal(ticket, entry, side, **kw):
    fields = dict(ticket=ticket, position_id=77, type=side, entry=entry, time_msc=ticket*1000,
        volume=.1, symbol='EURUSD', price=1.1, reason=0, order=ticket,
        profit=0., commission=-.5, swap=0., fee=0.)
    fields.update(kw)
    return Row(**fields)


class ReconstructionTests(unittest.TestCase):
    def test_automatic_history_selects_latest_80_completed_candles(self):
        b=Bridge();b.account=123
        b.trades={'77':dict(id='77',symbol='EURUSD',side='BUY',start=10000000,end=10010000,entry=1.1,exit=1.11,order=2)}
        b.mt=Row(account_info=lambda:Row(login=123),symbol_select=lambda *a:True,
            history_deals_get=lambda **kw:[],history_orders_get=lambda **kw:[],COPY_TICKS_ALL=0,TIMEFRAME_M1=1,
            copy_ticks_range=lambda *a:[dict(time_msc=10000000,bid=1.1,ask=1.1001)],
            copy_rates_range=lambda *a:[dict(time=i*60,open=1.1,high=1.2,low=1,close=1.15) for i in range(120)])
        result=b.replay('77')
        self.assertEqual(len(result['context']),80)
        self.assertEqual(result['context_start'],40*60000)
        self.assertEqual(result['context_mode'],'auto')
        self.assertEqual(b.replay('77',60)['context_mode'],'manual')

    def test_m5_context_uses_selected_period_and_excludes_unfinished_bar(self):
        b=Bridge();b.account=123
        b.trades={'77':dict(id='77',symbol='EURUSD',side='BUY',start=750000,end=780000,entry=1.1,exit=1.11,order=2)}
        b.mt=Row(account_info=lambda:Row(login=123),symbol_select=lambda *a:True,
            history_deals_get=lambda **kw:[],history_orders_get=lambda **kw:[],COPY_TICKS_ALL=0,TIMEFRAME_M5=5,
            copy_ticks_range=lambda *a:[dict(time_msc=750000,bid=1.1,ask=1.1001)],
            copy_rates_range=Mock(return_value=[dict(time=t,open=1.1,high=1.2 if t<600 else 99,low=1,close=1.15) for t in [0,300,600]]))
        result=b.replay('77',15,'M5')
        self.assertEqual(result['candle_timeframe'],'M5')
        self.assertEqual(result['candle_ms'],300000)
        self.assertEqual([bar[0] for bar in result['context']],[0,300000])
        self.assertEqual(b.mt.copy_rates_range.call_args.args[1],5)
        with self.assertRaisesRegex(ValueError,'candles'):
            b.replay('77',15,'BAD')

    def test_saved_position_outside_loaded_dates_can_replay(self):
        b=Bridge()
        b.account=123
        b.mt=Row(account_info=lambda:Row(login=123),symbol_select=lambda *a:True,
            history_deals_get=Mock(return_value=[deal(1,0,0),deal(2,1,1,reason=5)]),
            history_orders_get=lambda **kw:[Row(sl=1.08,tp=1.12)],COPY_TICKS_ALL=0,
            TIMEFRAME_M1=1,copy_rates_range=lambda *a:[],
            copy_ticks_range=lambda *a:[dict(time_msc=1000,bid=1.1,ask=1.1001),dict(time_msc=2000,bid=1.11,ask=1.1101)])
        self.assertEqual(b.trades,{})
        result=b.replay('77')
        self.assertEqual(result['trade']['id'],'77')
        self.assertIn('77',b.trades)
        b.mt.history_deals_get.assert_called_with(position=77)

    def test_history_syncs_snapshot_to_journal(self):
        from datetime import datetime, timezone
        b=Bridge()
        b.account,b.server=123,'Broker'
        b.mt=Row(account_info=lambda:Row(login=123,server='Broker',currency='USD'),
            history_deals_get=lambda *a:[deal(1,0,0),deal(2,1,1,profit=12)])
        b.sync_levels=Mock()
        b.journal=Mock()
        result=b.history(datetime(1970,1,1,tzinfo=timezone.utc),datetime(2026,1,1,tzinfo=timezone.utc))
        b.journal.sync.assert_called_once_with(123,'Broker','USD',result['trades'])
        self.assertEqual(result['trades'][0]['net'],11)

    def test_one_click_connect_reuses_authenticated_native_session(self):
        b = Bridge()
        previous = Mock()
        b.direct = previous
        def connect(path):
            b.direct = None
            b.account, b.server = 123, 'Broker'
            return dict(account='123', server='Broker', currency='USD')
        b.connect = Mock(side_effect=connect)
        result = b.connect_all()
        self.assertIs(b.direct, previous)
        previous.verify_account.assert_called_once_with(123, 'Broker')
        self.assertEqual(result['native']['state'], 'connected')

    def test_one_click_connect_explains_missing_key_and_native_failure(self):
        b = Bridge()
        b.key_store = Mock()
        b.key_store.load.return_value = None
        b.connect = Mock(return_value=dict(account='123',server='Broker',currency='USD'))
        self.assertEqual(b.connect_all()['native']['state'], 'setup')
        b.connect_native = Mock(side_effect=ValueError('API key rejected'))
        result = b.connect_all(key='fixture')
        self.assertEqual(result['native']['state'], 'waiting')
        self.assertEqual(result['native']['message'], 'API key rejected')

    def test_saved_key_is_reused_after_restart_and_only_for_its_endpoint(self):
        b = Bridge()
        b.key_store = Mock()
        b.key_store.load.return_value = dict(url='http://127.0.0.1:22346/mcp',key='fixture')
        b.connect = Mock(return_value=dict(account='123',server='Broker',currency='USD'))
        b.connect_native = Mock(return_value=dict(state='connected',levels=[]))
        b.connect_all()
        b.connect_native.assert_called_once_with('http://127.0.0.1:22346/mcp','fixture')
        b.connect_native.reset_mock()
        self.assertEqual(b.connect_all(url='http://127.0.0.1:22347/mcp')['native']['state'], 'setup')
        b.connect_native.assert_not_called()

    def test_direct_history_matches_position_without_files_or_helpers(self):
        b = Bridge()
        b.account, b.server = 123, 'TestBroker'
        b.trades = {'77': dict(order=2, end=5000, start=1000, symbol='XAUUSD', entry=3990.788)}
        b.direct = Mock()
        b.direct.positions.return_value = {'positions':[dict(position_id=77, symbol='XAUUSD', price_open=3990.788, sl=3985.5, tp=4010)]}
        result = b.sync_levels(force=True)
        self.assertEqual(result['state'], 'active')
        self.assertEqual(result['levels'], [dict(id='77', sl=3985.5, tp=4010)])
        b.direct.verify_account.assert_called_with(123, 'TestBroker')
        b.direct.positions.return_value = {'positions':[dict(position_id=77, symbol='XAUUSD', price_open=4000, sl=3980)]}
        self.assertEqual(b.sync_levels(force=True)['state'], 'waiting')

    def test_broker_comment_recovers_trigger_separately_from_fill(self):
        trade = dict(reason_code=4, exit=3989.8)
        levels = recorded_levels(trade, [Row(sl=0, tp=0, comment='')],
            [Row(sl=3991, tp=4010)], [Row(comment='[sl 3990.500]')])
        self.assertEqual(levels['sl'], 3990.5)
        self.assertEqual(levels['sl_source'], 'broker exit comment')
        self.assertNotEqual(levels['sl'], trade['exit'])
        self.assertEqual(levels['tp'], 4010)

    def test_missing_or_untrusted_trigger_is_never_inferred_from_fill(self):
        for reason, comment in [(4, '[sl]'), (4, 'my target [sl 3990]'), (0, '[sl 3990]')]:
            levels = recorded_levels(dict(reason_code=reason, exit=3989.8), [], [], [Row(comment=comment)])
            self.assertEqual(levels['sl'], 0)
        self.assertEqual(recorded_levels(dict(reason_code=4), [], [], [])['sl_source'],
            'trigger confirmed; exact price unavailable')

    def test_exit_deal_levels_take_precedence_and_tp_comments_work(self):
        levels = recorded_levels(dict(reason_code=4), [Row(sl=3991)], [],
            [Row(sl=3990, comment='[sl 3989]')])
        self.assertEqual(levels['sl'], 3990)
        self.assertEqual(levels['sl_source'], 'exit deal')
        self.assertEqual(recorded_levels(dict(reason_code=5), [], [],
            [Row(comment='[tp 4010.25]')])['tp'], 4010.25)

    def test_exit_sources_and_unknown_reasons_are_preserved(self):
        for code, label in [(0, 'Desktop terminal closure'), (1, 'Mobile app closure'),
                            (2, 'Web platform closure'), (3, 'EA / script closure'),
                            (6, 'Stop out'), (7, 'Rollover'), (8, 'Variation margin'),
                            (9, 'Instrument split'), (10, 'Corporate action'),
                            (99, 'Unknown exit reason (code 99)')]:
            with self.subTest(code=code):
                trades, _ = closed_positions([deal(1, 0, 0), deal(2, 1, 1, reason=code)])
                self.assertEqual(trades[0]['reason'], label)
                self.assertEqual(trades[0]['reason_code'], code)

    def test_fresh_verification_detects_changed_net(self):
        rows = [deal(1, 0, 0), deal(2, 1, 1, reason=5, profit=12)]
        b = Bridge()
        b.account = 1
        b.trades = {'77': closed_positions(rows)[0][0]}
        b.mt = Row(account_info=lambda: Row(login=1), history_deals_get=lambda **kw: rows)
        self.assertTrue(b.verify('77')['matches'])
        rows[1].profit = 15
        report = b.verify('77')
        self.assertFalse(report['matches'])
        self.assertEqual(report['differences'], ['net'])
        self.assertEqual(len(report['deals']), 2)

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
            history_deals_get=lambda **kw: [], history_orders_get=lambda **kw: [Row(sl=1.12, tp=1.09)], COPY_TICKS_ALL=0,
            TIMEFRAME_M1=1, copy_rates_range=lambda *a: [],
            copy_ticks_range=lambda *a: [Tick(time_msc=500, bid=1.1, ask=1.11),
                Tick(time_msc=1000, bid=1.1, ask=1.1001),
                Tick(time_msc=5000, bid=1.0899, ask=1.09),
                Tick(time_msc=6000, bid=1.08, ask=1.09)])
        replay = b.replay('77')
        self.assertEqual(replay['points'], [[1000, 1.1, 1.1001], [5000, 1.0899, 1.09], [6000, 1.08, 1.09]])
        self.assertEqual(replay['trade']['end'], 5000)
        self.assertEqual(replay['replay_end'], 6000)
        at_exit = b.replay('77', after_minutes=0)
        self.assertEqual(at_exit['points'], replay['points'][:2])
        self.assertEqual(at_exit['replay_end'], 5000)
        with self.assertRaisesRegex(ValueError, 'after-exit'):
            b.replay('77', after_minutes=999)
        self.assertEqual(replay['trade']['sl'], 1.12)
        self.assertEqual(replay['trade']['tp'], 1.09)
        b.mt.copy_ticks_range = lambda *a: []
        with self.assertRaisesRegex(ValueError, 'No historical'):
            b.replay('77')

    def test_context_excludes_candle_containing_entry(self):
        b = Bridge()
        b.account = 1
        b.trades = {'77': dict(id='77', symbol='EURUSD', side='BUY', start=150000,
            end=180000, entry=1.1, exit=1.11, order=2)}
        b.mt = Row(account_info=lambda: Row(login=1), symbol_select=lambda *a: True,
            history_deals_get=lambda **kw: [], history_orders_get=lambda **kw: [], COPY_TICKS_ALL=0, TIMEFRAME_M1=1,
            copy_ticks_range=lambda *a: [dict(time_msc=150000, bid=1.1, ask=1.1001)],
            copy_rates_range=lambda *a: [dict(time=60, open=1.09, high=1.1, low=1.08, close=1.095),
                dict(time=120, open=1.095, high=9, low=1, close=8)])
        report = b.replay('77', 15)
        self.assertEqual(len(report['context']), 1)
        self.assertEqual(report['context'][0][0], 60000)
        self.assertEqual(report['trade']['sl'], 0)
        b.trades['77']['entry_order'] = 1
        b.mt.history_orders_get = lambda **kw: [Row(sl=1.08, tp=1.12)] if kw['ticket'] == 1 else [Row(sl=0, tp=0)]
        fallback = b.replay('77', 15)['trade']
        self.assertEqual(fallback['sl'], 1.08)
        self.assertEqual(fallback['tp'], 1.12)
        self.assertEqual(fallback['sl_source'], 'entry order reference')
        b.native_levels[('77', '2', '180000')] = dict(sl=1.085, tp=0)
        native = b.replay('77', 15)['trade']
        self.assertEqual(native['sl'], 1.085)
        self.assertEqual(native['sl_source'], 'direct MT5 position history')
        self.assertEqual(native['tp'], 0)
        with self.assertRaisesRegex(ValueError, 'Choose'):
            b.replay('77', 99)


if __name__ == '__main__':
    unittest.main()
