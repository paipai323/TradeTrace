import copy
import unittest
import test_condition_monitor
import test_terminal
from entry_quality import validate_quality,resolve_quality,check_quality,EntryQualitySkipped


class QualityMathTests(unittest.TestCase):
    def guard(self,**values):return dict(enabled=True,max_distance=5,min_rr=0,target=0,reference=dict(low=100,high=110,step=1),**values)

    def test_zone_inside_edges_and_inclusive_limit(self):
        for entry,expected in ((105,0),(95,5),(115,5)):
            result=check_quality(self.guard(),entry,90,130,'BUY');self.assertEqual(result['distance'],expected)
        with self.assertRaisesRegex(EntryQualitySkipped,'distance'):check_quality(self.guard(),116,90,130,'BUY')

    def test_market_adverse_allowance_included_and_pending_fixed(self):
        guard=self.guard();self.assertEqual(check_quality(guard,115,90,130,'BUY',.1,False)['distance'],5)
        with self.assertRaises(EntryQualitySkipped):check_quality(guard,115,90,130,'BUY',.1,True)

    def test_buy_sell_rr_and_nearer_target(self):
        guard=dict(enabled=True,max_distance=0,min_rr=2,target=0)
        self.assertEqual(check_quality(guard,100,90,120,'BUY')['rr'],2)
        self.assertEqual(check_quality(guard,100,110,80,'SELL')['rr'],2)
        with self.assertRaisesRegex(EntryQualitySkipped,'1:1.50'):check_quality({**guard,'target':115},100,90,130,'BUY')
        with self.assertRaises(EntryQualitySkipped):check_quality({**guard,'target':85},100,110,70,'SELL')
        self.assertEqual(check_quality({**guard,'target':140},100,90,120,'BUY')['rr'],2,'farther barrier cannot inflate order TP reward')

    def test_missing_or_wrong_side_prices_fail_closed(self):
        guard=dict(enabled=True,max_distance=0,min_rr=2,target=0)
        for sl,tp in ((0,120),(100,120),(110,120),(90,95)):
            with self.assertRaises(EntryQualitySkipped):check_quality(guard,100,sl,tp,'BUY')

    def test_config_and_reference_validation(self):
        self.assertEqual(validate_quality(None),dict(enabled=False))
        for settings in (dict(enabled=True,max_distance=0,min_rr=0),dict(enabled=True,max_distance=float('nan')),dict(enabled=True,min_rr=101),dict(enabled=True,max_distance=5,reference_step=2)):
            with self.assertRaises(ValueError):validate_quality(settings,[dict(rule='TRADED_ABOVE',level=100)])

    def test_reference_uses_frozen_zone_or_observed_structure(self):
        settings=dict(enabled=True,max_distance=5,min_rr=0,reference_step=1)
        result=resolve_quality(settings,[dict(rule='ZONE_TOUCH',low=100,high=110)],[])
        self.assertEqual(result['reference']['high'],110)
        rows=[dict(rule='BOS_UP')]
        with self.assertRaises(EntryQualitySkipped):resolve_quality(settings,rows,[])
        result=resolve_quality(settings,rows,[dict(type='passed',index=0,structure=dict(level=108))])
        self.assertEqual(result['reference']['low'],108)


