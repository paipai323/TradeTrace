import json,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
from keep_awake import KeepAwake
import test_condition_monitor

class FakePower:
 def __init__(self):self.acquired=0;self.released=0;self.source='ac';self.fail_acquire=False;self.fail_release=False
 def acquire(self):
  if self.fail_acquire:raise OSError('Power request denied')
  self.acquired+=1
 def release(self):
  if self.fail_release:raise OSError('Release failed')
  self.released+=1
 def power_source(self):return self.source

class KeepAwakeTests(unittest.TestCase):
 def setUp(self):self.backend=FakePower();self.now=0.;self.awake=KeepAwake(backend=self.backend,clock=lambda:self.now)
 def test_only_one_request_for_multiple_setups(self):
  self.assertEqual(self.awake.update(0)['state'],'idle');self.awake.update(1);self.awake.update(4);self.awake.update(1)
  self.assertEqual(self.backend.acquired,1);self.assertEqual(self.backend.released,0);self.awake.update(0);self.assertEqual(self.backend.released,1)
 def test_disabling_releases_and_persists(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'keep-awake.json';awake=KeepAwake(path,backend=self.backend);awake.update(1);self.assertEqual(awake.configure(False)['state'],'off');self.assertFalse(awake.status()['requested'])
   restored=KeepAwake(path,backend=FakePower());self.assertFalse(restored.enabled);self.assertEqual(restored.update(2)['state'],'off')
   restored.configure(True);self.assertTrue(restored.status()['requested']);restored.close()
 def test_battery_and_unknown_are_not_reported_as_ac_protection(self):
  self.backend.source='battery';state=self.awake.update(1);self.assertEqual(state['state'],'battery');self.assertIn('Plug in',state['message'])
  self.backend.source='unknown';self.assertEqual(self.awake.update(1)['state'],'unknown');self.backend.source='ac';self.assertEqual(self.awake.update(1)['state'],'active')
 def test_acquire_failure_visible_and_retryable(self):
  self.backend.fail_acquire=True;state=self.awake.update(1);self.assertEqual(state['state'],'error');self.assertFalse(state['requested'])
  self.backend.fail_acquire=False;self.assertEqual(self.awake.update(1)['state'],'active')
 def test_release_failure_not_hidden_as_idle(self):
  self.awake.update(1);self.backend.fail_release=True;self.assertEqual(self.awake.update(0)['state'],'error')
  self.backend.fail_release=False;self.assertEqual(self.awake.update(0)['state'],'idle')
 def test_long_gap_recreates_request_without_accumulating_counts(self):
  self.awake.update(1);self.now+=31;self.awake.update(1);self.assertEqual((self.backend.acquired,self.backend.released),(2,1));self.awake.close();self.assertEqual(self.backend.released,2)
 def test_close_is_idempotent_and_cannot_reactivate(self):
  self.awake.update(1);self.awake.close();self.awake.close();state=self.awake.update(9);self.assertFalse(state['requested']);self.assertEqual(state['state'],'closed');self.assertEqual((self.backend.acquired,self.backend.released),(1,1))
 def test_preference_save_failure_keeps_previous_state(self):
  with tempfile.TemporaryDirectory() as folder:
   awake=KeepAwake(Path(folder)/'keep-awake.json',backend=self.backend);awake.update(1)
   with patch('keep_awake.os.replace',side_effect=OSError('Disk unavailable')):
    with self.assertRaises(OSError):awake.configure(False)
   self.assertTrue(awake.enabled);self.assertTrue(awake.status()['requested']);awake.close()
 def test_invalid_setting_rejected(self):
  for value in ('false',None,1):
   with self.assertRaises(ValueError):self.awake.configure(value)
 def test_unreadable_preference_uses_enabled_and_reports_problem(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'keep-awake.json';path.write_text('bad json');awake=KeepAwake(path,backend=self.backend);self.assertTrue(awake.enabled);self.assertTrue(awake.status()['preference_error'])

class MonitorKeepAwakeTests(unittest.TestCase):
 def setUp(self):
  test_condition_monitor.MonitorTests.setUp(self);self.backend=FakePower();self.awake=KeepAwake(backend=self.backend);self.monitor.keep_awake=self.awake
 def test_start_and_completion_hold_then_release(self):
  self.monitor.start(self.body);self.assertTrue(self.awake.status()['requested']);self.now+=2;self.terminal.bid=101;self.monitor.tick();self.assertFalse(self.awake.status()['requested'])
 def test_review_stays_awake_until_stopped(self):
  self.body['settings']['action']='REVIEW';self.monitor.start(self.body);self.now+=2;self.terminal.bid=101;self.monitor.tick();self.assertEqual(self.monitor.run['phase'],'review');self.assertTrue(self.awake.status()['requested'])
  self.monitor.stop({'all':True});self.assertFalse(self.awake.status()['requested']);self.assertEqual(self.terminal.sent,[])
 def test_retest_wait_remains_awake_and_shutdown_releases(self):
  self.monitor.start(self.body);self.monitor.run['retest_confirmation']={'message':'Waiting for rejection'};self.monitor.status();self.assertTrue(self.awake.status()['requested']);self.monitor.close();self.assertFalse(self.awake.status()['requested'])
 def test_restored_saved_setup_does_not_acquire_request(self):
  from condition_monitor import ConditionMonitor
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'setups.json';monitor=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=path,keep_awake=self.awake)
   monitor.start(self.body);monitor.close();backend=FakePower();restored=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=path,keep_awake=KeepAwake(backend=backend))
   status=restored.status();self.assertEqual(status['run']['phase'],'saved');self.assertEqual(status['keep_awake']['state'],'idle');self.assertEqual(backend.acquired,0)
 def test_worker_failure_releases_request(self):
  from unittest.mock import Mock
  self.monitor.start(self.body);self.monitor.interval=.001;self.monitor._tick=Mock(side_effect=RuntimeError('test worker failure'))
  with patch('threading.excepthook') as hook:
   self.monitor.launch();self.monitor.thread.join(2);self.assertFalse(self.monitor.thread.is_alive());hook.assert_called_once()
  self.assertFalse(self.awake.status()['requested']);self.assertEqual(self.awake.status()['state'],'closed')
 def test_configuration_does_not_start_stop_or_send(self):
  original=self.monitor.start(self.body)['run']['id'];self.monitor.configure_keep_awake({'enabled':False});self.assertEqual(self.monitor.run['id'],original);self.assertEqual(self.monitor.run['phase'],'running');self.assertEqual(self.terminal.sent,[])
  self.monitor.configure_keep_awake({'enabled':True});self.assertTrue(self.awake.status()['requested'])
 def test_native_failure_does_not_claim_protection_or_change_orders(self):
  self.backend.fail_acquire=True;result=self.monitor.start(self.body);self.assertEqual(result['run']['phase'],'running');self.assertEqual(result['keep_awake']['state'],'error');self.assertEqual(self.terminal.sent,[])

