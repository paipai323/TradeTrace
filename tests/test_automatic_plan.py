import time
import unittest
import test_terminal


class AutomaticPlanTests(unittest.TestCase):
    def setUp(self):
        test_terminal.TerminalTests.setUp(self)
        self.account.equity=10000
        self.mt.ORDER_TIME_SPECIFIED=2
        self.info=self.mt.symbol_info.return_value
        self.info.expiration_mode=4
        self.mt.order_calc_profit.side_effect=lambda side,symbol,volume,entry,exit:(1 if side==0 else -1)*(exit-entry)*100000*volume
        self.settings=dict(enabled=True,entry='MARKET',timeframe='M5',sensitivity=2,buffer=10,rr=2,risk=1,expiry=30)
        self.body=dict(symbol='EURUSD',side='BUY',expected_account='123',expected_server='Demo',auto_plan=self.settings,
                       stop_swing=dict(price=1.09,time=time.time()-1200,confirmed_time=time.time()-300),
                       condition_setup=dict(action='REVIEW',rows=[],observations=[],settings={}))

    def test_market_plan_rounds_down_and_preview_never_sends(self):
        result=self.terminal.condition_plan(self.body)
        calc=result['calculation'];request=result['request']
        self.assertAlmostEqual(request['sl'],1.0899)
        self.assertAlmostEqual(calc['modeled_entry'],1.1003)
        self.assertAlmostEqual(request['tp'],1.1211)
        self.assertAlmostEqual(request['volume'],.09)
        self.assertLessEqual(calc['modeled_loss'],100)
        self.assertAlmostEqual(calc['modeled_reward']/calc['modeled_loss'],2)
        self.mt.order_send.assert_not_called()
        saved=self.terminal.previews[result['preview']]['body']
        self.assertEqual(saved['condition_risk_percent'],1)
        self.assertEqual(saved['condition_setup']['automatic_plan']['budget'],100)
        self.settings['risk']=2
        self.assertEqual(saved['auto_plan']['risk'],1,'review freezes nested plan settings')
        self.terminal.submit(result)
        with self.assertRaises(ValueError):self.terminal.submit(result)
        self.mt.order_send.assert_called_once()

    def test_sell_plan_places_protection_on_opposite_sides(self):
        self.body['side']='SELL';self.body['stop_swing']['price']=1.11
        result=self.terminal.condition_plan(self.body)
        self.assertAlmostEqual(result['request']['sl'],1.1101)
        self.assertLess(result['request']['tp'],self.tick.bid)
        self.assertLessEqual(result['calculation']['modeled_loss'],100)
        self.mt.order_send.assert_not_called()

    def test_retest_is_limit_with_broker_expiry(self):
        self.settings['entry']='RETEST';self.body['retest_level']=1.095
        result=self.terminal.condition_plan(self.body)
        r=result['request']
        self.assertEqual((r['action'],r['type'],r['type_time']),(5,2,2))
        self.assertGreater(r['expiration'],time.time()+29*60)
        self.assertAlmostEqual(result['calculation']['modeled_entry'],1.095)
        self.terminal.previews[result['preview']]['body']['condition_expires_at']=int(time.time()-1)
        with self.assertRaisesRegex(ValueError,'expiry'):self.terminal.submit(result)
        self.mt.order_send.assert_not_called()

    def test_retest_wrong_side_and_unsupported_expiry_do_not_fallback(self):
        self.settings['entry']='RETEST';self.body['retest_level']=1.11
        with self.assertRaisesRegex(ValueError,'wrong side'):self.terminal.condition_plan(self.body)
        self.body['retest_level']=1.095;self.info.expiration_mode=1
        with self.assertRaisesRegex(ValueError,'expiry'):self.terminal.condition_plan(self.body)
        self.mt.order_send.assert_not_called()

    def test_sell_retest_and_broker_volume_cap(self):
        self.body['side']='SELL';self.body['stop_swing']['price']=1.11
        self.body['retest_level']=1.105;self.settings['entry']='RETEST';self.info.volume_max=.05
        result=self.terminal.condition_plan(self.body)
        self.assertEqual(result['request']['type'],3)
        self.assertEqual(result['request']['volume'],.05)
        self.assertGreater(result['request']['sl'],result['request']['price'])
        self.assertLess(result['request']['tp'],result['request']['price'])
        self.mt.order_send.assert_not_called()

    def test_invalid_swing_risk_settings_and_minimum_lot_skip(self):
        for risk in [0,2.01,float('nan')]:
            self.settings['risk']=risk
            with self.assertRaises(ValueError):self.terminal.condition_plan(self.body)
        self.settings['risk']=1;self.account.equity=100
        with self.assertRaisesRegex(ValueError,'Minimum lot'):self.terminal.condition_plan(self.body)
        self.account.equity=10000;self.body['stop_swing']['price']=1.11
        with self.assertRaisesRegex(ValueError,'stop beyond entry'):self.terminal.condition_plan(self.body)
        self.body['stop_swing']={}
        with self.assertRaisesRegex(ValueError,'swing'):self.terminal.condition_plan(self.body)
        self.mt.order_send.assert_not_called()

    def test_send_rechecks_equity_price_and_account(self):
        result=self.terminal.condition_plan(self.body);self.account.equity=5000
        with self.assertRaisesRegex(ValueError,'budget'):self.terminal.submit(result)
        self.account.equity=10000;result=self.terminal.condition_plan(self.body)
        self.tick.ask+=.00001
        with self.assertRaisesRegex(ValueError,'reward/risk'):self.terminal.submit(result)
        self.tick.ask-=.00001;result=self.terminal.condition_plan(self.body);self.account.login=999
        with self.assertRaisesRegex(ValueError,'account changed'):self.terminal.submit(result)
        self.mt.order_send.assert_not_called()

    def test_missing_broker_profit_calculation_skips(self):
        self.mt.order_calc_profit.side_effect=None;self.mt.order_calc_profit.return_value=None
        with self.assertRaisesRegex(ValueError,'risk calculation'):self.terminal.condition_plan(self.body)
        self.mt.order_send.assert_not_called()
