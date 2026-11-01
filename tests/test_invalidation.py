import copy
import unittest
import test_condition_monitor
import test_terminal
from terminal import ConditionInvalidated


class InvalidationTests(unittest.TestCase):
    def setUp(self):
        test_condition_monitor.MonitorTests.setUp(self)
        self.body['settings']['invalidation']=dict(enabled=True,source='LEVEL',direction='BELOW',level=98)
    advance=test_condition_monitor.MonitorTests.advance

    def test_guard_takes_priority_and_never_rearms(self):
        self.body['rows'][0].update(rule='TRADED_BELOW',level=99)
        self.body['settings']['action']='AUTO';self.monitor.start(self.body);self.advance(98)
        state=self.monitor.status()['run'];self.assertEqual(state['phase'],'invalidated');self.assertEqual(state['applied']['index'],0)
        self.assertEqual(state['invalidation_trigger']['bid'],98);self.assertEqual(self.terminal.sent,[])
        self.advance(101);self.assertEqual(self.monitor.status()['run']['phase'],'invalidated')

    def test_guard_frozen_and_already_invalid_start_preserves_previous_run(self):
        first=self.monitor.start(self.body)['run']['id'];self.body['request_id']='bad-new-start'
        self.body['settings']['invalidation']['level']=100
        with self.assertRaisesRegex(ValueError,'already invalid'):self.monitor.start(self.body)
        self.assertEqual(self.monitor.status()['run']['id'],first)
        self.body['settings']['invalidation']['level']=90;self.advance(97)
        self.assertEqual(self.monitor.status()['run']['invalidation']['level'],98)
        self.assertEqual(self.monitor.status()['run']['phase'],'invalidated')

    def test_above_guard_and_disabled_compatibility(self):
        self.body['settings']['invalidation'].update(direction='ABOVE',level=100)
        self.monitor.start(self.body);self.advance(100);self.assertEqual(self.monitor.status()['run']['phase'],'invalidated')
        self.setUp();self.body['settings']['invalidation']['enabled']=False
        self.monitor.start(self.body);self.advance(101);self.assertEqual(self.monitor.status()['run']['phase'],'finished')

    def test_swing_level_frozen_at_start(self):
        values=[10,14,11,16,12,15,13,17]
        self.terminal.bars=[[int((i+1)*1000),p,p+.2,p-.2,p,100] for i,p in enumerate(values)]
        self.body['settings']['invalidation']=dict(enabled=True,source='SWING',timeframe='M5',sensitivity=1,buffer=0)
        self.monitor.start(self.body);self.assertEqual(self.monitor.status()['run']['invalidation']['level'],11.8)
        self.terminal.bars[-1]=[8000,9,9.2,8.8,9,100]
        self.advance(11.8);self.assertEqual(self.monitor.status()['run']['phase'],'invalidated')
        self.assertEqual(self.monitor.status()['run']['invalidation']['level'],11.8)

    def test_review_guard_and_confirmation_recheck_invalidate_token(self):
        self.body['settings']['action']='REVIEW';self.body['rows']=[]
        self.monitor.start(self.body);self.advance();token=self.monitor.status()['run']['review']['preview']
        self.terminal.bid=98
        with self.assertRaisesRegex(ValueError,'invalidated'):self.monitor.before_submission({'preview':token})
        self.assertNotIn(token,self.terminal.previews);self.assertEqual(self.monitor.status()['run']['phase'],'invalidated')
        self.assertEqual(self.terminal.sent,[])

    def test_review_polling_checks_guard_without_browser(self):
        self.body['settings']['action']='REVIEW';self.body['rows']=[]
        self.monitor.start(self.body);self.advance();self.advance(98)
        self.assertEqual(self.monitor.status()['run']['phase'],'invalidated');self.assertEqual(self.terminal.previews,{})

    def test_guard_rechecked_after_preview_and_before_auto_send(self):
        self.body['settings']['action']='AUTO';self.body['rows']=[];original=self.terminal.preview
        def preview(body):
            result=original(body);self.terminal.bid=98;return result
        self.terminal.preview=preview;self.monitor.start(self.body);self.advance()
        self.assertEqual(self.monitor.status()['run']['phase'],'invalidated');self.assertEqual(self.terminal.previews,{})
        self.assertEqual(self.terminal.sent,[])

    def test_no_invalidation_after_submitted_order(self):
        self.body['settings']['action']='AUTO';self.body['rows']=[]
        self.monitor.start(self.body);self.advance();self.assertEqual(len(self.terminal.sent),1)
        self.advance(97);self.assertEqual(self.monitor.status()['run']['phase'],'finished')
        self.assertEqual(len(self.terminal.sent),1)
        self.assertEqual(self.terminal.prepared[0]['condition_setup']['invalidation']['level'],98)

    def test_gap_reset_does_not_reset_guard(self):
        self.body['rows']*=2;self.body['settings']['gap']='3'
        self.monitor.start(self.body);self.advance(101);self.advance(97,seconds=5)
        self.assertEqual(self.monitor.status()['run']['phase'],'invalidated');self.assertEqual(self.monitor.status()['run']['invalidation']['level'],98)

    def test_submit_time_guard_exception_becomes_invalidated(self):
        self.body['settings']['action']='AUTO';self.body['rows']=[]
        def submit(body):
            self.terminal.previews.pop(body['preview']);raise ConditionInvalidated(98)
        self.terminal.submit=submit;self.monitor.start(self.body);self.advance()
        self.assertEqual(self.monitor.status()['run']['phase'],'invalidated');self.assertFalse(self.monitor.status()['run']['sent'])


class TerminalInvalidationTests(unittest.TestCase):
    def setUp(self):
        test_terminal.TerminalTests.setUp(self)
        self.body.update(condition_entry=True,expected_account='123',expected_server='Demo',condition_invalidation=dict(enabled=True,direction='BELOW',level=1.099))
    def test_terminal_checks_fresh_bid_again_at_submit(self):
        preview=self.terminal.preview(self.body);self.tick.bid=1.0985;self.tick.ask=1.0986
        with self.assertRaises(ConditionInvalidated):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()
        with self.assertRaises(ValueError):self.terminal.submit(preview)
