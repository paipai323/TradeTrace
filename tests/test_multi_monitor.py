import copy
import threading
import unittest
import test_condition_monitor
import test_terminal


class MultipleMonitorTests(unittest.TestCase):
    def setUp(self):
        test_condition_monitor.MonitorTests.setUp(self)
        self.serial=0
    advance=test_condition_monitor.MonitorTests.advance

    def start(self,level=100,action='AUTO',**options):
        self.serial+=1;body=copy.deepcopy(self.body)
        body.update(request_id=f'independent-{self.serial}',multiple=True,**options)
        body['rows'][0]['level']=level;body['settings']['action']=action
        return self.monitor.start(body)['run']

    def states(self):return {r['id']:r for r in self.monitor.status()['runs']}

    def test_same_symbol_independent_progress_and_entries(self):
        a=self.start(100);b=self.start(105)
        self.advance(101);states=self.states()
        self.assertEqual(states[a['id']]['phase'],'finished');self.assertEqual(states[b['id']]['phase'],'running')
        self.advance(106);self.assertEqual(len(self.terminal.sent),2)
        self.assertNotEqual(self.terminal.prepared[0]['condition_monitor_id'],self.terminal.prepared[1]['condition_monitor_id'])
        self.assertEqual(self.terminal.prepared[0]['condition_setup']['monitor_id'],a['id'])
        for _ in range(3):self.advance(110)
        self.assertEqual(len(self.terminal.sent),2)

    def test_simultaneous_linked_first_entry_stops_siblings(self):
        a=self.start(group='alternatives',group_policy='FIRST_ENTRY');b=self.start(group='alternatives',group_policy='FIRST_ENTRY');c=self.start(group='other',group_policy='FIRST_ENTRY')
        self.advance(101);states=self.states();self.assertEqual(len(self.terminal.sent),2)
        self.assertEqual(states[b['id']]['phase'],'stopped');self.assertEqual(states[c['id']]['phase'],'finished')

    def test_groups_do_not_cross_symbols_and_all_policy_allows_entries(self):
        self.start(group='group',group_policy='FIRST_ENTRY');self.start(group='group',group_policy='FIRST_ENTRY',symbol='OTHER')
        self.start(group='all');self.start(group='all');self.advance(101)
        self.assertEqual(len(self.terminal.sent),4)

    def test_reviews_independent_and_linked_confirmation_cancels_other_tokens(self):
        a=self.start(action='REVIEW',group='review',group_policy='FIRST_ENTRY');b=self.start(action='REVIEW',group='review',group_policy='FIRST_ENTRY')
        self.advance(101);states=self.states();one=states[a['id']]['review']['preview'];two=states[b['id']]['review']['preview']
        self.assertNotEqual(one,two)
        body=dict(preview=one);self.monitor.before_submission(body);result=self.terminal.submit(body);self.monitor.record_submission(body,result=result)
        self.assertEqual(self.states()[b['id']]['phase'],'stopped');self.assertNotIn(two,self.terminal.previews)

    def test_stop_selected_and_stop_all_remove_reviews(self):
        a=self.start(action='REVIEW');b=self.start(action='REVIEW');self.advance(101)
        self.monitor.stop({'id':a['id']});self.assertEqual(self.states()[b['id']]['phase'],'review')
        self.monitor.stop({'all':True,'id':a['id']});self.assertEqual(self.terminal.previews,{})
        self.advance(110);self.assertEqual(self.terminal.sent,[])

    def test_unscoped_stop_clears_all_reviews_like_stop_intent(self):
        self.start(action='REVIEW');self.start(action='REVIEW');self.advance(101)
        self.monitor.signal_stop({});self.monitor.stop({})
        self.assertEqual(self.terminal.previews,{})
        self.assertTrue(all(r['phase']=='stopped' for r in self.states().values()))

    def test_restart_only_selected_and_invalid_restart_preserves_every_run(self):
        a=self.start();b=self.start();c=self.start(replace_id=a['id']);states=self.states()
        self.assertEqual(states[a['id']]['phase'],'stopped');self.assertEqual(states[b['id']]['phase'],'running')
        with self.assertRaises(ValueError):self.start(replace_id=b['id'],group_policy='FIRST_ENTRY')
        self.assertEqual(self.states()[b['id']]['phase'],'running');self.assertEqual(self.states()[c['id']]['phase'],'running')

    def test_invalidates_only_its_own_setup(self):
        self.body['settings']['invalidation']=dict(enabled=True,source='LEVEL',direction='BELOW',level=98)
        a=self.start();self.body['settings']['invalidation']['level']=90;b=self.start()
        self.advance(97);self.assertEqual(self.states()[a['id']]['phase'],'invalidated');self.assertEqual(self.states()[b['id']]['phase'],'running')

    def test_unknown_submission_stops_linked_setups_without_retry(self):
        self.terminal.failure='Execution outcome unknown';self.start(group='group',group_policy='FIRST_ENTRY');b=self.start(group='group',group_policy='FIRST_ENTRY')
        self.advance(101);self.assertEqual(len(self.terminal.sent),1);self.assertEqual(self.states()[b['id']]['phase'],'stopped')
        self.assertIn('uncertain',self.states()[b['id']]['message'])

    def test_account_change_stops_all_without_entry(self):
        self.start();self.start(symbol='OTHER');self.terminal.account.login=456;self.advance(101)
        self.assertTrue(all(r['phase']=='stopped' for r in self.states().values()));self.assertEqual(self.terminal.sent,[])

    def test_stop_all_during_slow_preview_cancels_every_setup(self):
        self.start();self.start();entered=threading.Event();release=threading.Event();original=self.terminal.preview
        def preview(body):entered.set();release.wait(2);return original(body)
        self.terminal.preview=preview;self.terminal.bid=101;self.now+=2
        thread=threading.Thread(target=self.monitor.tick);thread.start();self.assertTrue(entered.wait(1))
        self.monitor.signal_stop({'all':True});release.set();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(self.terminal.sent,[])
        self.assertTrue(all(r['phase']=='stopped' for r in self.states().values()))

    def test_start_retry_returns_original_run_without_rearming(self):
        a=self.start();original=copy.deepcopy(self.body);original.update(request_id='independent-1',multiple=True);original['settings']['action']='AUTO'
        self.start();self.advance(101);self.monitor.start(original)
        self.assertEqual(len(self.terminal.sent),2);self.assertEqual(self.monitor.status({'id':a['id']})['run']['phase'],'finished')

    def test_active_limit_and_group_policy_mismatch(self):
        self.start(group='group',group_policy='FIRST_ENTRY')
        with self.assertRaisesRegex(ValueError,'same group policy'):self.start(group='group')
        for _ in range(19):self.start()
        with self.assertRaisesRegex(ValueError,'20 setups'):self.start()


class PerMonitorCooldownTests(unittest.TestCase):
    def setUp(self):
        test_terminal.TerminalTests.setUp(self)
        self.body.update(condition_entry=True,expected_account='123',expected_server='Demo')

    def test_distinct_monitors_same_symbol_can_enter_and_same_monitor_cannot_repeat(self):
        for monitor_id in ('a'*32,'b'*32):
            self.body['condition_monitor_id']=monitor_id;self.terminal.submit(self.terminal.preview(self.body))
        self.assertEqual(self.mt.order_send.call_count,2)
        with self.assertRaisesRegex(ValueError,'last 60 seconds'):self.terminal.submit(self.terminal.preview(self.body))
        self.assertEqual(self.mt.order_send.call_count,2)
