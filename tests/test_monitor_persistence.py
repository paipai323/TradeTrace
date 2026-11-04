import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import test_condition_monitor
from condition_monitor import ConditionMonitor


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        test_condition_monitor.MonitorTests.setUp(self)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)/'setups.json'
        self.monitor=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=self.path)
        self.body['settings']['action']='AUTO'
    advance=test_condition_monitor.MonitorTests.advance

    def restore(self):return ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now,storage_path=self.path)

    def test_running_auto_restores_disarmed_with_all_steps_reset(self):
        self.body['rows']*=2;self.body.update(name='Gold scenarios',group='alternatives',group_policy='FIRST_ENTRY')
        original=self.monitor.start(self.body)['run'];self.advance(101)
        restored=self.restore();run=restored.status()['run']
        self.assertEqual(run['id'],original['id']);self.assertEqual(run['phase'],'saved');self.assertEqual(run['applied']['index'],0);self.assertEqual(run['settings'],original['settings'])
        self.assertEqual((run['name'],run['group']),('Gold scenarios','alternatives'));self.assertIsNone(run['review']);self.assertEqual(run['observations'],[])
        self.now+=100;restored.tick();self.assertEqual(self.terminal.sent,[]);self.assertFalse(restored.run['attempted'])

    def test_graceful_shutdown_preserves_running_configuration(self):
        self.monitor.start(self.body);self.monitor.close();restored=self.restore()
        self.assertEqual(restored.run['phase'],'saved');self.assertEqual(self.terminal.sent,[])

    def test_review_token_and_progress_are_not_stored(self):
        self.body['settings']['action']='REVIEW';self.monitor.start(self.body);self.advance(101)
        token=self.monitor.run['review']['preview'];self.assertNotIn(token,self.path.read_text())
        self.monitor.close();restored=self.restore();self.assertIsNone(restored.run['review']);self.assertEqual(restored.run['sequence'].index,0)
        self.assertNotIn(token,self.terminal.previews)

    def test_empty_auto_setup_never_executes_after_load(self):
        self.body['rows']=[];self.monitor.start(self.body)
        restored=self.restore();restored.tick();self.assertEqual(self.terminal.sent,[]);self.assertEqual(restored.run['phase'],'saved')

    def test_explicit_stop_and_dismiss_remove_from_next_restart(self):
        self.monitor.start(self.body);self.monitor.stop();self.assertIsNone(self.restore().run)
        self.body['request_id']='saved-again';self.monitor.start(self.body);restored=self.restore();restored.stop({'all':True})
        self.assertIsNone(self.restore().run)

    def test_completion_is_not_restored_as_waiting(self):
        self.monitor.start(self.body);self.advance(101);self.assertEqual(len(self.terminal.sent),1);self.assertIsNone(self.restore().run)

    def test_previous_frozen_cancellation_survives_without_reusing_progress(self):
        self.body['settings']['invalidation']=dict(enabled=True,source='LEVEL',direction='BELOW',level=90)
        self.monitor.start(self.body);run=self.restore().status()['run']
        self.assertEqual(run['invalidation']['level'],90);self.assertEqual(run['phase'],'saved');self.assertEqual(run['applied']['index'],0)

    def test_unknown_submission_restores_check_mt5_notice_without_retry(self):
        self.terminal.failure='Execution outcome unknown';self.monitor.start(self.body);self.advance(101)
        restored=self.restore();self.assertEqual(restored.run['phase'],'saved');self.assertTrue(restored.run['saved']['uncertain']);self.assertIn('Check MT5',restored.run['message'])
        restored.tick();self.assertEqual(len(self.terminal.sent),1)

    def test_submission_intent_is_durable_before_order_send(self):
        original=self.terminal.submit
        def submit(body):
            records=json.loads(self.path.read_text())['records'];self.assertTrue(records[0]['uncertain']);self.assertEqual(records[0]['previous_phase'],'finishing')
            return original(body)
        self.terminal.submit=submit;self.monitor.start(self.body);self.advance(101);self.assertEqual(len(self.terminal.sent),1)

    def test_old_start_retry_cannot_rearm_restored_setup(self):
        self.monitor.start(self.body);restored=self.restore();result=restored.start(copy.deepcopy(self.body))
        self.assertEqual(result['run']['phase'],'saved');restored.tick();self.assertEqual(self.terminal.sent,[])

    def test_failed_save_leaves_existing_runner_and_file_unchanged(self):
        first=self.monitor.start(self.body)['run'];before=self.path.read_bytes();other=copy.deepcopy(self.body);other['request_id']='failed-new-start'
        with patch('monitor_store.os.replace',side_effect=OSError('Disk unavailable')):
            with self.assertRaisesRegex(ValueError,'could not be saved'):self.monitor.start(other)
        self.assertEqual(self.monitor.run['id'],first['id']);self.assertEqual(self.monitor.run['phase'],'running');self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(list(self.path.parent.glob('*.tmp-*')),[])

    def test_corrupt_file_is_preserved_and_never_arms_anything(self):
        original=b'{broken';self.path.write_bytes(original);restored=self.restore();self.assertIsNone(restored.run);self.assertTrue(restored.storage_warning)
        restored.tick();self.assertEqual(self.path.read_bytes(),original)
        restored.start(self.body);backups=list(self.path.parent.glob('*.unreadable-backup-*'));self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),original)

    def test_loading_does_not_need_mt5_or_native_broker_calls(self):
        self.monitor.start(self.body)
        with patch.object(self.terminal,'connection',side_effect=AssertionError('Must not connect during restore')),patch.object(self.terminal,'market',side_effect=AssertionError('Must not fetch quotes during restore')):
            restored=self.restore();self.assertEqual(restored.run['phase'],'saved');restored.tick()

    def test_explicit_restart_uses_new_run_id_and_current_start_checks(self):
        old=self.monitor.start(self.body)['run'];restored=self.restore();body=copy.deepcopy(self.body);body.update(request_id='reviewed-new-start',multiple=True,replace_id=old['id'])
        new=restored.start(body)['run'];self.assertNotEqual(new['id'],old['id']);self.assertEqual(new['phase'],'running');self.assertEqual(new['applied']['index'],0)
        self.now+=2;self.terminal.bid=101;restored.tick();self.assertEqual(len(self.terminal.sent),1)

    def test_failed_pre_send_save_aborts_order_and_invalidates_preview(self):
        self.monitor.start(self.body)
        with patch('monitor_store.os.replace',side_effect=OSError('Disk unavailable')):self.advance(101)
        self.assertEqual(self.terminal.sent,[]);self.assertEqual(self.terminal.previews,{});self.assertFalse(self.monitor.run['sent'])

    def test_failed_review_intent_save_consumes_token_without_sending(self):
        self.body['settings']['action']='REVIEW';self.monitor.start(self.body);self.advance(101);token=self.monitor.run['review']['preview']
        with patch('monitor_store.os.replace',side_effect=OSError('Disk unavailable')):
            with self.assertRaises(ValueError):self.monitor.before_submission(dict(preview=token))
        self.assertNotIn(token,self.terminal.previews);self.assertEqual(self.terminal.sent,[])

    def test_account_safety_stop_remains_saved_until_explicitly_dismissed(self):
        self.monitor.start(self.body);self.terminal.account.login=456;self.advance(101)
        restored=self.restore();self.assertEqual(restored.run['phase'],'saved');self.assertEqual(restored.run['account'],'123')
        self.monitor.stop();self.assertIsNone(self.restore().run)

    def test_replacing_unknown_run_does_not_resurrect_old_saved_intent(self):
        self.terminal.failure='Execution outcome unknown';old=self.monitor.start(self.body)['run'];self.advance(101)
        self.terminal.failure=None;body=copy.deepcopy(self.body);body.update(request_id='new-reviewed-setup',multiple=True,replace_id=old['id']);body['rows'][0]['level']=200
        new=self.monitor.start(body)['run'];self.advance(102);restored=self.restore()
        self.assertEqual(list(restored.runners),[new['id']])

    def test_stop_all_dismisses_unknown_outcome_configuration(self):
        self.terminal.failure='Execution outcome unknown';self.monitor.start(self.body);self.advance(101);self.monitor.stop({'all':True})
        self.assertIsNone(self.restore().run)
