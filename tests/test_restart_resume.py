import copy,json,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
import test_condition_monitor
from condition_monitor import ConditionMonitor
from restart_resume import RestartPolicy

class SafeRestartTests(unittest.TestCase):
 def setUp(self):
  test_condition_monitor.MonitorTests.setUp(self)
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)/'setups.json';self.policy=RestartPolicy(Path(self.temp.name)/'restart-resume.json');self.policy.configure(True)
  self.monitor=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=self.path,resume_policy=self.policy);self.body['settings']['action']='AUTO'
 advance=test_condition_monitor.MonitorTests.advance
 def restore(self,seconds=2):
  self.now+=seconds
  return ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=self.path,resume_policy=RestartPolicy(self.policy.path))
 def clean(self):self.monitor.close()
 def test_progress_resumes_once_and_never_trades_on_recovery_poll(self):
  self.body['rows'].append(dict(rule='TRADED_ABOVE',mode='LIVE',timeframe='M1',level=200));original=self.monitor.start(self.body)['run']['id'];self.advance(101);self.assertEqual(self.monitor.run['sequence'].index,1)
  self.clean();restored=self.restore();self.assertEqual(restored.run['phase'],'resuming');self.assertFalse(json.loads(self.path.read_text())['records'][0]['restart']['ready'])
  restored.tick();self.assertEqual(restored.run['phase'],'running');self.assertEqual(restored.run['sequence'].index,1);self.assertEqual(restored.run['id'],original);self.assertEqual(self.terminal.sent,[])
  self.now+=2;self.terminal.bid=201;restored.tick();self.assertEqual(len(self.terminal.sent),1);restored.tick();self.assertEqual(len(self.terminal.sent),1)
 def test_second_startup_cannot_reuse_consumed_checkpoint(self):
  self.monitor.start(self.body);self.clean();one=self.restore();two=self.restore();self.assertEqual(one.run['phase'],'resuming');self.assertEqual(two.run['phase'],'saved');one.tick();self.assertEqual(one.run['phase'],'running');self.assertEqual(self.terminal.sent,[])
 def test_crash_without_clean_handoff_stays_disarmed(self):
  self.monitor.start(self.body);restored=self.restore();self.assertEqual(restored.run['phase'],'saved');restored.tick();self.assertEqual(self.terminal.sent,[])
 def test_disabled_policy_is_manual_only(self):
  self.policy.configure(False);self.monitor.start(self.body);self.clean();self.assertEqual(self.restore().run['phase'],'saved')
 def test_long_restart_stays_disarmed(self):
  self.monitor.start(self.body);self.clean();restored=self.restore(31);self.assertEqual(restored.run['phase'],'saved');self.assertIn('30 seconds',restored.run['message'])
 def test_wrong_account_blocks_resume(self):
  self.monitor.start(self.body);self.clean();restored=self.restore();self.terminal.account.login=456;restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertEqual(self.terminal.sent,[])
 def test_stale_quote_waits_then_disarms_at_deadline(self):
  self.monitor.start(self.body);self.clean();restored=self.restore();self.terminal.delta=-40;restored.tick();self.assertEqual(restored.run['phase'],'resuming');self.now+=31;restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertEqual(self.terminal.sent,[])
 def test_new_quote_is_required_before_resume(self):
  self.monitor.start(self.body);self.clean();restored=self.restore(0);restored.tick();self.assertEqual(restored.run['phase'],'resuming');self.now+=2;restored.tick();self.assertEqual(restored.run['phase'],'running')
 def candle_setup(self):
  self.body['rows']=[dict(rule='CLOSE_ABOVE',mode='CANDLE',timeframe='M1',level=200)];self.terminal.bars=[[840000,99,100,98,99,1],[900000,99,100,98,99,1],[960000,99,100,98,99,1]];self.monitor.start(self.body)
 def test_unchanged_required_candle_resumes(self):
  self.candle_setup();self.clean();restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'running')
 def test_new_closed_candle_blocks_resume(self):
  self.candle_setup();self.clean();self.terminal.bars.append([1020000,99,100,98,99,1]);restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertIn('candle',restored.run['message'])
 def test_revised_closed_candle_blocks_resume(self):
  self.candle_setup();self.clean();self.terminal.bars[-2][4]=99.5;restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertIn('revised',restored.run['message'])
 def test_cancellation_level_blocks_resume(self):
  self.body['settings']['invalidation']=dict(enabled=True,source='LEVEL',direction='BELOW',level=90);self.monitor.start(self.body);self.clean();self.terminal.bid=89;restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertEqual(self.terminal.sent,[])
 def test_review_is_never_resumed_or_token_persisted(self):
  self.body['settings']['action']='REVIEW';self.monitor.start(self.body);self.advance(101);token=self.monitor.run['review']['preview'];self.clean();self.assertNotIn(token,self.path.read_text());self.assertEqual(self.restore().run['phase'],'saved')
 def test_uncertain_submission_is_never_resumed(self):
  self.monitor.start(self.body);self.monitor.run.update(phase='finishing',attempted=True,sent=True,_submission_intent=True);self.monitor._persist();self.clean();restored=self.restore();self.assertEqual(restored.run['phase'],'saved');self.assertTrue(restored.run['saved']['uncertain'])
 def test_user_stop_during_resume_prevents_reactivation(self):
  self.monitor.start(self.body);self.clean();restored=self.restore();restored.stop({'all':True});restored.tick();self.assertEqual(restored.run['phase'],'stopped');self.assertEqual(self.terminal.sent,[])
 def test_turning_option_off_disarms_only_checking_candidates(self):
  self.monitor.start(self.body);self.clean();restored=self.restore();restored.configure_restart_resume({'enabled':False});restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertEqual(self.terminal.sent,[])
 def test_checkpoint_corruption_fails_closed(self):
  self.monitor.start(self.body);self.clean();data=json.loads(self.path.read_text());data['records'][0]['restart']['sequence']['index']=1;self.path.write_text(json.dumps(data));restored=self.restore();self.assertEqual(restored.run['phase'],'saved');self.assertIn('integrity',restored.run['message'])
 def test_exclusive_claim_failure_does_not_arm(self):
  self.monitor.start(self.body);self.clean();self.path.with_name(self.path.name+'.resume-claim').write_text('owned elsewhere');restored=self.restore();self.assertEqual(restored.run['phase'],'saved');self.assertIn('consumed',restored.resume_warning)
 def test_checkpoint_save_failure_leaves_manual_configuration(self):
  self.monitor.start(self.body)
  with patch.object(self.monitor.store,'save',side_effect=OSError('disk full')):self.clean()
  self.assertEqual(self.restore().run['phase'],'saved')
 def test_recorded_execution_blocks_an_old_checkpoint(self):
  from journal import Journal
  from types import SimpleNamespace
  run=self.monitor.start(self.body)['run'];self.clean();journal=Journal(Path(self.temp.name)/'journal.sqlite3')
  setup=dict(monitor_id=run['id'],name=run['name'],settings=run['settings'],rows=run['rows'],started=run['started'],invalidation=run['invalidation'])
  journal.record_condition_entry('already-submitted',123,'Demo','USD',dict(setup=setup,request=dict(symbol=run['symbol']),result=dict(retcode=10009,order='42',deal='43'),demo=False))
  self.terminal.bridge=SimpleNamespace(journal=journal);restored=self.restore();self.assertEqual(restored.run['phase'],'saved');self.assertIn('already in the journal',restored.run['message']);self.assertEqual(self.terminal.sent,[])
 def test_confirmation_wait_progress_survives_clean_restart(self):
  self.body['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M1',sensitivity=1)];self.body['settings']['autoPlan']=dict(enabled=True,entry='CONFIRM',timeframe='M1',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=30)
  self.terminal.bars=[[840000,99,100,98,99,1],[900000,99,100,98,99,1],[960000,99,100,98,99,1]];self.monitor.start(self.body)
  run=self.monitor.run;run['sequence'].index=1;run['sequence'].done=True;run['sequence'].tracker=None
  run['observations']=[dict(type='passed',index=0,structure=dict(direction=1,level=100,candle=dict(time=900,open=99,high=100,low=98,close=99)))]
  run['retest_confirmation']=dict(level=100,direction=1,timeframe='M1',last_candle=900,last_bar=dict(time=900,open=99,high=100,low=98,close=99,volume=1),expires=self.now+300,touched=True,message='Waiting for rejection')
  self.clean();restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'running');self.assertTrue(restored.run['retest_confirmation']['touched']);self.assertEqual(restored.run['sequence'].index,1);self.assertEqual(self.terminal.sent,[])
 def test_expired_confirmation_window_stays_disarmed(self):
  self.body['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M1',sensitivity=1)];self.body['settings']['autoPlan']=dict(enabled=True,entry='CONFIRM',timeframe='M1',sensitivity=1,buffer=10,rr=2,risk=.5,expiry=1)
  self.terminal.bars=[[900000,99,100,98,99,1],[960000,99,100,98,99,1]];self.monitor.start(self.body)
  run=self.monitor.run;run['sequence'].index=1;run['sequence'].done=True;run['sequence'].tracker=None;run['observations']=[dict(type='passed',index=0,structure=dict(direction=1,level=100))]
  run['retest_confirmation']=dict(level=100,direction=1,timeframe='M1',last_candle=900,last_bar=dict(time=900,open=99,high=100,low=98,close=99),expires=self.now+1,touched=False)
  self.clean();restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'saved');self.assertIn('expired',restored.run['message'])
 def test_structural_tracker_roundtrip_preserves_pivot_aliases(self):
  self.body['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M1',sensitivity=1)]
  values=[99,102,100,103,101,104,102,105,103]
  self.terminal.bars=[[int((480+i*60)*1000),price,price+.2,price-.2,price,1] for i,price in enumerate(values)]
  self.monitor.start(self.body);before=self.monitor.run['sequence'].tracker.snapshot('BOS_UP');self.clean();restored=self.restore();restored.tick();self.assertEqual(restored.run['phase'],'running');tracker=restored.run['sequence'].tracker;self.assertEqual(tracker.snapshot('BOS_UP'),before)
  aliases=0
  for name in ('last_pivot','protected_high','protected_low'):
   pivot=getattr(tracker,name)
   if pivot:
    match=next((item for item in tracker.highs+tracker.lows if item==pivot),None)
    if match is not None:self.assertIs(match,pivot);aliases+=1
  self.assertGreater(aliases,0)

if __name__=='__main__':unittest.main()
