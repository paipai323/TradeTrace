import copy
import json
import unittest
import test_condition_monitor
from condition_monitor import MonitorInterruption


class InterruptionRecoveryTests(unittest.TestCase):
    def setUp(self):
        test_condition_monitor.MonitorTests.setUp(self)
        self.body['settings']['action']='AUTO'
    advance=test_condition_monitor.MonitorTests.advance

    def test_poll_gap_reports_possible_sleep_but_never_resumes(self):
        self.monitor.start(self.body);self.advance(101,seconds=40)
        run=self.monitor.status()['run'];info=run['interruption']
        self.assertEqual(run['phase'],'stopped');self.assertEqual(info['kind'],'poll_gap');self.assertEqual(info['last_quote_time'],1000)
        self.assertEqual(info['gap_seconds'],40);self.assertIn('possible',run['message']);self.assertTrue(info['ready'])
        for _ in range(5):self.advance(110,seconds=12)
        self.assertEqual(self.terminal.sent,[]);self.assertEqual(self.monitor.status()['run']['applied']['index'],0)

    def test_stale_quote_restores_connection_without_rearming(self):
        run=self.monitor.start(self.body)['run'];self.terminal.delta=-40;self.advance(101)
        self.assertEqual(self.monitor.run['interruption']['kind'],'stale_quote');self.assertFalse(self.monitor.run['interruption']['ready'])
        self.terminal.delta=0;result=self.monitor.recovery({'id':run['id']})['run']
        self.assertTrue(result['interruption']['ready']);self.assertEqual(result['phase'],'stopped');self.assertEqual(self.terminal.sent,[])
        self.advance(110);self.assertEqual(self.terminal.sent,[])

    def test_explicit_new_start_is_required_and_restarts_all_steps(self):
        old=self.monitor.start(self.body)['run'];self.advance(101,seconds=40)
        body=copy.deepcopy(self.body);body.update(request_id='explicit-recovery-start',multiple=True,replace_id=old['id'])
        new=self.monitor.start(body)['run'];self.assertNotEqual(new['id'],old['id']);self.assertIsNone(new['interruption']);self.assertEqual(new['applied']['index'],0)
        self.assertEqual(self.terminal.sent,[]);self.advance(102);self.assertEqual(len(self.terminal.sent),1)
        self.assertFalse(self.monitor.status({'id':old['id']})['run']['interruption']['enabled'])

    def test_recovery_rejects_wrong_account_or_disabled_permissions(self):
        run=self.monitor.start(self.body)['run'];self.advance(seconds=40)
        self.terminal.account.login=456;self.monitor.recovery({'id':run['id']});self.assertFalse(self.monitor.run['interruption']['ready'])
        self.terminal.account.login=123;original=self.terminal.market
        self.terminal.market=lambda body:{**original(body),'trading_allowed':False}
        self.monitor.recovery({'id':run['id']});self.assertFalse(self.monitor.run['interruption']['ready']);self.assertEqual(self.terminal.sent,[])

    def test_connection_loss_and_repeated_probes_do_not_duplicate_events(self):
        self.monitor.start(self.body);self.terminal.disconnected=True;self.advance()
        self.assertEqual(self.monitor.run['interruption']['kind'],'connection');count=len(self.monitor.run['events'])
        self.advance(seconds=11);self.advance(seconds=11);self.assertEqual(len(self.monitor.run['events']),count)
        self.terminal.disconnected=False;self.advance(seconds=11)
        self.assertEqual(sum(e['type']=='Connection restored' for e in self.monitor.run['events']),1)
        self.assertEqual(self.terminal.sent,[])

    def test_user_stop_is_not_recoverable_and_stop_all_ends_health_probes(self):
        self.monitor.start(self.body);self.monitor.stop();self.assertIsNone(self.monitor.run['interruption'])
        with self.assertRaises(ValueError):self.monitor.recovery({'id':self.monitor.run['id']})
        self.body['request_id']='another-run';self.monitor.start(self.body);self.advance(seconds=40);self.monitor.stop({'all':True})
        self.assertFalse(self.monitor.run['interruption']['enabled'])
        with self.assertRaises(ValueError):self.monitor.recovery({'id':self.monitor.run['id']})

    def test_review_is_consumed_when_quotes_go_stale(self):
        self.body['settings'].update(action='REVIEW',invalidation=dict(enabled=True,source='LEVEL',direction='BELOW',level=90))
        self.monitor.start(self.body);self.advance(101);token=self.monitor.run['review']['preview']
        self.terminal.delta=-40
        with self.assertRaises(MonitorInterruption):self.monitor.before_submission({'preview':token})
        self.assertNotIn(token,self.terminal.previews);self.assertIsNone(self.monitor.run['review']);self.assertEqual(self.monitor.run['phase'],'stopped')
        self.assertEqual(self.terminal.sent,[])

    def test_independent_setup_recovery_is_not_a_group_entry(self):
        self.body.update(multiple=True,group='scenarios',group_policy='FIRST_ENTRY');one=self.monitor.start(self.body)['run']
        other=copy.deepcopy(self.body);other['request_id']='second-run';other['rows'][0]['level']=200;two=self.monitor.start(other)['run']
        self.now+=40;self.monitor.tick()
        self.monitor.recovery({'id':one['id']});runs=self.monitor.status()['runs']
        self.assertTrue(all(run['phase']=='stopped' for run in runs));self.assertEqual(self.terminal.sent,[])
        self.assertTrue(next(run for run in runs if run['id']==two['id'])['interruption']['enabled'])

    def test_many_interrupted_setups_receive_fair_recovery_checks(self):
        self.body['multiple']=True
        for i in range(8):
            self.body['request_id']='fair-recovery-'+str(i);self.monitor.start(copy.deepcopy(self.body))
        self.advance(seconds=40)
        for _ in range(8):self.advance(seconds=2)
        runs=self.monitor.status()['runs'];self.assertTrue(all(run['interruption']['ready'] for run in runs));self.assertTrue(all(run['phase']=='stopped' for run in runs));self.assertEqual(self.terminal.sent,[])

    def test_invalid_quote_timestamp_keeps_recovery_payload_serializable(self):
        self.monitor.start(self.body);self.terminal.delta=float('nan');self.advance()
        run=self.monitor.status()['run'];self.assertEqual(run['phase'],'stopped');self.assertIsNone(run['interruption']['stale_quote_time'])
        json.dumps(run,allow_nan=False)
