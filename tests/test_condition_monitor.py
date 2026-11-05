import copy
import json
from pathlib import Path
import shutil
import subprocess
import threading
import time
import unittest
from types import SimpleNamespace as Row
from condition_engine import Sequence, Structure, RULES, STRUCTURE
from condition_monitor import ConditionMonitor


class FakeTerminal:
    def __init__(self,clock):
        self.clock=clock;self.account=Row(login=123,server='Demo');self.bid=99;self.bars=[];self.sent=[];self.prepared=[];self.previews={};self.failure=None;self.delta=0;self.disconnected=False
    def connection(self,trading=False):return None,self.account
    def market(self,body):
        if self.disconnected:raise ValueError('MT5 disconnected')
        return dict(account=str(self.account.login),server=self.account.server,bid=self.bid,ask=self.bid+.01,bars=self.bars,
                    quote_time=self.clock()+self.delta,volume_min=.01,volume_max=10,volume_step=.01,equity=10000,point=.001,tick_size=.001)
    def preview(self,body):
        self.prepared.append(copy.deepcopy(body));token='token'+str(len(self.prepared));self.previews[token]=body
        return dict(preview=token,account=str(self.account.login),server=self.account.server,demo=True,expires_in=60,order_kind=body['order_kind'],
                    request=dict(symbol=body['symbol'],volume=body['volume'],price=self.bid,sl=body['sl'],tp=body['tp']))
    def submit(self,body):
        if body['preview'] not in self.previews:raise ValueError('Preview already used')
        self.previews.pop(body['preview']);self.sent.append(body)
        if self.failure:raise ValueError(self.failure)
        return dict(retcode=10009,comment='Done',order='42',deal='43',journal_recorded=True)
    def plan(self,body):return dict(account=str(self.account.login),server=self.account.server,risk=10)
    def condition_plan(self,body):
        return self.preview({**body,'order_kind':'MARKET','volume':.1,'sl':10,'tp':120})


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.now=1000.;self.terminal=FakeTerminal(lambda:self.now);self.monitor=ConditionMonitor(self.terminal,threading.RLock(),lambda:self.now)
        self.body=dict(request_id='unique-start-1',symbol='TEST',expected_account='123',expected_server='Demo',
                       rows=[dict(rule='TRADED_ABOVE',mode='LIVE',timeframe='M1',level=100)],
                       settings=dict(action='ALERT',sizing='MANUAL',timeout='0',gap='300',autoPlan=dict(enabled=False),ticket=dict(side='BUY',**{'order-kind':'MARKET','order-price':''},volume=.01,sl=90,tp=120)))
    def advance(self,bid=None,seconds=2):
        self.now+=seconds
        if bid is not None:self.terminal.bid=bid
        self.monitor.tick()
    def test_no_browser_required_and_completion_latches(self):
        self.monitor.start(self.body);self.advance();self.advance(101)
        self.assertEqual(self.monitor.status()['run']['phase'],'finished')
        for _ in range(5):self.advance(110)
        self.assertEqual(self.terminal.sent,[])
        self.assertEqual(self.monitor.status()['run']['applied']['index'],1)
    def test_auto_one_attempt_idempotent_start_and_unknown_outcome(self):
        self.body['settings']['action']='AUTO';self.body['rows']=[];self.terminal.failure='Execution outcome unknown'
        self.monitor.start(self.body);self.advance();self.monitor.start(copy.deepcopy(self.body));self.advance()
        self.assertEqual(len(self.terminal.sent),1)
        self.assertEqual(self.monitor.status()['run']['phase'],'finished')
        self.assertIn('No automatic retry',self.monitor.status()['run']['message'])
        changed=copy.deepcopy(self.body);changed['symbol']='OTHER'
        with self.assertRaisesRegex(ValueError,'already used'):self.monitor.start(changed)
    def test_frozen_rows_and_review_not_auto_submitted(self):
        self.body['settings']['action']='REVIEW';self.monitor.start(self.body)
        self.body['rows'][0]['level']=999;self.body['settings']['ticket']['sl']=98
        self.advance();self.advance(101)
        state=self.monitor.status()['run'];self.assertEqual(state['phase'],'review');self.assertEqual(self.terminal.sent,[])
        self.assertEqual(self.terminal.prepared[0]['sl'],90)
        self.assertEqual(state['applied']['rows'][0]['level'],100)
        token=state['review']['preview'];result=self.terminal.submit(dict(preview=token));self.monitor.record_submission(dict(preview=token),result=result)
        self.assertEqual(self.monitor.status()['run']['phase'],'finished')
    def test_stop_and_review_expiry_invalidate_token(self):
        self.body['settings']['action']='REVIEW';self.body['rows']=[];self.monitor.start(self.body);self.advance()
        token=self.monitor.status()['run']['review']['preview'];self.monitor.stop()
        self.assertNotIn(token,self.terminal.previews)
        self.body['request_id']='another-start';self.monitor.start(self.body);self.advance();token=self.monitor.status()['run']['review']['preview']
        self.advance(seconds=61);self.assertNotIn(token,self.terminal.previews);self.assertEqual(self.monitor.status()['run']['phase'],'finished')
    def test_disconnect_account_stale_and_resume_stop_without_entry(self):
        for failure in ('disconnect','account','stale','sleep'):
            with self.subTest(failure=failure):
                self.setUp();self.body['settings']['action']='AUTO';self.monitor.start(self.body);self.advance()
                if failure=='disconnect':self.terminal.disconnected=True
                elif failure=='account':self.terminal.account.login=456
                elif failure=='stale':self.terminal.delta=-40
                self.advance(101,seconds=31 if failure=='sleep' else 2)
                self.assertEqual(self.monitor.status()['run']['phase'],'paused' if failure=='stale' else 'stopped');self.assertEqual(self.terminal.sent,[])
    def test_old_stop_cannot_stop_replacement_or_restart_after_server_restart(self):
        old=self.monitor.start(self.body)['run']['id'];self.body['request_id']='unique-new-start';new=self.monitor.start(self.body)['run']['id']
        self.monitor.stop(dict(id=old));self.assertEqual(self.monitor.status()['run']['id'],new);self.assertEqual(self.monitor.status()['run']['phase'],'running')
        restarted=ConditionMonitor(self.terminal,threading.RLock());self.assertIsNone(restarted.status()['run'])
    def test_worker_runs_independent_of_status_requests(self):
        terminal=FakeTerminal(time.time);base_market=terminal.market
        count=[0]
        def market(body):
            count[0]+=1;terminal.bid=99 if count[0]==1 else 101;return base_market(body)
        terminal.market=market;monitor=ConditionMonitor(terminal,threading.RLock(),interval=.02)
        self.body['settings']['action']='AUTO';monitor.start(self.body);monitor.launch()
        deadline=time.monotonic()+2
        while not terminal.sent and time.monotonic()<deadline:time.sleep(.01)
        monitor.close();self.assertEqual(len(terminal.sent),1)

    def test_automatic_swing_plan_is_calculated_on_server(self):
        values=[10,14,11,16,12,15,13,17,14]
        self.terminal.bars=[[int((i+1)*1000),p,p+.2,p-.2,p,100] for i,p in enumerate(values[:8])]
        plan=dict(enabled=True,entry='MARKET',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=1,expiry=30)
        self.body['settings'].update(action='AUTO',autoPlan=plan);self.body['rows']=[]
        self.monitor.start(self.body);plan['risk']=2;self.advance()
        saved=self.terminal.prepared[0]
        self.assertEqual(saved['auto_plan']['risk'],1)
        self.assertEqual(saved['stop_swing']['price'],11.8)
        self.assertEqual(saved['condition_setup']['monitor'],'local server')
        self.assertEqual(len(self.terminal.sent),1)

    def test_stop_during_blocked_preview_prevents_later_send(self):
        self.body['settings']['action']='AUTO';self.body['rows']=[]
        self.monitor.start(self.body);entered=threading.Event();release=threading.Event();original=self.terminal.preview
        def preview(body):
            entered.set();release.wait(2);return original(body)
        self.terminal.preview=preview
        def worker():
            with self.monitor.lock:self.monitor.tick()
        thread=threading.Thread(target=worker);thread.start();self.assertTrue(entered.wait(1))
        self.monitor.signal_stop({'id':self.monitor.run['id']});release.set();thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(self.terminal.sent,[])
        self.assertEqual(self.monitor.status()['run']['phase'],'stopped')

    def test_structure_retest_uses_server_observation(self):
        values=[10,14,11,16,12,15,13,17,14]
        bars=[[int((i+1)*1000),p,p+.2,p-.2,p,100] for i,p in enumerate(values)]
        self.terminal.bars=bars[:8]
        self.body['rows']=[dict(rule='BOS_UP',mode='CANDLE',timeframe='M5',sensitivity=1)]
        self.body['settings'].update(action='REVIEW',autoPlan=dict(enabled=True,entry='RETEST',timeframe='M5',sensitivity=1,buffer=10,rr=2,risk=1,expiry=30))
        self.monitor.start(self.body);self.terminal.bars=bars;self.advance()
        saved=self.terminal.prepared[0]
        self.assertEqual(saved['retest_level'],15.2)
        self.assertEqual(saved['condition_setup']['observations'][0]['structure']['type'],'BOS')
        self.assertEqual(self.monitor.status()['run']['phase'],'review')
        self.assertEqual(self.terminal.sent,[])


class EngineParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'),'Node only needed for cross-language parity tests')
    def test_python_and_browser_engines_match(self):
        p=[10,14,11,16,12,15,13,17,14,18,15,11,13,10]
        bars=[dict(time=i+1,open=v,close=v,high=v+.2,low=v-.2) for i,v in enumerate(p)]
        mirror=[dict(time=b['time'],open=30-b['open'],close=30-b['close'],high=30-b['low'],low=30-b['high']) for b in bars]
        cases=[]
        for rule in RULES:
            row=dict(rule=rule,mode='CANDLE',timeframe='M5',sensitivity=1,level=13,low=11,high=15)
            history=mirror if rule.endswith('_DOWN') else bars
            cases.append(dict(rows=[row],samples=[dict(bid=b['close'],time=100+i,candles=history[:i+1]) for i,b in enumerate(history)]))
        for rule in RULES:
            if rule in STRUCTURE or rule.startswith(('CLOSE_','CROSS_')):continue
            row=dict(rule=rule,mode='LIVE',timeframe='M1',level=100,low=90,high=110)
            cases.append(dict(rows=[row],samples=[dict(bid=bid,time=i+1,candles=[]) for i,bid in enumerate([99,101,111,100,89,101])]))
        script="const C=require(process.argv[1]);let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(c=>{let q=new C.Sequence(c.rows);return c.samples.map(x=>({done:q.observe(x),index:q.index,events:q.events}));}))));"
        module=str(Path(__file__).resolve().parents[1]/'static/terminal-conditions.js')
        expected=json.loads(subprocess.check_output([shutil.which('node'),'-e',script,module],input=json.dumps(cases).encode()))
        actual=[]
        for case in cases:
            sequence=Sequence(case['rows']);values=[]
            for sample in case['samples']:values.append(dict(done=sequence.observe(**sample),index=sequence.index,events=copy.deepcopy(sequence.events)))
            actual.append(values)
        self.assertEqual(actual,expected)
