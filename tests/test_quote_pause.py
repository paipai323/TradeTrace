import tempfile,threading,unittest
from pathlib import Path
from types import SimpleNamespace as NS
import test_condition_monitor
from condition_monitor import ConditionMonitor,MonitorInterruption
from keep_awake import KeepAwake
from test_keep_awake import FakePower

class QuotePauseTests(unittest.TestCase):
 def setUp(self):
  test_condition_monitor.MonitorTests.setUp(self);self.body['settings']['action']='AUTO'
 advance=test_condition_monitor.MonitorTests.advance
 def pause(self):self.terminal.delta=-40;self.advance();self.assertEqual(self.monitor.run['phase'],'paused')
 def test_short_gap_recovers_without_order_on_recovery_poll(self):
  self.monitor.start(self.body);self.pause();self.terminal.delta=0;self.advance(101)
  self.assertEqual(self.monitor.run['phase'],'running');self.assertEqual(self.terminal.sent,[]);self.assertEqual(self.monitor.run['sequence'].previous,101)
  self.advance(101);self.assertEqual(len(self.terminal.sent),1)
 def test_no_evaluation_or_send_during_pause(self):
  self.monitor.start(self.body);self.pause()
  for _ in range(20):self.advance(110)
  self.assertEqual(self.monitor.run['sequence'].index,0);self.assertFalse(self.monitor.run['attempted']);self.assertEqual(self.terminal.sent,[])
 def test_window_expiry_requires_explicit_restart(self):
  self.monitor.start(self.body);self.pause()
  for _ in range(61):self.advance(seconds=2)
  self.assertEqual(self.monitor.run['phase'],'stopped');self.assertIn('2-minute',self.monitor.run['message']);self.terminal.delta=0;self.advance(110);self.assertEqual(self.monitor.run['phase'],'stopped');self.assertEqual(self.terminal.sent,[])
 def test_poll_gap_during_pause_still_stops_immediately(self):
  self.monitor.start(self.body);self.pause();self.terminal.delta=0;self.advance(seconds=40)
  self.assertEqual(self.monitor.run['phase'],'stopped');self.assertEqual(self.monitor.run['interruption']['kind'],'poll_gap')
 def test_account_change_blocks_resume(self):
  self.monitor.start(self.body);self.pause();self.terminal.delta=0;self.terminal.account.login=456;self.advance(110)
  self.assertEqual(self.monitor.run['phase'],'stopped');self.assertEqual(self.terminal.sent,[])
 def test_cancellation_checked_before_resuming(self):
  self.body['settings']['invalidation']=dict(enabled=True,source='LEVEL',direction='BELOW',level=90)
  self.monitor.start(self.body);self.pause();self.terminal.delta=0;self.advance(89)
  self.assertEqual(self.monitor.run['phase'],'invalidated');self.assertEqual(self.terminal.sent,[])
 def test_missing_quote_timestamp_is_not_grace_eligible(self):
  self.monitor.start(self.body);self.terminal.delta=float('nan');self.advance();self.assertEqual(self.monitor.run['phase'],'stopped')
 def test_future_quote_timestamp_stops_instead_of_grace(self):
  self.monitor.start(self.body);self.terminal.delta=100;self.advance();self.assertEqual(self.monitor.run['phase'],'stopped')
 def test_connection_failure_during_pause_stops(self):
  self.monitor.start(self.body);self.pause();self.terminal.disconnected=True;self.advance();self.assertEqual(self.monitor.run['phase'],'stopped')
 def candle_setup(self):
  self.body['rows']=[dict(rule='CLOSE_ABOVE',mode='CANDLE',timeframe='M1',level=200)]
  self.terminal.bars=[[840000,99,100,98,99,1],[900000,99,100,98,99,1],[960000,99,100,98,99,1]]
  self.monitor.start(self.body)
 def test_candle_recovers_only_with_same_last_closed_candle(self):
  self.candle_setup();self.pause();self.terminal.delta=0;self.advance();self.assertEqual(self.monitor.run['phase'],'running');self.assertEqual(self.terminal.sent,[])
 def test_required_candle_closing_in_gap_stops_without_replay(self):
  self.candle_setup();self.pause();self.terminal.delta=0;self.terminal.bars.append([1020000,99,100,98,99,1]);self.advance(seconds=20)
  self.assertEqual(self.monitor.run['phase'],'stopped');self.assertEqual(self.monitor.run['interruption']['kind'],'missed_candles');self.assertEqual(self.terminal.sent,[])
 def test_structure_uses_tracker_last_observed_candle(self):
  self.candle_setup();self.monitor.run['sequence'].tracker=NS(last_time=900);self.monitor.run['sequence'].candle=840
  self.pause();self.terminal.delta=0;self.advance();self.assertEqual(self.monitor.run['phase'],'running')
 def test_sweep_memory_is_not_replayed_across_quote_gap(self):
  self.body['rows'][0]['rule']='SWEEP_ABOVE_REJECT';self.monitor.start(self.body);self.advance(101);self.assertTrue(self.monitor.run['sequence'].memory['above'])
  self.pause();self.terminal.delta=0;self.advance(99);self.advance(99);self.assertEqual(self.terminal.sent,[])
  self.advance(101);self.advance(99);self.assertEqual(len(self.terminal.sent),1)
 def test_configured_gap_reset_still_resets_unfinished_steps(self):
  self.body['rows'].append(dict(rule='TRADED_ABOVE',mode='LIVE',timeframe='M1',level=200));self.body['settings']['gap']=10
  self.monitor.start(self.body);self.advance(101);self.assertEqual(self.monitor.run['sequence'].index,1);self.pause()
  for _ in range(6):self.advance()
  self.terminal.delta=0;self.advance();self.assertEqual(self.monitor.run['phase'],'running');self.assertEqual(self.monitor.run['sequence'].index,0);self.assertEqual(self.terminal.sent,[])
 def test_retest_window_expiry_is_not_extended_by_quote_pause(self):
  self.monitor.start(self.body);self.monitor.run['retest_confirmation']=dict(timeframe='M1',last_candle=900,expires=self.now+5);self.pause();self.advance(seconds=4)
  self.assertEqual(self.monitor.run['phase'],'skipped');self.assertEqual(self.terminal.sent,[])
 def test_stop_and_keep_awake_remain_functional_while_paused(self):
  backend=FakePower();self.monitor.keep_awake=KeepAwake(backend=backend);self.monitor.start(self.body);self.pause();self.assertTrue(self.monitor.status()['keep_awake']['requested'])
  self.monitor.stop({'all':True});self.assertEqual(self.monitor.run['phase'],'stopped');self.assertFalse(self.monitor.status()['keep_awake']['requested'])
 def test_restored_pause_is_disarmed_not_auto_resumed(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'setups.json';self.monitor=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=path);self.monitor.start(self.body);self.pause()
   restored=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=path);self.assertEqual(restored.run['phase'],'saved');self.assertEqual(self.terminal.sent,[])
 def test_review_without_cancellation_guard_stops_on_stale_quote(self):
  self.body['settings']['action']='REVIEW';self.monitor.start(self.body);self.advance(101);token=self.monitor.run['review']['preview'];self.terminal.delta=-40;self.advance()
  self.assertEqual(self.monitor.run['phase'],'stopped');self.assertNotIn(token,self.terminal.previews);self.assertEqual(self.terminal.sent,[])
 def test_review_without_cancellation_guard_rejects_sleep_gap_on_submit(self):
  self.body['settings']['action']='REVIEW';self.monitor.start(self.body);self.advance(101);token=self.monitor.run['review']['preview'];self.now+=40
  with self.assertRaises(ValueError):self.monitor.before_submission({'preview':token})
  self.assertEqual(self.monitor.run['phase'],'stopped');self.assertNotIn(token,self.terminal.previews);self.assertEqual(self.terminal.sent,[])
 def test_attempted_order_is_never_grace_resumed(self):
  self.monitor.start(self.body);runner=self.monitor.runners[self.monitor.run['id']];self.monitor.run.update(attempted=True,sent=True)
  runner._pause_quote(MonitorInterruption('Quote is stale.','stale_quote',self.now-40));self.assertEqual(self.monitor.run['phase'],'finished');self.assertEqual(self.terminal.sent,[])

if __name__=='__main__':unittest.main()
