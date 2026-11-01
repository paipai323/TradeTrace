"""One local, in-memory condition runner. Broker access is serialized with HTTP APIs."""
import copy
import hashlib
import json
import math
import secrets
import threading
import time
from condition_engine import Sequence, Structure, STRUCTURE, FRAMES, finite
from terminal import ConditionInvalidated


def closed(data):
    return [dict(time=b[0]/1000,open=b[1],high=b[2],low=b[3],close=b[4]) for b in data['bars'][:-1]]


class ConditionMonitor:
    def __init__(self,terminal,lock,clock=time.time,interval=2):
        self.terminal=terminal;self.lock=lock;self.clock=clock;self.interval=interval;self.run=None;self.requests={};self.generation=0;self.shutdown=threading.Event();self.thread=None

    def launch(self):
        if self.thread:return
        self.thread=threading.Thread(target=self._loop,name='condition-monitor',daemon=True);self.thread.start()

    def close(self):
        self.shutdown.set();self.signal_stop({})
        if self.thread:self.thread.join()
        with self.lock:self.stop({'reason':'Stopped: TradeTrace server is shutting down.'})

    def _loop(self):
        while not self.shutdown.wait(self.interval):
            with self.lock:
                try:self.tick()
                except Exception as error:
                    if self.run:self._finish('Stopped: monitoring failed. '+str(error)+' Check MT5 before starting again.','stopped')

    def _event(self,kind,message):
        run=self.run;run['events'].append(dict(id=run['event_no'],at=int(self.clock()*1000),type=kind,message=message));run['event_no']+=1
        run['events']=run['events'][-100:]

    def status(self,body=None):
        if not self.run:return dict(run=None)
        run=self.run;result={key:copy.deepcopy(value) for key,value in run.items() if not key.startswith('_') and key not in ('sequence','event_no','fingerprint','review_deadline')}
        result['applied']=dict(rows=copy.deepcopy(run['rows']),index=run['sequence'].index,state='running' if run['phase']=='running' else 'finished' if run['attempted'] and run['phase']!='invalidated' else 'stopped',settings=copy.deepcopy(run['settings']))
        result['structureState']=copy.deepcopy(run['sequence'].structure_state)
        result['revision']=run['event_no']
        return dict(run=result)

    def start(self,body):
        if self.shutdown.is_set():raise ValueError('The server is shutting down. No new setup was started.')
        request_id=body.get('request_id');settings=body.get('settings');symbol=body.get('symbol')
        if not isinstance(request_id,str) or not 8<=len(request_id)<=100 or not isinstance(settings,dict) or not isinstance(symbol,str) or not symbol:
            raise ValueError('A unique start request, symbol and frozen settings are required.')
        fingerprint=hashlib.sha256(json.dumps(body,sort_keys=True,allow_nan=False).encode()).hexdigest()
        if request_id in self.requests:
            if self.requests[request_id]!=fingerprint:raise ValueError('Start request already used with different settings.')
            # A retried old start must never replace or re-arm any current run.
            return self.status()
        action=settings.get('action');ticket=settings.get('ticket') or {};plan=settings.get('autoPlan') or {'enabled':False}
        if action not in ('ALERT','REVIEW','AUTO') or settings.get('sizing') not in ('MANUAL','AUTO'):raise ValueError('Choose a valid execution mode and sizing.')
        if not isinstance(ticket,dict) or ticket.get('side') not in ('BUY','SELL') or ticket.get('order-kind') not in ('MARKET','PENDING'):raise ValueError('Choose a valid order ticket.')
        try:timeout=float(settings.get('timeout'));gap=float(settings.get('gap'))
        except (TypeError,ValueError):raise ValueError('Invalid timing settings.')
        if not all(math.isfinite(v) and v>=0 for v in (timeout,gap)):raise ValueError('Timing settings must be nonnegative.')
        sequence=Sequence(body.get('rows'),timeout*60,gap)
        if not isinstance(plan,dict):raise ValueError('Invalid automatic trade plan.')
        if plan.get('enabled') and action!='ALERT':
            for key,low,high in [('risk',.01,2),('rr',.1,100),('buffer',0,1000000),('sensitivity',1,10)]:
                value=plan.get(key)
                if not finite(value) or not low<=value<=high or key in ('buffer','sensitivity') and int(value)!=value:raise ValueError('Invalid automatic plan '+key+'.')
            if plan.get('timeframe') not in FRAMES or plan.get('entry') not in ('MARKET','RETEST'):raise ValueError('Invalid plan timeframe or entry.')
            if plan['entry']=='RETEST':
                expiry=plan.get('expiry');suffix='_UP' if ticket['side']=='BUY' else '_DOWN'
                if not finite(expiry) or int(expiry)!=expiry or not 1<=expiry<=1440:raise ValueError('Invalid retest expiry.')
                if not any(row['rule'] in STRUCTURE and row['rule'].endswith(suffix) for row in sequence.rows):raise ValueError('Retest needs a matching BOS/MS condition.')
        elif action!='ALERT':
            try:protection=[float(ticket.get(key) or 0) for key in ('sl','tp')]
            except (ValueError,TypeError):raise ValueError('Enter SL and TP in Order first.')
            if not all(math.isfinite(v) and v>0 for v in protection):raise ValueError('Enter SL and TP in Order first.')
        _,account=self.terminal.connection(trading=action!='ALERT')
        if (str(account.login),account.server)!=(str(body.get('expected_account')),body.get('expected_server')):raise ValueError('Account changed. Review and start again.')
        first=sequence.rows[0] if sequence.rows else None
        initial=self.terminal.market(dict(symbol=symbol,timeframe=first['timeframe'] if first and first['mode']=='CANDLE' else 'M1'))
        if (initial['account'],initial['server'])!=(str(account.login),account.server):raise ValueError('Account changed during Start.')
        if not finite(initial.get('quote_time')) or not self.clock()-30<=initial['quote_time']<=self.clock()+5:raise ValueError('Quote is stale at Start.')
        if first:sequence.observe(initial['bid'],initial['quote_time'],closed(initial) if first['mode']=='CANDLE' else [])
        invalidation=self._resolve_invalidation(settings.get('invalidation'),ticket,symbol,initial)
        self.stop({'reason':'Stopped: replaced by an explicitly started setup.'})
        self.requests[request_id]=fingerprint
        if len(self.requests)>100:self.requests.pop(next(iter(self.requests)))
        self.generation+=1
        self.run=dict(id=secrets.token_hex(16),generation=self.generation,request_id=request_id,scope=json.dumps([account.server,str(account.login)],separators=(',',':')),
                      account=str(account.login),server=account.server,symbol=symbol,action=action,settings=copy.deepcopy(settings),rows=copy.deepcopy(sequence.rows),
                      sequence=sequence,phase='running',attempted=False,started=int(self.clock()*1000),last_poll=self.clock(),
                      message=f'Server monitoring · {symbol} · step {1 if sequence.rows else 0} of {len(sequence.rows)}. Continues while the browser is hidden.',
                      events=[],event_no=0,observations=[],review=None,result=None,invalidation=invalidation,invalidation_trigger=None,sent=False,_cancel=threading.Event())
        self.run['demo']=bool(initial.get('demo'))
        self.run['message']=f'Server monitoring · {"DEMO" if self.run["demo"] else "LIVE"} ORDER ARMED · {symbol} · frozen AUTO setup from Start.' if action=='AUTO' else self.run['message']
        self._event('Started',f'{len(sequence.rows)} conditions · {action} · local server monitoring. Frozen settings from Start.')
        return self.status()

    def stop(self,body=None):
        if not self.run:return self.status()
        body=body or {};run=self.run
        if body.get('id') and body['id']!=run['id']:return self.status()
        if run['phase'] in ('running','review') or run['phase']=='finishing' and not run['sent']:
            run['_cancel'].set()
            if run.get('review'):self.terminal.previews.pop(run['review']['preview'],None)
            run['review']=None;self._finish(body.get('reason') or 'Stopped by user. Already submitted orders remain in MT5.','stopped')
        return self.status()

    def signal_stop(self,body):
        """Cancellation intent can arrive while the broker/API lock is occupied."""
        run=self.run
        if run and (not body.get('id') or body['id']==run['id']):run['_cancel'].set()

    def _finish(self,message,phase='finished'):
        self.run['phase']=phase;self.run['message']=message;self._event('Finished' if phase=='finished' else 'Stopped',message)

    def _market(self,tf):
        run=self.run;data=self.terminal.market(dict(symbol=run['symbol'],timeframe=tf))
        if (data['account'],data['server'])!=(run['account'],run['server']):raise ValueError('MT5 account changed.')
        if bool(data.get('demo'))!=run['demo']:raise ValueError('MT5 account type changed.')
        if run['action']!='ALERT' and data.get('trading_allowed') is False:raise ValueError('MT5 trading permission was disabled.')
        if not finite(data.get('quote_time')) or not self.clock()-30<=data['quote_time']<=self.clock()+5:raise ValueError('Quote is stale.')
        return data


    def _resolve_invalidation(self,settings,ticket,symbol,initial):
        if settings is None:return dict(enabled=False)
        if not isinstance(settings,dict) or not isinstance(settings.get('enabled',False),bool):raise ValueError('Invalid setup invalidation settings.')
        if not settings.get('enabled'):return dict(enabled=False)
        source=settings.get('source');swing=None
        if source=='LEVEL':
            level=settings.get('level');direction=settings.get('direction')
            if not finite(level) or level<=0 or direction not in ('BELOW','ABOVE'):raise ValueError('Choose a positive cancellation level and Bid direction.')
        elif source=='SWING':
            tf=settings.get('timeframe');n=settings.get('sensitivity');buffer=settings.get('buffer')
            if tf not in FRAMES or not finite(n) or int(n)!=n or not 1<=n<=10:raise ValueError('Choose an invalidation timeframe and 1–10 swing candles each side.')
            if not finite(buffer) or int(buffer)!=buffer or not 0<=buffer<=1000000:raise ValueError('Invalidation buffer must be 0–1,000,000 broker ticks.')
            data=self.terminal.market(dict(symbol=symbol,timeframe=tf))
            if (data['account'],data['server'],bool(data.get('demo')))!=(initial['account'],initial['server'],bool(initial.get('demo'))):raise ValueError('Account changed while establishing invalidation.')
            if not finite(data.get('quote_time')) or not self.clock()-30<=data['quote_time']<=self.clock()+5:raise ValueError('Invalidation quote is stale.')
            model=Structure(n)
            for bar in closed(data):model.push(bar)
            swings=model.lows if ticket['side']=='BUY' else model.highs;swing=swings[-1] if swings else None
            if not swing or swing['broken']:raise ValueError('A usable confirmed invalidation swing is unavailable. Choose another timeframe or a manual level.')
            direction='BELOW' if ticket['side']=='BUY' else 'ABOVE';tick=data.get('tick_size')
            if not finite(tick) or tick<=0:raise ValueError('Broker tick size unavailable for invalidation.')
            raw=swing['price']+(-1 if direction=='BELOW' else 1)*buffer*tick
            level=round((math.floor(raw/tick+1e-8) if direction=='BELOW' else math.ceil(raw/tick-1e-8))*tick,10)
            if level<=0:raise ValueError('Invalidation level must remain positive.')
            initial=data
        else:raise ValueError('Choose manual price or confirmed swing invalidation.')
        guard=dict(enabled=True,source=source,direction=direction,level=level,frozen_at=int(self.clock()*1000),swing=copy.deepcopy(swing),
                   timeframe=settings.get('timeframe') if source=='SWING' else None,buffer=settings.get('buffer',0) if source=='SWING' else 0)
        if self._guard_hit(guard,initial['bid']):raise ValueError('Setup is already invalid at the current Bid. Adjust the cancellation level or wait for a new setup.')
        return guard

    @staticmethod
    def _guard_hit(guard,bid):
        return guard.get('enabled') and (bid<=guard['level'] if guard['direction']=='BELOW' else bid>=guard['level'])

    def _check_invalidation(self,data):
        run=self.run;guard=run['invalidation']
        if not self._guard_hit(guard,data['bid']):return False
        if run.get('review'):self.terminal.previews.pop(run['review']['preview'],None)
        run['review']=None;run['_cancel'].set();run['phase']='invalidated'
        run['invalidation_trigger']=dict(at=int(self.clock()*1000),bid=data['bid'],quote_time=data['quote_time'],guard=copy.deepcopy(guard))
        run['message']=f'Invalidated: Bid {data["bid"]} reached the cancellation level ({"at/below" if guard["direction"]=="BELOW" else "at/above"} {guard["level"]}). No order sent. Start explicitly for a new setup.'
        self._event('Invalidated',run['message']);return True

    def before_submission(self,body):
        run=self.run
        if not run or run['phase']!='review' or body.get('preview')!=run['review']['preview'] or not run['invalidation']['enabled']:return
        if self.clock()-run['last_poll']>30:
            self.stop(dict(reason='Stopped: monitoring interruption before confirmation. Review and start again.'))
            raise ValueError('Setup monitoring was interrupted. No order sent.')
        data=self._market('M1');run['last_poll']=self.clock()
        if self._check_invalidation(data):raise ValueError('Setup invalidated before confirmation. No order sent.')

    def tick(self):
        run=self.run
        if not run:return
        if run['phase']=='review':
            if self.clock()>=run['review_deadline']:
                self.terminal.previews.pop(run['review']['preview'],None);run['review']=None;self._finish('Finished: condition review expired. Start explicitly for a new setup.')
            elif run['invalidation']['enabled']:
                try:
                    if self.clock()-run['last_poll']>30:self.stop(dict(reason='Stopped: server monitoring was interrupted during review.'));return
                    data=self._market('M1');run['last_poll']=self.clock();self._check_invalidation(data)
                except Exception as error:self.stop(dict(reason='Stopped: '+str(error)+' Review invalidated; no order sent.'))
            return
        if run['phase']!='running':return
        if run['_cancel'].is_set():self.stop();return
        if run['last_poll'] is not None and self.clock()-run['last_poll']>30:
            self._finish('Stopped: server monitoring was interrupted for more than 30 seconds. Review and start again.','stopped');return
        run['last_poll']=self.clock()
        try:
            sequence=run['sequence'];step=sequence.rows[sequence.index] if not sequence.done else None
            data=self._market(step['timeframe'] if step and step['mode']=='CANDLE' else 'M1')
            if run['_cancel'].is_set():self.stop();return
            if self._check_invalidation(data):return
            candles=closed(data) if step and step['mode']=='CANDLE' else []
            if sequence.done:self._complete(data);return
            complete=sequence.observe(data['bid'],data['quote_time'],candles)
            for event in sequence.events:
                run['observations'].append(dict(copy.deepcopy(event),observed_at=int(self.clock()*1000),quote_time=data['quote_time'],bid=data['bid'],candle=candles[-1] if candles else None))
                run['observations']=run['observations'][-100:]
                if event['type']=='reset':self._event('Reset',f'{event["seconds"]:.0f}s without a fresh quote. Progress reset to step 1.' if event['reason']=='quote-gap' else f'Sequence timeout after {event["seconds"]:.0f}s. Progress reset to step 1.')
                else:
                    rule=sequence.rows[event['index']];level=event.get('structure',{}).get('level',rule.get('level') if rule['rule'] not in ('ZONE_ENTER','ZONE_TOUCH','CLOSE_IN_ZONE') else f'{rule["low"]}–{rule["high"]}')
                    self._event('Step passed',f'Step {event["index"]+1}/{len(sequence.rows)}: {rule["rule"]} {level} · Bid {data["bid"]}.')
            if complete:self._complete(data)
            else:run['message']=f'Server monitoring · {"AUTO ORDER ARMED" if run["action"]=="AUTO" else "Review preparation" if run["action"]=="REVIEW" else "Alerts only"} · {run["symbol"]} · step {sequence.index+1} of {len(sequence.rows)}'+(' · '+sequence.structure_state['status'] if sequence.structure_state else '')+'. Frozen setup from Start; continues while the browser is hidden.'
        except ConditionInvalidated as error:
            run['sent']=False
            self._check_invalidation(dict(bid=error.bid,quote_time=self.clock()))
        except Exception as error:
            self._finish(('Finished: ' if run['attempted'] else 'Stopped: ')+str(error)+' No automatic retry. Check MT5 before starting again.','finished' if run['attempted'] else 'stopped')

    def _complete(self,data):
        run=self.run
        if run['attempted']:return
        run['attempted']=True;run['phase']='finishing'
        if run['action']=='ALERT':self._finish('All conditions passed. Finished — click Start conditions to start again.');return
        settings=run['settings'];ticket=settings['ticket'];plan=settings.get('autoPlan') or {'enabled':False}
        body=dict(symbol=run['symbol'],side=ticket['side'],order_kind=ticket['order-kind'],price=ticket.get('order-price'),volume=ticket.get('volume'),sl=ticket.get('sl'),tp=ticket.get('tp'),
                  condition_entry=True,condition_invalidation=copy.deepcopy(run['invalidation']),expected_account=run['account'],expected_server=run['server'],condition_risk_auto=settings['sizing']=='AUTO',
                  condition_setup=dict(started=run['started'],completed=int(self.clock()*1000),action=run['action'],rows=copy.deepcopy(run['rows']),settings=copy.deepcopy(settings),observations=copy.deepcopy(run['observations']),invalidation=copy.deepcopy(run['invalidation']),monitor='local server'))
        if plan.get('enabled'):
            candles=closed(self._market(plan['timeframe']));tracker=Structure(plan['sensitivity'])
            for bar in candles:tracker.push(bar)
            swings=tracker.lows if body['side']=='BUY' else tracker.highs;swing=swings[-1] if swings else None
            if not swing or swing['broken']:raise ValueError('A usable confirmed stop swing is unavailable.')
            direction=1 if body['side']=='BUY' else -1
            trigger=next((e['structure'] for e in reversed(run['observations']) if e.get('structure',{}).get('direction')==direction),{})
            result=self.terminal.condition_plan(dict(body,auto_plan=plan,stop_swing=dict(price=swing['price'],time=swing['time'],confirmed_time=swing['confirmed']),retest_level=trigger.get('level')))
        else:
            if settings['sizing']=='AUTO':
                entry=(data['ask'] if body['side']=='BUY' else data['bid']) if body['order_kind']=='MARKET' else float(body['price'])
                adverse=entry+(1 if body['side']=='BUY' else -1)*20*data.get('point',data['tick_size'])
                estimate=self.terminal.plan(dict(symbol=run['symbol'],side=body['side'],entry=adverse,stop=float(body['sl']),target=float(body['tp']),volume=data['volume_min']))
                if (estimate['account'],estimate['server'])!=(run['account'],run['server']) or not finite(estimate.get('risk')) or estimate['risk']<=0:raise ValueError('Risk estimate unavailable.')
                raw=min(data['volume_max'],data['equity']*.02/estimate['risk']*data['volume_min'])
                body['volume']=round(math.floor(raw/data['volume_step'])*data['volume_step'],8)
                if body['volume']<data['volume_min']:raise ValueError('Minimum lot exceeds the 2% risk budget.')
            result=self.terminal.preview(body)
        if (result['account'],result['server'])!=(run['account'],run['server']):raise ValueError('Account changed during order preparation.')
        if run['_cancel'].is_set():
            self.terminal.previews.pop(result['preview'],None);self.stop();return
        if run['invalidation']['enabled'] and self._check_invalidation(self._market('M1')):
            self.terminal.previews.pop(result['preview'],None);return
        if run['action']=='REVIEW':
            run['review']=result;run['review_deadline']=self.clock()+result['expires_in'];run['review_expires']=run['review_deadline'];run['phase']='review';run['message']='Conditions complete. Confirm the prepared order in Order. No order sent. Invalidation remains active until confirmation when enabled.'
            self._event('Review ready',run['message']);return
        self._event('Order attempt','One automatic submission. Check MT5 for final status.')
        run['sent']=True
        sent=self.terminal.submit({'preview':result['preview']});run['result']=sent
        self._finish(f'Finished · broker {sent["retcode"]}: {sent["comment"]}. Order {sent["order"]}, deal {sent["deal"]}. '+sent.get('journal_warning','Setup saved to journal.' if sent.get('journal_recorded') else '')+' No automatic retry.')

    def record_submission(self,body,result=None,error=None):
        run=self.run
        if not run or run['phase']!='review' or body.get('preview')!=run['review']['preview']:return
        if isinstance(error,ConditionInvalidated):self._check_invalidation(dict(bid=error.bid,quote_time=self.clock()));return
        run['review']=None;run['result']=copy.deepcopy(result)
        self._finish('Finished: '+(str(error)+' Check MT5. No automatic retry.' if error else f'broker {result["retcode"]}: {result["comment"]}. Check MT5 for final execution status.'))
