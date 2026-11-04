import copy
import threading
import time
import unittest
import test_automatic_plan
from condition_monitor import ConditionMonitor


class MonitorEstimateTests(unittest.TestCase):
    def setUp(self):
        test_automatic_plan.AutomaticPlanTests.setUp(self)
        self.now=time.time();self.monitor=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now)
        values=[1.08,1.095,1.085,1.1,1.09,1.098,1.092,1.099]
        self.bars=[[int((self.now-(8-i)*300)*1000),p,p+.0002,p-.0002,p,100] for i,p in enumerate(values)]
        self.terminal.market=lambda body:dict(account='123',server='Demo',demo=True,bid=self.tick.bid,ask=self.tick.ask,quote_time=self.now,bars=self.bars,
                    equity=10000,currency='USD',digits=5,tick_size=.00001,point=.00001,volume_min=.01,volume_max=10,volume_step=.01,trading_allowed=True)
        self.start=dict(request_id='estimate-start',symbol='EURUSD',expected_account='123',expected_server='Demo',rows=[dict(rule='TRADED_ABOVE',mode='LIVE',timeframe='M1',level=1.101)],
                       settings=dict(action='AUTO',sizing='MANUAL',timeout=0,gap=300,autoPlan=dict(enabled=False),ticket=dict(side='BUY',**{'order-kind':'MARKET','order-price':''},volume=.01,sl=1.09,tp=1.12)))

    def estimate(self):
        run=self.monitor.start(self.start)['run'];return self.monitor.estimate(dict(id=run['id']))['estimate']

    def test_manual_estimate_never_checks_sends_or_changes_monitor(self):
        run=self.monitor.start(self.start)['run'];self.terminal.previews['existing']=dict(sentinel=True)
        before=copy.deepcopy(self.monitor.status()['run']);previews=copy.deepcopy(self.terminal.previews);attempts=copy.deepcopy(self.terminal.condition_attempts)
        result=self.monitor.estimate(dict(id=run['id']))['estimate']
        self.assertEqual(result['status'],'would_pass');self.assertAlmostEqual(result['entry'],1.1001);self.assertGreater(result['risk'],0)
        self.assertEqual(self.monitor.status()['run'],before);self.assertEqual(self.terminal.previews,previews);self.assertEqual(self.terminal.condition_attempts,attempts)
        self.mt.order_check.assert_not_called();self.mt.order_send.assert_not_called()

    def test_quality_failure_preserves_metrics_and_does_not_skip_real_run(self):
        self.start['settings']['entryQuality']=dict(enabled=True,max_distance=.0001,min_rr=2,target=0,reference_step=1)
        result=self.estimate();self.assertEqual(result['status'],'would_skip');self.assertIn('distance',result['reason']);self.assertGreater(result['distance'],result['max_distance'])
        self.assertIsNotNone(result['rr']);self.assertEqual(self.monitor.run['phase'],'running');self.assertFalse(self.monitor.run['attempted'])

    def test_nearer_target_caps_available_rr_without_moving_tp(self):
        self.start['settings']['entryQuality']=dict(enabled=True,max_distance=0,min_rr=1,target=1.105)
        result=self.estimate();self.assertEqual(result['status'],'would_skip');self.assertLess(result['rr'],1);self.assertEqual(result['tp'],1.12)

    def test_automatic_plan_uses_real_calculator_without_review(self):
        self.start['settings']['autoPlan']=dict(enabled=True,entry='MARKET',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=30)
        result=self.estimate();self.assertEqual(result['status'],'would_pass');self.assertLessEqual(result['risk'],50);self.assertAlmostEqual(result['rr'],2,places=4)
        self.assertEqual(self.terminal.previews,{});self.mt.order_check.assert_not_called();self.mt.order_send.assert_not_called()

    def test_manual_equity_sizing_matches_current_two_percent_budget(self):
        self.start['settings']['sizing']='AUTO';result=self.estimate()
        self.assertEqual(result['status'],'would_pass');self.assertGreater(result['volume'],.01);self.assertLessEqual(result['risk'],200)
        self.assertEqual(self.terminal.previews,{})

    def test_pending_estimate_keeps_entry_and_infers_limit(self):
        self.start['settings']['ticket'].update({'order-kind':'PENDING','order-price':1.095})
        result=self.estimate();self.assertEqual(result['status'],'would_pass');self.assertEqual(result['entry'],1.095);self.assertEqual(result['order_kind'],'LIMIT')
        self.mt.order_check.assert_not_called()

    def test_observed_retest_can_be_estimated_without_creating_a_review(self):
        self.start['settings']['autoPlan']=dict(enabled=True,entry='RETEST',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=30)
        self.start['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M5',sensitivity=1),dict(rule='TRADED_ABOVE',mode='LIVE',timeframe='M1',level=1.2)]
        run=self.monitor.start(self.start)['run'];self.monitor.run['sequence'].index=1
        self.monitor.run['observations']=[dict(type='passed',index=0,structure=dict(direction=1,level=1.095))]
        result=self.monitor.estimate(dict(id=run['id']))['estimate'];self.assertEqual(result['status'],'would_pass');self.assertEqual(result['order_kind'],'LIMIT');self.assertEqual(result['entry'],1.095)
        self.assertEqual(self.terminal.previews,{});self.mt.order_check.assert_not_called();self.mt.order_send.assert_not_called()

    def test_retest_without_observed_break_is_explicitly_unavailable(self):
        self.start['settings']['autoPlan']=dict(enabled=True,entry='RETEST',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=30)
        self.start['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M5',sensitivity=1)]
        result=self.estimate();self.assertEqual(result['status'],'unavailable');self.assertIn('observed matching',result['reason'])
        self.mt.order_check.assert_not_called();self.assertEqual(self.terminal.previews,{})

    def test_stale_structure_observation_after_reset_cannot_price_a_retest(self):
        self.start['settings']['autoPlan']=dict(enabled=True,entry='RETEST',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=30)
        self.start['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M5',sensitivity=1)]
        run=self.monitor.start(self.start)['run'];self.monitor.run['observations']=[dict(type='passed',index=0,structure=dict(direction=1,level=1.095)),dict(type='reset')]
        result=self.monitor.estimate(dict(id=run['id']))['estimate'];self.assertEqual(result['status'],'unavailable');self.assertIn('observed matching',result['reason'])

    def test_cancellation_preview_does_not_invalidate_running_setup(self):
        self.start['settings']['invalidation']=dict(enabled=True,source='LEVEL',direction='BELOW',level=1.099)
        run=self.monitor.start(self.start)['run'];self.tick.bid=1.098;self.tick.ask=1.0981
        result=self.monitor.estimate(dict(id=run['id']))['estimate'];self.assertEqual(result['status'],'would_skip');self.assertEqual(self.monitor.run['phase'],'running');self.assertIsNone(self.monitor.run['invalidation_trigger'])

    def test_alerts_stopped_and_unknown_monitors_do_not_calculate(self):
        self.start['settings']['action']='ALERT';result=self.estimate();self.assertEqual(result['status'],'alert')
        self.monitor.stop();result=self.monitor.estimate(dict(id=self.monitor.run['id']))['estimate'];self.assertEqual(result['status'],'unavailable')
        with self.assertRaises(ValueError):self.monitor.estimate(dict(id='missing'))
        self.mt.order_calc_profit.assert_not_called()

    def test_frozen_settings_not_mutable_draft_and_cache_bounded_in_time(self):
        run=self.monitor.start(self.start)['run'];self.start['settings']['ticket']['sl']=1.11
        first=self.monitor.estimate(dict(id=run['id']))['estimate'];self.tick.ask=1.1051;self.tick.bid=1.105
        self.assertEqual(self.monitor.estimate(dict(id=run['id']))['estimate'],first)
        self.now+=4;next_value=self.monitor.estimate(dict(id=run['id']))['estimate'];self.assertEqual(next_value['sl'],1.09);self.assertNotEqual(next_value['entry'],first['entry'])

    def test_account_and_quote_failures_leave_runner_untouched(self):
        run=self.monitor.start(self.start)['run'];self.account.login=456
        result=self.monitor.estimate(dict(id=run['id']))['estimate'];self.assertEqual(result['status'],'unavailable');self.assertEqual(self.monitor.run['phase'],'running')
        self.mt.order_send.assert_not_called()

    def test_passed_stop_swing_missing_does_not_generate_an_order(self):
        self.start['settings']['autoPlan']=dict(enabled=True,entry='MARKET',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=30)
        self.bars.clear();result=self.estimate();self.assertEqual(result['status'],'would_skip');self.assertIn('stop swing',result['reason'])
        self.assertEqual(self.terminal.previews,{})