class QualityMonitorTests(unittest.TestCase):
    def setUp(self):
        test_condition_monitor.MonitorTests.setUp(self)
        self.body['settings'].update(action='AUTO',entryQuality=dict(enabled=True,max_distance=1,min_rr=0,target=0,reference_step=1))
    advance=test_condition_monitor.MonitorTests.advance

    def test_distance_skip_latches_and_does_not_send(self):
        self.monitor.start(self.body);self.advance(103)
        run=self.monitor.status()['run'];self.assertEqual(run['phase'],'skipped');self.assertIn('distance',run['message'])
        self.assertEqual(self.terminal.sent,[]);self.assertEqual(self.terminal.previews,{})
        self.advance(100.5);self.assertEqual(self.monitor.status()['run']['phase'],'skipped')
        self.assertTrue(any(e['type']=='Entry skipped' for e in run['events']))

    def test_frozen_quality_settings_and_minimum_rr_skip(self):
        self.body['settings']['entryQuality']=dict(enabled=True,max_distance=0,min_rr=2,target=105)
        self.monitor.start(self.body);self.body['settings']['entryQuality']['min_rr']=.1;self.advance(101)
        run=self.monitor.status()['run'];self.assertEqual(run['phase'],'skipped');self.assertIn('available RR',run['message'])
        self.assertEqual(self.terminal.sent,[])

    def test_disabled_backwards_compatible_and_success_recorded(self):
        self.body['settings']['entryQuality']['enabled']=False;self.monitor.start(self.body);self.advance(110)
        self.assertEqual(len(self.terminal.sent),1)
        self.setUp();self.monitor.start(self.body);self.advance(100.5)
        self.assertEqual(self.monitor.status()['run']['phase'],'finished');self.assertIsNotNone(self.monitor.status()['run']['entry_quality_result'])

    def test_quality_skip_leaves_linked_peer_running(self):
        self.body.update(multiple=True,group='alternatives',group_policy='FIRST_ENTRY')
        self.monitor.start(self.body);other=copy.deepcopy(self.body);other['request_id']='other-start';other['rows'][0]['level']=110
        peer=self.monitor.start(other)['run']['id'];self.advance(103)
        runs=self.monitor.status()['runs'];self.assertEqual(runs[0]['phase'],'skipped');self.assertEqual(next(r for r in runs if r['id']==peer)['phase'],'running')

    def test_automatic_trade_plan_also_applies_minimum_rr(self):
        values=[10,14,11,16,12,15,13,17]
        self.terminal.bars=[[int((i+1)*1000),p,p+.2,p-.2,p,100] for i,p in enumerate(values)]
        self.body['rows']=[];self.body['settings']['autoPlan']=dict(enabled=True,entry='MARKET',timeframe='M5',sensitivity=1,buffer=0,rr=2,risk=.5,expiry=30)
        self.body['settings']['entryQuality']=dict(enabled=True,max_distance=0,min_rr=2,target=0)
        self.monitor.start(self.body);self.advance()
        self.assertEqual(self.monitor.status()['run']['phase'],'skipped');self.assertEqual(self.terminal.sent,[])
        self.assertTrue(self.terminal.prepared[0]['condition_entry_quality']['enabled'])

    def test_alert_does_not_apply_trade_filters(self):
        self.body['settings']['action']='ALERT';self.monitor.start(self.body);self.advance(103)
        self.assertEqual(self.monitor.status()['run']['phase'],'finished');self.assertEqual(self.terminal.prepared,[])


class TerminalQualityTests(unittest.TestCase):
    def setUp(self):
        test_terminal.TerminalTests.setUp(self)
        self.body.update(condition_entry=True,expected_account='123',expected_server='Demo',condition_setup={})

    def test_fresh_market_move_fails_distance_at_confirmation(self):
        self.body['condition_entry_quality']=dict(enabled=True,max_distance=.001,min_rr=0,target=0,reference=dict(low=1.1,high=1.1,step=1))
        preview=self.terminal.preview(self.body);self.tick.bid=1.105;self.tick.ask=1.1051
        with self.assertRaisesRegex(EntryQualitySkipped,'distance'):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()

    def test_fresh_rr_failure_consumes_review(self):
        self.body['condition_entry_quality']=dict(enabled=True,max_distance=0,min_rr=1.5,target=0)
        preview=self.terminal.preview(self.body);self.tick.bid=1.105;self.tick.ask=1.1051
        with self.assertRaisesRegex(EntryQualitySkipped,'RR'):self.terminal.submit(preview)
        with self.assertRaises(ValueError):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()

    def test_price_beyond_target_is_explicit_quality_skip(self):
        self.body['condition_entry_quality']=dict(enabled=True,max_distance=0,min_rr=1.5,target=0)
        preview=self.terminal.preview(self.body);self.tick.bid=1.121;self.tick.ask=1.1211
        with self.assertRaisesRegex(EntryQualitySkipped,'wrong side'):self.terminal.submit(preview)
        self.mt.order_send.assert_not_called()

    def test_successful_receipt_contains_checked_metrics(self):
        self.body['condition_entry_quality']=dict(enabled=True,max_distance=0,min_rr=1.5,target=0)
        self.terminal.submit(self.terminal.preview(self.body));self.mt.order_send.assert_called_once()
        self.assertGreater(self.body['condition_setup']['entry_quality_result']['rr'],1.5)
