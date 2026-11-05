"""Isolated browser fixture: production HTTP/monitor, fake broker. Not shipped as an app mode."""
import argparse
import copy
import json
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace as Row
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
from condition_monitor import ConditionMonitor
from keep_awake import KeepAwake
from restart_resume import RestartPolicy
from entry_quality import check_quality


class FakeTerminal:
    def __init__(self):
        self.fixture_orders=[];self.fixture_bars=None;self.quote_age=0;self.bid=1.103;self.account='123';self.sent=[];self.previews={};self.failure=None;self.preview_delay=0;self.preview_started=threading.Event()
    def connection(self,trading=False):return None,Row(login=self.account,server='Test-Demo')
    def symbols(self):return dict(symbols=['EURUSD','GBPUSD'],visible=['EURUSD'],account=self.account,server='Test-Demo',currency='USD',demo=True)
    def market(self,body):
        if self.failure:raise ValueError(self.failure)
        bars=self.fixture_bars if self.fixture_bars is not None else [[int(time.time()//300)*300000-(299-i)*300000,1.1+i*.00001,1.1003+i*.00001,1.0997+i*.00001,1.1001+i*.00001,100] for i in range(300)]
        return dict(bars=bars,bid=self.bid,ask=self.bid+.0001,quote_time=time.time()-self.quote_age,digits=5,tick_size=.00001,point=.00001,stops_distance=.0001,
                    volume_min=.01,volume_max=10,volume_step=.01,balance=10000,equity=10000,margin_free=10000,currency='USD',account=self.account,server='Test-Demo',demo=True,trading_allowed=True,positions=[],orders=self.fixture_orders)
    def exposure(self,body=None):return dict(account=self.account,server='Test-Demo',currency='USD',equity=10000,risk=40,risk_percent=.4,unknown=[dict(ticket='unknown')],items=[dict(kind='position',risk=25),dict(kind='pending',risk=15)],checked_at=time.time())
    def quotes(self,body):return dict(quotes={s:dict(bid=self.bid,ask=self.bid+.0001,time=time.time()) for s in body['symbols']})
    def closed(self,body):return dict(positions=[])
    def estimate(self,body):return dict(account=self.account,server='Test-Demo',currency='USD',sl=-10,tp=20)
    def plan(self,body):
        direction=1 if body['side']=='BUY' else -1;entry=float(body['entry']);volume=float(body['volume'])
        return dict(account=self.account,server='Test-Demo',currency='USD',risk=abs((float(body['stop'])-entry)*100000*volume),reward=direction*(float(body['target'])-entry)*100000*volume)
    def request(self,body,*,broker_check=True):
        market=body['order_kind']=='MARKET';entry=(self.bid+.0001 if body['side']=='BUY' else self.bid) if market else float(body['price']);sl=float(body['sl']);tp=float(body['tp']);direction=1 if body['side']=='BUY' else -1
        check_quality(body.get('condition_entry_quality'),entry,sl,tp,body['side'],.00001,market)
        if direction*(entry-sl)<=0 or direction*(tp-entry)<=0:raise ValueError('Invalid protection at current quote.')
        return dict(price=entry,sl=sl,tp=tp,volume=float(body['volume'])),Row(login=self.account,server='Test-Demo')
    def preview(self,body):
        self.preview_started.set();time.sleep(self.preview_delay)
        key='test-preview-'+str(len(self.previews)+len(self.sent));self.previews[key]=copy.deepcopy(body)
        return dict(preview=key,account=self.account,server='Test-Demo',demo=True,expires_in=60,order_kind=body['order_kind'],
                    request=dict(symbol=body['symbol'],volume=float(body['volume']),price=self.bid+.0001,sl=float(body['sl']),tp=float(body['tp'])))
    def submit(self,body):
        saved=self.previews.pop(body['preview'])
        if saved.get('condition_entry_quality',{}).get('enabled'):
            market=saved['order_kind']=='MARKET';entry=(self.bid+.0001 if saved['side']=='BUY' else self.bid) if market else float(saved['price'])
            check_quality(saved['condition_entry_quality'],entry,float(saved['sl']),float(saved['tp']),saved['side'],.00001,market)
        self.sent.append(saved)
        return dict(retcode=10009,comment='Fake broker execution',order=str(len(self.sent)),deal=str(len(self.sent)),volume=float(saved['volume']),price=self.bid+.0001,operation='open' if saved['order_kind']=='MARKET' else 'pending',requested_price=saved.get('price'),journal_recorded=True,message='Fake broker only')


class FakePower:
    def __init__(self):self.source='ac';self.failure=False;self.held=False
    def acquire(self):
        if self.failure:raise OSError('Test power request unavailable')
        self.held=True
    def release(self):self.held=False
    def power_source(self):return self.source

power=FakePower();saved_path=os.environ.get('TRADETRACE_TEST_MONITOR_STORE')
awake=KeepAwake(Path(saved_path).with_name('keep-awake.json') if saved_path else None,backend=power)
terminal=FakeTerminal();server.terminal=terminal;server.condition_monitor=ConditionMonitor(terminal,server.api_lock,interval=.1,storage_path=saved_path,keep_awake=awake,resume_policy=RestartPolicy(Path(saved_path).with_name('restart-resume.json') if saved_path else None))


class Handler(server.Handler):
    def do_GET(self):
        if self.path=='/test/preview-started':return self.send({'started':terminal.preview_started.is_set()})
        return super().do_GET()

    def handle_api(self):
        if self.headers.get('X-Replay-Token')!=server.token:return super().handle_api()
        basic={'/api/session':dict(connected=True,key_saved=False,account='123',server='Test-Demo',currency='USD',direct=False),
               '/api/connect-all':dict(account='123',server='Test-Demo',currency='USD',native={}),
               '/api/journal/overview':dict(accounts=[],account=None,trades=[],condition_entries=[]),'/api/history':dict(trades=[],skipped=0)}
        if self.path in basic:
            self.rfile.read(int(self.headers['Content-Length']));return self.send(basic[self.path])
        if self.path=='/api/test/feed':
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if 'bars' in body:terminal.fixture_bars=body['bars']
            if 'quote_age' in body:terminal.quote_age=body['quote_age']
            if 'poll_gap' in body and server.condition_monitor.run:
                run=server.condition_monitor.run;run['last_poll']=run['last_observed_at']=run['last_quote_time']=time.time()-body['poll_gap']
            if 'power_source' in body:power.source=body['power_source']
            if 'power_failure' in body:power.failure=body['power_failure']
            if 'orders' in body:terminal.fixture_orders=body['orders']
            if 'bid' in body:terminal.bid=body['bid']
            if 'account' in body:terminal.account=body['account']
            if 'failure' in body:terminal.failure=body['failure']
            if 'preview_delay' in body:terminal.preview_delay=body['preview_delay'];terminal.preview_started.clear()
            if body.get('expire_pause') and server.condition_monitor.run and server.condition_monitor.run.get('quote_pause'):server.condition_monitor.run['quote_pause']['deadline']=time.time()-1
            if body.get('expire') and server.condition_monitor.run:server.condition_monitor.run['review_deadline']=time.time()-1
            return self.send(dict(sent=len(terminal.sent),previews=len(terminal.previews),state=server.condition_monitor.status()))
        return super().handle_api()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,required=True);args=parser.parse_args()
    app=server.AppServer(('127.0.0.1',args.port),Handler);server.condition_monitor.launch()
    if os.environ.get('TRADETRACE_TEST_MONITOR_STORE'):
        def stop_from_stdin():
            if sys.stdin.readline().strip()=='stop':app.shutdown()
        threading.Thread(target=stop_from_stdin,daemon=True).start()
    print(f'http://127.0.0.1:{args.port}',flush=True)
    try:app.serve_forever()
    finally:app.server_close();server.condition_monitor.close()
