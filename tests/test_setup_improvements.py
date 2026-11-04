import unittest,threading,time
from types import SimpleNamespace as NS
import test_terminal,test_automatic_plan
from condition_monitor import ConditionRun
from entry_quality import EntryQualitySkipped
from journal import setup_performance

class ExposureTests(unittest.TestCase):
 def setUp(self):
  test_terminal.TerminalTests.setUp(self);self.account.equity=1000
  self.mt.positions_get.return_value=[NS(ticket=1,symbol='EURUSD',type=0,volume=.1,price_open=1.12,sl=1.09)]
  self.mt.orders_get.return_value=[NS(ticket=2,symbol='EURUSD',type=2,volume_current=.2,price_open=1.08,sl=1.07)]
  self.mt.order_calc_profit.side_effect=lambda side,symbol,vol,entry,sl:(1 if side==0 else -1)*(sl-entry)*vol*1000
 def test_combines_current_position_and_pending_without_sending(self):
  result=self.terminal.exposure();self.assertAlmostEqual(result['risk'],3);self.assertAlmostEqual(result['risk_percent'],.3);self.assertEqual(len(result['items']),2);self.mt.order_send.assert_not_called()
 def test_missing_stop_not_treated_as_zero_complete_total(self):
  self.mt.positions_get.return_value[0].sl=0;result=self.terminal.exposure();self.assertEqual(len(result['unknown']),1);self.assertAlmostEqual(result['risk'],2)
 def test_stale_quote_is_unknown(self):
  self.tick.time=time.time()-100;self.assertEqual(len(self.terminal.exposure()['unknown']),1)
 def test_positions_read_failure_raises(self):
  self.mt.positions_get.return_value=None
  with self.assertRaises(ValueError):self.terminal.exposure()

class RetestConfirmationTests(unittest.TestCase):
 def setUp(self):
  self.now=1000.;self.runner=ConditionRun(NS(),threading.RLock(),lambda:self.now)
  self.bars=[[900000,100,102,100,101,1],[960000,101,102,100,101,1]]
  self.runner._market=lambda frame:dict(bars=self.bars)
  self.runner.run=dict(action='AUTO',settings=dict(autoPlan=dict(enabled=True,entry='CONFIRM',expiry=1),ticket=dict(side='BUY')),rows=[dict(timeframe='M1')],observations=[dict(index=0,structure=dict(direction=1,level=100))],events=[],event_no=0)
 def ready(self):return self.runner._confirmation_ready(dict(bid=101))
 def bar(self,stamp,open,high,low,close):self.bars.insert(-1,[stamp*1000,open,high,low,close,1])
 def test_waits_for_future_touch_and_bullish_close(self):
  self.assertFalse(self.ready());self.bar(960,101,103,100.5,102);self.assertFalse(self.ready())
  self.bar(1020,101,102,99,99.5);self.assertFalse(self.ready());self.bar(1080,99.5,102,99.5,101);self.assertTrue(self.ready());self.assertEqual(self.runner.run['observations'][-1]['type'],'retest_confirmed')
 def test_same_future_candle_can_touch_and_reject(self):
  self.assertFalse(self.ready());self.bar(960,100,102,99,101);self.assertTrue(self.ready())
 def test_sell_requires_bearish_rejection(self):
  self.runner.run['settings']['ticket']['side']='SELL';self.runner.run['observations'][0]['structure']['direction']=-1
  self.assertFalse(self.ready());self.bar(960,100,101,98,99);self.assertTrue(self.ready())
 def test_expiry_skips_without_entry(self):
  self.ready();self.now+=61
  with self.assertRaises(EntryQualitySkipped):self.ready()
 def test_missed_candles_not_replayed(self):
  self.ready();self.bar(960,100,101,99,101);self.bar(1020,100,101,99,101)
  with self.assertRaises(EntryQualitySkipped):self.ready()
 def test_missing_matching_signal_rejected(self):
  self.runner.run['observations']=[]
  with self.assertRaises(EntryQualitySkipped):self.ready()

class ConfirmationPlanTests(unittest.TestCase):
 setUp=test_automatic_plan.AutomaticPlanTests.setUp
 def test_confirm_uses_market_and_forces_live_holding(self):
  self.settings.update(entry='CONFIRM',hold_breakout=False);self.body['retest_level']=1.099
  result=self.terminal.condition_plan(self.body);self.assertEqual(result['order_kind'],'MARKET');self.assertTrue(result['calculation']['hold_breakout']);self.assertIsNone(result['calculation']['expires_at']);self.mt.order_send.assert_not_called()

class SetupPerformanceTests(unittest.TestCase):
 def test_deduplicates_and_excludes_missing_risk_from_r_average(self):
  trades=[dict(id='1',entry_order=11,net=20),dict(id='2',entry_order=22,net=-10)]
  entries=[dict(position='1',result=dict(order=11),setup=dict(rows=[dict(rule='BOS_UP')],settings=dict(autoPlan=dict(entry='RETEST')),automatic_plan=dict(modeled_loss=10))),dict(position='2',result=dict(order=22),setup=dict(rows=[dict(rule='BOS_DOWN')],settings=dict(autoPlan=dict(entry='RETEST'))))]
  summary=setup_performance(trades,entries+entries);self.assertEqual(len(summary),1);row=summary[0];self.assertEqual(row['trades'],2);self.assertEqual(row['net'],10);self.assertEqual(row['r_count'],1);self.assertEqual(row['average_r'],2);self.assertEqual(row['win_rate'],50)
 def test_wrong_order_and_unlinked_trade_not_counted(self):
  self.assertEqual(setup_performance([dict(id='1',entry_order=11,net=20)],[dict(position='1',result=dict(order=99))]),[])

class ConfirmationRunnerIntegrationTests(unittest.TestCase):
 def setUp(self):
  import test_condition_monitor
  test_condition_monitor.MonitorTests.setUp(self)
  self.body['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M1',sensitivity=1)]
  self.body['settings'].update(action='AUTO',autoPlan=dict(enabled=True,entry='CONFIRM',timeframe='M1',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=1,hold_breakout=True))
  values=[99,102,100,103,99,102,100,101,101]
  self.terminal.bars=[[int((480+i*60)*1000),value,value+.2,value-.2,value,1] for i,value in enumerate(values)]
  self.terminal.bid=101;self.monitor.start(self.body)
  self.run=self.monitor.run;self.run['sequence'].done=True;self.run['sequence'].index=1
  self.run['observations']=[dict(type='passed',index=0,structure=dict(direction=1,level=100,candle=dict(time=900,open=100,high=102,low=100,close=101)))]
 def test_complete_sequence_waits_then_submits_once_after_rejection(self):
  self.now+=2;self.monitor.tick();self.assertEqual(self.run['phase'],'running');self.assertFalse(self.run['attempted']);self.assertEqual(self.terminal.sent,[])
  self.terminal.bars[-1]=[960000,100,102,99.5,101,1];self.terminal.bars.append([1020000,101,102,100,101,1]);self.now+=20
  self.monitor.tick();self.assertEqual(self.run['phase'],'finished');self.assertEqual(len(self.terminal.sent),1)
  self.now+=2;self.monitor.tick();self.assertEqual(len(self.terminal.sent),1)
 def test_invalidation_still_cancels_confirmation_wait(self):
  self.now+=2;self.monitor.tick();self.run['invalidation']=dict(enabled=True,direction='BELOW',level=95)
  self.terminal.bid=94;self.now+=2;self.monitor.tick();self.assertEqual(self.run['phase'],'invalidated');self.assertEqual(self.terminal.sent,[])

if __name__=='__main__':unittest.main()