class WindowsRequestAbiTests(unittest.TestCase):
 def setUp(self):
  import os
  if os.name!='nt':self.skipTest('Windows API binding check')
  from unittest.mock import Mock
  self.kernel=Mock();self.kernel.PowerCreateRequest.return_value=123;self.kernel.PowerSetRequest.return_value=1;self.kernel.PowerClearRequest.return_value=1;self.kernel.CloseHandle.return_value=1
 def test_requests_system_and_execution_never_display(self):
  from keep_awake import WindowsPowerRequest
  with patch('ctypes.WinDLL',return_value=self.kernel):
   request=WindowsPowerRequest();request.acquire();request.acquire();self.assertEqual([call.args[1] for call in self.kernel.PowerSetRequest.call_args_list],[1,3]);request.release();request.release()
   self.assertEqual([call.args[1] for call in self.kernel.PowerClearRequest.call_args_list],[3,1]);self.kernel.CloseHandle.assert_called_once_with(123)
 def test_partial_acquire_failure_clears_and_closes_handle(self):
  import ctypes
  from keep_awake import WindowsPowerRequest
  def set_request(handle,kind):
   if kind==3:ctypes.set_last_error(5);return 0
   return 1
  self.kernel.PowerSetRequest.side_effect=set_request
  with patch('ctypes.WinDLL',return_value=self.kernel):
   request=WindowsPowerRequest()
   with self.assertRaises(OSError):request.acquire()
   self.assertIsNone(request.handle);self.kernel.PowerClearRequest.assert_called_once_with(123,1);self.kernel.CloseHandle.assert_called_once_with(123)

if __name__=='__main__':unittest.main()
