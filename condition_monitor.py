"""Local, in-memory condition runners. Broker access is serialized with HTTP APIs."""
import copy
import hashlib
import json
import math
import secrets
import threading
import time
from condition_engine import Sequence, Structure, STRUCTURE, FRAMES, finite
from terminal import ConditionInvalidated
from condition_estimate import estimate_run
from monitor_store import MonitorStore
from restart_resume import RestartPolicy,checkpoint,consume_checkpoints,restore_sequence,MAX_RESTART_GAP
from entry_quality import EntryQualitySkipped, validate_quality, resolve_quality, check_quality


def completed_history(run):
    return run['phase'] in ('finished','skipped','invalidated') and not (run.get('_submission_intent') or run.get('sent') and not run.get('result'))


class MonitorInterruption(ValueError):
    def __init__(self,message,kind='connection',quote_time=None):
        super().__init__(message);self.kind=kind;self.quote_time=quote_time


def closed(data):
    return [dict(time=b[0]/1000,open=b[1],high=b[2],low=b[3],close=b[4]) for b in data['bars'][:-1]]


class ConditionRun:
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
        result['applied']=dict(rows=copy.deepcopy(run['rows']),index=run['sequence'].index,state='running' if run['phase'] in ('running','paused') else 'finished' if run['attempted'] and run['phase']!='invalidated' else 'stopped',settings=copy.deepcopy(run['settings']))
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
        validate_quality(settings.get('entryQuality'),sequence.rows)
        if not isinstance(plan,dict):raise ValueError('Invalid automatic trade plan.')
        if plan.get('enabled') and action!='ALERT':
            for key,low,high in [('risk',.01,2),('rr',.1,100),('buffer',0,1000000),('sensitivity',1,10)]:
                value=plan.get(key)
                if not finite(value) or not low<=value<=high or key in ('buffer','sensitivity') and int(value)!=value:raise ValueError('Invalid automatic plan '+key+'.')
            if plan.get('timeframe') not in FRAMES or plan.get('entry') not in ('MARKET','RETEST','CONFIRM'):raise ValueError('Invalid plan timeframe or entry.')
            if plan.get('stop_basis','SWING') not in ('SWING','SIGNAL') or not isinstance(plan.get('hold_breakout',False),bool):raise ValueError('Invalid automatic plan protection options.')
            if plan.get('stop_basis')=='SIGNAL' or plan.get('hold_breakout') and plan['entry'] in ('MARKET','CONFIRM'):
                suffix='_UP' if ticket['side']=='BUY' else '_DOWN'
                if not any(row['rule'] in STRUCTURE and row['rule'].endswith(suffix) for row in sequence.rows):raise ValueError('Breakout protection needs a matching BOS/MS condition.')
            if plan['entry'] in ('RETEST','CONFIRM'):
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
                      sequence=sequence,phase='running',attempted=False,started=int(self.clock()*1000),last_poll=self.clock(),last_quote_time=initial['quote_time'],last_observed_at=self.clock(),interruption=None,
                      message=f'Server monitoring · {symbol} · step {1 if sequence.rows else 0} of {len(sequence.rows)}. Continues while the browser is hidden.',
                      events=[],event_no=0,observations=[],review=None,result=None,invalidation=invalidation,invalidation_trigger=None,sent=False,_cancel=threading.Event())
        if first and first['mode']=='CANDLE' and closed(initial):self.run['_last_closed_snapshot']=dict(index=0,timeframe=first['timeframe'],candle=copy.deepcopy(closed(initial)[-1]))
        self.run['demo']=bool(initial.get('demo'))
        self.run['message']=f'Server monitoring · {"DEMO" if self.run["demo"] else "LIVE"} ORDER ARMED · {symbol} · AUTO settings frozen at Start; tracked swing levels may update.' if action=='AUTO' else self.run['message']
        self._event('Started',f'{len(sequence.rows)} conditions · {action} · local server monitoring. Frozen settings from Start.')
        return self.status()

    def stop(self,body=None):
        if not self.run:return self.status()
        body=body or {};run=self.run
        if body.get('id') and body['id']!=run['id']:return self.status()
        if run['phase']=='saved':
            self._finish('Saved setup dismissed. Monitoring remains stopped.','stopped');run['_preserve_for_restart']=False;return self.status()
        if run['phase']=='stopped' and run.get('_preserve_for_restart'):
            run['_preserve_for_restart']=False;self._event('Stopped','Explicit Stop dismissed the stopped setup.');return self.status()
        if run['phase']=='stopped' and run.get('interruption') and run['interruption'].get('enabled'):
            run['interruption'].update(enabled=False,ready=False);self._event('Recovery checks ended','Explicit Stop or replacement ended connection recovery checks.');return self.status()
        if run['phase'] in ('running','paused','resuming','review') or run['phase']=='finishing' and not run['sent']:
            run['_cancel'].set()
            if run.get('review'):self.terminal.previews.pop(run['review']['preview'],None)
            run['review']=None;self._finish(body.get('reason') or 'Stopped by user. Already submitted orders remain in MT5.','stopped');run['_preserve_for_restart']=False
        return self.status()

    def signal_stop(self,body):
        """Cancellation intent can arrive while the broker/API lock is occupied."""
        run=self.run
        if run and (not body.get('id') or body['id']==run['id']):run['_cancel'].set()

    def _finish(self,message,phase='finished'):
        self.run['phase']=phase;self.run['message']=message
        if phase=='stopped' and not self.run.get('sent'):self.run['_preserve_for_restart']=True
        self._event('Finished' if phase=='finished' else 'Entry skipped' if phase=='skipped' else 'Stopped',message)

    def _market(self,tf):
        run=self.run
        try:data=self.terminal.market(dict(symbol=run['symbol'],timeframe=tf))
        except Exception as error:raise MonitorInterruption(str(error)) from error
        if (data['account'],data['server'])!=(run['account'],run['server']):raise ValueError('MT5 account changed.')
        if bool(data.get('demo'))!=run['demo']:raise ValueError('MT5 account type changed.')
        if run['action']!='ALERT' and data.get('trading_allowed') is False:raise ValueError('MT5 trading permission was disabled.')
        if not finite(data.get('quote_time')) or not self.clock()-30<=data['quote_time']<=self.clock()+5:raise MonitorInterruption('Quote is stale.','stale_quote',data.get('quote_time'))
        return data


    def _interrupt(self,error):
        run=self.run
        if run.get('sent'):
            self._finish('Finished: '+str(error)+' Check MT5. No automatic retry.');return
        if run.get('review'):self.terminal.previews.pop(run['review']['preview'],None)
        if run.get('_prepared_preview'):self.terminal.previews.pop(run.pop('_prepared_preview'),None)
        run['review']=None;run['_cancel'].set()
        now=self.clock();last=run.get('last_quote_time');observed=run.get('last_observed_at',run['started']/1000)
        stale=getattr(error,'quote_time',None);gap=max(0,now-observed,now-last if finite(last) else 0,now-stale if finite(stale) else 0)
        kind=getattr(error,'kind','connection')
        cause='Server polling gap detected; laptop sleep or a scheduling interruption is possible.' if kind=='poll_gap' else 'Quotes stopped updating; the market may be closed or MT5 disconnected.' if kind=='stale_quote' else 'MT5 market data is unavailable; a connection interruption is possible.'
        if kind=='missed_candles':cause='A required candle closed during the quote pause. Missed signals were not replayed.'
        elif str(error)=='Quote recovery window expired.':cause='Fresh quotes did not return within the 2-minute recovery window.'
        run['interruption']=dict(enabled=True,kind=kind,detected_at=int(now*1000),last_quote_time=last,last_observed_at=observed,gap_seconds=gap,stale_quote_time=stale if finite(stale) else None,detail=str(error),ready=False,checked_at=None,recovered_at=None,recovery_message='Waiting for fresh quotes on the same account.')
        run['phase']='stopped';run['message']=f'Interrupted: {cause} Data/monitoring gap about {gap:.0f}s. No order sent. Review and explicitly restart; missed signals are not replayed.'
        self._event('Monitoring interrupted',run['message'])

    def _pause_quote(self,error):
        run=self.run
        if run['phase']!='running' or run['attempted'] or run.get('sent') or run.get('review') or error.kind!='stale_quote' or not finite(error.quote_time) or error.quote_time>=self.clock()-30:
            self._interrupt(error);return
        now=self.clock();run['quote_pause']=dict(detected_at=int(now*1000),deadline=now+120,last_quote_time=run.get('last_quote_time'))
        run['phase']='paused';run['message']='Paused: quote is over 30 seconds old. Orders and condition evaluation are blocked; waiting up to 2 minutes for fresh quotes.'
        self._event('Quote pause',run['message'])

    def _tick_quote_pause(self):
        run=self.run;pause=run['quote_pause'];now=self.clock()
        if run['_cancel'].is_set():self.stop();return
        if now-run['last_poll']>30:self._interrupt(MonitorInterruption('Server polling gap during quote pause.','poll_gap'));return
        run['last_poll']=now
        if now>=pause['deadline']:self._interrupt(MonitorInterruption('Quote recovery window expired.','stale_quote',pause['last_quote_time']));return
        sequence=run['sequence'];step=sequence.rows[sequence.index] if not sequence.done else None;confirmation=run.get('retest_confirmation')
        if confirmation and now>=confirmation['expires']:
            self._finish('Retest confirmation expired during quote pause. No order sent. Start explicitly for a new setup.','skipped');return
        frame=confirmation['timeframe'] if confirmation else step['timeframe'] if step and step['mode']=='CANDLE' else 'M1'
        try:
            data=self._market(frame)
            if not all(finite(data.get(key)) and data[key]>0 for key in ('bid','ask')) or data['bid']>data['ask']:raise ValueError('Broker quote is invalid.')
            if self._check_invalidation(data):return
            if finite(pause.get('last_quote_time')) and data['quote_time']<=pause['last_quote_time']:
                run['message']='Paused: waiting for a newer fresh quote timestamp. No orders or evaluation.';return
            if confirmation or step and step['mode']=='CANDLE':
                expected=confirmation['last_candle'] if confirmation else getattr(sequence.tracker,'last_time',None) if sequence.tracker is not None else sequence.candle
                history=closed(data)
                if expected is None or not history or history[-1]['time']!=expected or not any(bar['time']==expected for bar in history):
                    self._interrupt(MonitorInterruption('Required closed candle changed during quote pause; missed signals will not be replayed.','missed_candles'));return
            gap=data['quote_time']-sequence.last_time if sequence.last_time is not None else 0
            timed_out=sequence.started is not None and sequence.timeout>0 and data['quote_time']-sequence.started>sequence.timeout
            if not sequence.done and (sequence.gap>0 and gap>sequence.gap or timed_out):
                sequence.reset();run['observations'].append(dict(type='reset',reason='timeout' if timed_out else 'quote-gap',seconds=gap,observed_at=int(now*1000),bid=data['bid']))
                self._event('Progress reset','Configured timeout or quote-gap reset elapsed during the pause.')
            # Do not infer live crossings/sweeps from the unobserved price path.
            sequence.previous=data['bid'];sequence.memory={};sequence.last_time=data['quote_time']
            run['last_quote_time']=data['quote_time'];run['last_observed_at']=now;run['quote_pause']=None;run['phase']='running'
            run['message']='Fresh quotes restored. Checks passed; monitoring resumes on the next poll. No order evaluated on the recovery poll.'
            self._event('Quote resumed',run['message'])
        except MonitorInterruption as error:
            if error.kind!='stale_quote' or not finite(error.quote_time) or error.quote_time>now+5:self._interrupt(error)
            else:run['message']=f"Paused: waiting for fresh quotes · {max(0,int(pause['deadline']-now))}s recovery time left. No orders or condition evaluation."
        except Exception as error:self._finish('Stopped: quote recovery checks failed. '+str(error)+' Review and explicitly restart.','stopped')

    def recovery(self):
        run=self.run;info=run.get('interruption')
        if not info or not info.get('enabled') or run['phase']!='stopped':raise ValueError('This setup is not awaiting interruption recovery.')
        now=self.clock();ready=False;quote_time=None
        try:
            data=self._market('M1');quote_time=data['quote_time']
            if not all(finite(data.get(key)) and data[key]>0 for key in ('bid','ask')) or data['bid']>data['ask']:raise ValueError('Broker quote is invalid.')
            ready=True;message='Connection restored—fresh quotes received. Review and restart explicitly. Monitoring remains stopped.'
        except Exception as error:message='Still unavailable: '+str(error)+' Monitoring remains stopped.'
        changed=ready!=info['ready'];info.update(ready=ready,checked_at=int(now*1000),current_quote_time=quote_time,recovery_message=message)
        if ready and info['recovered_at'] is None:info['recovered_at']=int(now*1000)
        if changed:self._event('Connection restored' if ready else 'Connection lost again',message)
        return copy.deepcopy(info)

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
        if not run or run['phase']!='review' or body.get('preview')!=run['review']['preview']:return
        if self.clock()-run['last_poll']>30:
            self._interrupt(MonitorInterruption('Monitoring interruption before confirmation.','poll_gap'))
            raise ValueError('Setup monitoring was interrupted. No order sent.')
        try:data=self._market('M1')
        except MonitorInterruption as error:self._interrupt(error);raise
        run['last_poll']=self.clock();run['last_quote_time']=data['quote_time'];run['last_observed_at']=self.clock()
        if self._check_invalidation(data):raise ValueError('Setup invalidated before confirmation. No order sent.')

    def tick(self):
        run=self.run
        if not run:return
        if run['phase']=='paused':self._tick_quote_pause();return
        if run['phase']=='review':
            if self.clock()>=run['review_deadline']:
                self.terminal.previews.pop(run['review']['preview'],None);run['review']=None;self._finish('Finished: condition review expired. Start explicitly for a new setup.')
            else:
                try:
                    if self.clock()-run['last_poll']>30:self._interrupt(MonitorInterruption('Server monitoring interruption during review.','poll_gap'));return
                    data=self._market('M1');run['last_poll']=self.clock();run['last_quote_time']=data['quote_time'];run['last_observed_at']=self.clock();self._check_invalidation(data)
                except MonitorInterruption as error:self._interrupt(error)
                except Exception as error:self.stop(dict(reason='Stopped: '+str(error)+' Review invalidated; no order sent.'))
            return
        if run['phase']!='running':return
        if run['_cancel'].is_set():self.stop();return
        if run['last_poll'] is not None and self.clock()-run['last_poll']>30:
            self._interrupt(MonitorInterruption('More than 30 seconds between server polls.','poll_gap'));return
        run['last_poll']=self.clock()
        try:
            sequence=run['sequence'];step=sequence.rows[sequence.index] if not sequence.done else None
            data=self._market(step['timeframe'] if step and step['mode']=='CANDLE' else 'M1')
            if run['_cancel'].is_set():self.stop();return
            run['last_quote_time']=data['quote_time'];run['last_observed_at']=self.clock()
            if self._check_invalidation(data):return
            candles=closed(data) if step and step['mode']=='CANDLE' else []
            if candles:self.run['_last_closed_snapshot']=dict(index=sequence.index,timeframe=step['timeframe'],candle=copy.deepcopy(candles[-1]))
            if sequence.done:
                if self._confirmation_ready(data):self._complete(data)
                return
            complete=sequence.observe(data['bid'],data['quote_time'],candles)
            for event in sequence.events:
                run['observations'].append(dict(copy.deepcopy(event),observed_at=int(self.clock()*1000),quote_time=data['quote_time'],bid=data['bid'],candle=candles[-1] if candles else None))
                run['observations']=run['observations'][-100:]
                if event['type']=='reset':self._event('Reset',f'{event["seconds"]:.0f}s without a fresh quote. Progress reset to step 1.' if event['reason']=='quote-gap' else f'Sequence timeout after {event["seconds"]:.0f}s. Progress reset to step 1.')
                else:
                    rule=sequence.rows[event['index']];level=event.get('structure',{}).get('level',rule.get('level') if rule['rule'] not in ('ZONE_ENTER','ZONE_TOUCH','CLOSE_IN_ZONE') else f'{rule["low"]}–{rule["high"]}')
                    self._event('Step passed',f'Step {event["index"]+1}/{len(sequence.rows)}: {rule["rule"]} {level} · Bid {data["bid"]}.')
            if complete:
                if self._confirmation_ready(data):self._complete(data)
            else:run['message']=f'Server monitoring · {"AUTO ORDER ARMED" if run["action"]=="AUTO" else "Review preparation" if run["action"]=="REVIEW" else "Alerts only"} · {run["symbol"]} · step {sequence.index+1} of {len(sequence.rows)}'+(' · '+sequence.structure_state['status'] if sequence.structure_state else '')+'. Settings frozen at Start; tracked swing levels may update. Continues while the browser is hidden.'
        except MonitorInterruption as error:self._pause_quote(error)
        except EntryQualitySkipped as error:
            run['sent']=False;run['review']=None;self._finish(str(error)+' Start explicitly for a new setup.','skipped')
        except ConditionInvalidated as error:
            run['sent']=False
            self._check_invalidation(dict(bid=error.bid,quote_time=self.clock()))
        except Exception as error:
            self._finish(('Finished: ' if run['attempted'] else 'Stopped: ')+str(error)+' No automatic retry. Check MT5 before starting again.','finished' if run['attempted'] else 'stopped')

    def _confirmation_ready(self,data):
        run=self.run;plan=run['settings'].get('autoPlan') or {}
        if run['action']=='ALERT' or not plan.get('enabled') or plan.get('entry')!='CONFIRM':return True
        state=run.get('retest_confirmation')
        if state is None:
            direction=1 if run['settings']['ticket']['side']=='BUY' else -1
            signal=next((e for e in reversed(run['observations']) if e.get('structure',{}).get('direction')==direction),None)
            if not signal:raise EntryQualitySkipped('Retest confirmation requires an observed matching BOS/MS break.')
            frame=run['rows'][signal['index']]['timeframe'];history=closed(self._market(frame))
            if not history:raise EntryQualitySkipped('Confirmation candle history unavailable.')
            state=dict(level=signal['structure']['level'],direction=direction,timeframe=frame,last_candle=history[-1]['time'],last_bar=copy.deepcopy(history[-1]),expires=self.clock()+plan['expiry']*60,touched=False)
            run['retest_confirmation']=state;self._event('Waiting retest','Conditions passed; waiting for a future retest and rejection close.')
        if self.clock()>=state['expires']:raise EntryQualitySkipped('Retest confirmation expired without entry.')
        history=closed(self._market(state['timeframe']));newer=[bar for bar in history if bar['time']>state['last_candle']]
        if len(newer)>1:raise EntryQualitySkipped('Confirmation candles were missed. Start again; no signal replay.')
        if newer:
            bar=newer[0];state['last_candle']=bar['time'];state['last_bar']=copy.deepcopy(bar);buy=state['direction']==1
            if (bar['low']<=state['level'] if buy else bar['high']>=state['level']):state['touched']=True
            rejected=bar['close']>state['level'] and bar['close']>bar['open'] if buy else bar['close']<state['level'] and bar['close']<bar['open']
            if state['touched'] and rejected:
                run['observations'].append(dict(type='retest_confirmed',observed_at=int(self.clock()*1000),level=state['level'],candle=bar,bid=data['bid']))
                run['observations']=run['observations'][-100:]
                state['message']='Retest confirmed; preparing market entry.';self._event('Retest confirmed',state['message']);return True
        state['message']=f"Waiting for {state['timeframe']} {'bullish' if state['direction']==1 else 'bearish'} rejection close {'above' if state['direction']==1 else 'below'} {state['level']} after retest. {'Retest observed.' if state['touched'] else 'Retest not yet observed.'}"
        run['message']=state['message'];return False

    def _complete(self,data):
        run=self.run
        if run['attempted']:return
        run['attempted']=True;run['phase']='finishing'
        if run['action']=='ALERT':self._finish('All conditions passed. Finished — click Start conditions to start again.');return
        settings=run['settings'];ticket=settings['ticket'];plan=settings.get('autoPlan') or {'enabled':False}
        body=dict(symbol=run['symbol'],side=ticket['side'],order_kind=ticket['order-kind'],price=ticket.get('order-price'),volume=ticket.get('volume'),sl=ticket.get('sl'),tp=ticket.get('tp'),
                  condition_entry=True,condition_entry_quality=resolve_quality(settings.get('entryQuality'),run['rows'],run['observations']),condition_invalidation=copy.deepcopy(run['invalidation']),expected_account=run['account'],expected_server=run['server'],condition_risk_auto=settings['sizing']=='AUTO',
                  condition_monitor_id=run['id'],condition_setup=dict(monitor_id=run['id'],name=run.get('name',''),group=run.get('group',''),group_policy=run.get('group_policy','ALL'),started=run['started'],completed=int(self.clock()*1000),action=run['action'],rows=copy.deepcopy(run['rows']),settings=copy.deepcopy(settings),observations=copy.deepcopy(run['observations']),invalidation=copy.deepcopy(run['invalidation']),monitor='local server'))
        if plan.get('enabled'):
            candles=closed(self._market(plan['timeframe']));tracker=Structure(plan['sensitivity'])
            for bar in candles:tracker.push(bar)
            swings=tracker.lows if body['side']=='BUY' else tracker.highs;swing=swings[-1] if swings else None
            if not swing or swing['broken']:raise ValueError('A usable confirmed stop swing is unavailable.')
            direction=1 if body['side']=='BUY' else -1
            trigger=next((e['structure'] for e in reversed(run['observations']) if e.get('structure',{}).get('direction')==direction),{})
            result=self.terminal.condition_plan(dict(body,auto_plan=plan,stop_swing=dict(price=swing['price'],time=swing['time'],confirmed_time=swing['confirmed']),retest_level=trigger.get('level'),signal_candle=trigger.get('candle')))
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
        run['_prepared_preview']=result['preview']
        if body['condition_entry_quality'].get('enabled'):
            quote=self._market('M1')
            if self._check_invalidation(quote):
                self.terminal.previews.pop(result['preview'],None);return
            request=result['request'];quality_entry=(quote['ask'] if body['side']=='BUY' else quote['bid']) if result.get('order_kind')=='MARKET' else float(request['price'])
            try:run['entry_quality_result']=check_quality(body['condition_entry_quality'],quality_entry,float(request['sl']),float(request['tp']),body['side'],quote.get('point',0),result.get('order_kind')=='MARKET')
            except EntryQualitySkipped:
                self.terminal.previews.pop(result['preview'],None);raise
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
        if getattr(self,'before_send',None):self.before_send(self)
        sent=self.terminal.submit({'preview':result['preview']});run['result']=sent
        self._finish(f'Finished · broker {sent["retcode"]}: {sent["comment"]}. Order {sent["order"]}, deal {sent["deal"]}. '+sent.get('journal_warning','Setup saved to journal.' if sent.get('journal_recorded') else '')+' No automatic retry.')

    def record_submission(self,body,result=None,error=None):
        run=self.run
        if not run or run['phase']!='review' or body.get('preview')!=run['review']['preview']:return
        if isinstance(error,EntryQualitySkipped):
            run['review']=None;run['sent']=False;self._finish(str(error)+' Start explicitly for a new setup.','skipped');return
        if isinstance(error,ConditionInvalidated):self._check_invalidation(dict(bid=error.bid,quote_time=self.clock()));return
        run['review']=None;run['result']=copy.deepcopy(result)
        self._finish('Finished: '+(str(error)+' Check MT5. No automatic retry.' if error else f'broker {result["retcode"]}: {result["comment"]}. Check MT5 for final execution status.'))


class ConditionMonitor:
    """Registry of independent runners; all broker work shares one API lock."""
    ACTIVE=('running','paused','resuming','review','finishing')
    def __init__(self,terminal,lock,clock=time.time,interval=2,storage_path=None,keep_awake=None,resume_policy=None):
        self.terminal=terminal;self.lock=lock;self.clock=clock;self.interval=interval
        self.runners={};self.estimates={};self.requests={};self.latest=None;self.generation=0;self.registry_id=secrets.token_hex(16);self.snapshot_revision=0
        self.shutdown=threading.Event();self.thread=None;self._closing=False;self.storage_warning='';self._store_signature=None;self._store_load_blocked=False;self._journal_sync_at=-float('inf');self.journal_sync=None
        self.keep_awake=keep_awake;self.resume_policy=resume_policy or RestartPolicy();self.resume_warning=''
        self.store=MonitorStore(storage_path) if storage_path is not None else None
        self._load_saved()

    @property
    def run(self):
        runner=self.runners.get(self.latest)
        return runner.run if runner else None

    def launch(self):
        if self.thread:return
        self.thread=threading.Thread(target=self._loop,name='condition-monitors',daemon=True);self.thread.start()

    def _loop(self):
        try:
            while not self.shutdown.wait(self.interval):
                with self.lock:self.tick()
        finally:
            if self.keep_awake:self.keep_awake.close()

    def _sync_keep_awake(self):
        if self.keep_awake:return self.keep_awake.update(0 if self._closing else sum(runner.run['phase'] in self.ACTIVE for runner in self.runners.values()))
        return dict(enabled=False,requested=False,needed=0,state='unavailable',power_source='unknown',message='Keep-awake protection not configured.')

    def configure_keep_awake(self,body):
        if not self.keep_awake:raise ValueError('Keep-awake protection not configured.')
        self.keep_awake.configure(body.get('enabled'));return self.status()

    def begin_shutdown(self):
        self.shutdown.set()
        with self.lock:
            if self._closing:return
            try:self._persist(strict=True,records=self._records(for_restart=True))
            except Exception:pass # No durable handoff means no automatic resume.
            self._closing=True;self.signal_stop({'all':True})
            if self.keep_awake:self.keep_awake.close()

    def close(self):
        self.begin_shutdown()
        if self.thread:self.thread.join()
        with self.lock:self.stop({'all':True,'reason':'Stopped: TradeTrace server is shutting down.'},persist=False)

    def _records(self,runners=None,exclude=None,for_restart=False):
        records=[]
        for key,runner in (self.runners if runners is None else runners).items():
            if key==exclude:continue
            run=runner.run
            if run.get('_dismissed'):continue
            uncertain=bool(run.get('_submission_intent') or run.get('sent') and not run.get('result'))
            historical=completed_history(run)
            eligible=historical or run['phase'] in self.ACTIVE or run['phase']=='saved' or run['phase']=='stopped' and ((run.get('interruption') or {}).get('enabled') or run.get('_preserve_for_restart')) or uncertain
            if not eligible:continue
            prior=run.get('saved') or {};request=self.requests.get(run.get('request_id'))
            records.append(dict(id=run['id'],name=run.get('name',''),account=run['account'],server=run['server'],demo=run['demo'],symbol=run['symbol'],settings=copy.deepcopy(run['settings']),rows=copy.deepcopy(run['rows']),
                               group=run.get('group',''),group_policy=run.get('group_policy','ALL'),invalidation=copy.deepcopy(run['invalidation']),started=run['started'],
                               previous_phase=prior.get('previous_phase',run['phase']),uncertain=uncertain or bool(prior.get('uncertain')),request_id=run.get('request_id'),fingerprint=request[0] if request else prior.get('fingerprint')))
            if for_restart and self.resume_policy.enabled and not uncertain:
                progress=checkpoint(run,records[-1],self.clock(),secrets.token_hex(16))
                if progress is not None:records[-1]['restart']=progress
            if historical:
                records[-1]['history']=dict(phase=run['phase'],result=copy.deepcopy(run.get('result')),message=run.get('message',''),sent=bool(run.get('sent')),attempted=bool(run.get('attempted')),index=run['sequence'].index)
        active_ids={key for key,runner in (self.runners if runners is None else runners).items() if runner.run['phase'] in self.ACTIVE}
        while len(records)>100:
            removable=next((i for i,record in enumerate(records) if record['id'] not in active_ids),None)
            if removable is None:raise ValueError('Too many active setups to save.')
            records.pop(removable)
        return records

    def _persist(self,strict=False,records=None):
        if not self.store or self._closing:return True
        if self._store_load_blocked and not strict:return False
        try:
            records=self._records() if records is None else records;signature=json.dumps(records,sort_keys=True,allow_nan=False)
            if signature!=self._store_signature:self.store.save(records,int(self.clock()*1000));self._store_signature=signature
            self.storage_warning='';self._store_load_blocked=False;return True
        except Exception as error:
            self.storage_warning='Setups could not be saved: '+str(error)
            if strict:raise ValueError(self.storage_warning) from error
            return False

    def _load_saved(self):
        if not self.store:return
        try:data=self.store.load()
        except Exception as error:self._store_load_blocked=True;self.storage_warning='Saved setups could not be loaded; the original file is preserved. '+str(error);return
        failures=0;recorded_submission_ids=set()
        journal=getattr(getattr(self.terminal,'bridge',None),'journal',None)
        if journal and hasattr(journal,'monitor_history_records'):
            try:
                known={record.get('id') for record in data['records'] if isinstance(record,dict)}
                journal_records=journal.monitor_history_records();recorded_submission_ids={record['id'] for record in journal_records}
                recovered=[record for record in journal_records if record['id'] not in known]
                data['records']=(recovered+data['records'])[-100:]
            except Exception as error:self.storage_warning='Journal setup recovery unavailable: '+str(error)
        claimed={}
        try:claimed=consume_checkpoints(self.store,data['records'],self.clock())
        except Exception as error:
            self.resume_warning='Restart checkpoint could not be consumed; setups remain disarmed. '+str(error)
            self._store_load_blocked=True;self.storage_warning=self.resume_warning
        for record in data['records']:
            try:
                if not isinstance(record,dict):raise ValueError('Invalid record.')
                rid=record['id'];settings=copy.deepcopy(record['settings']);ticket=settings['ticket']
                if not isinstance(rid,str) or len(rid)!=32 or any(char not in '0123456789abcdef' for char in rid) or rid in self.runners:raise ValueError('Invalid saved identifier.')
                if settings.get('action') not in ('ALERT','REVIEW','AUTO') or settings.get('sizing') not in ('MANUAL','AUTO') or ticket.get('side') not in ('BUY','SELL') or ticket.get('order-kind') not in ('MARKET','PENDING'):raise ValueError('Invalid saved execution settings.')
                if not all(isinstance(record.get(key),str) and record[key] for key in ('account','server','symbol')):raise ValueError('Missing saved account or symbol.')
                if not isinstance(record.get('demo'),bool) or not isinstance(record.get('name',''),str) or len(record.get('name',''))>80 or not isinstance(record.get('group',''),str) or len(record.get('group',''))>60 or record.get('group_policy','ALL') not in ('ALL','FIRST_ENTRY'):raise ValueError('Invalid saved metadata.')
                timeout=float(settings['timeout']);gap=float(settings['gap'])
                if not all(math.isfinite(value) and value>=0 for value in (timeout,gap)):raise ValueError('Invalid saved timing.')
                sequence=Sequence(record['rows'],timeout*60,gap);validate_quality(settings.get('entryQuality'),sequence.rows)
                for key in ('autoPlan','invalidation'):
                    if settings.get(key) is not None and not isinstance(settings[key],dict):raise ValueError('Invalid saved plan.')
                guard=copy.deepcopy(record.get('invalidation') or {'enabled':False})
                if not isinstance(guard,dict) or guard.get('enabled') and (not finite(guard.get('level')) or guard['level']<=0 or guard.get('direction') not in ('BELOW','ABOVE')):raise ValueError('Invalid previous cancellation level.')
                self.generation+=1;runner=ConditionRun(self.terminal,self.lock,self.clock,self.interval)
                saved=dict(saved_at=data.get('saved_at'),previous_phase=record.get('previous_phase','running'),uncertain=bool(record.get('uncertain')),fingerprint=record.get('fingerprint'))
                runner.run=dict(id=rid,generation=self.generation,request_id=record.get('request_id'),scope=json.dumps([record['server'],record['account']],separators=(',',':')),account=record['account'],server=record['server'],demo=record['demo'],symbol=record['symbol'],
                                name=record.get('name','') or record['symbol']+' saved setup',group=record.get('group',''),group_policy=record.get('group_policy','ALL'),settings=settings,rows=sequence.rows,sequence=sequence,action=settings['action'],phase='saved',attempted=False,sent=False,
                                started=record.get('started') if finite(record.get('started')) else int(self.clock()*1000),last_poll=None,last_quote_time=None,last_observed_at=None,interruption=None,invalidation=guard,invalidation_trigger=None,
                                events=[],event_no=0,observations=[],review=None,result=None,saved=saved,_cancel=threading.Event(),message='Saved—review to restart. Automatic entry is disarmed; every step starts from the beginning.'+(' Previous submission outcome may be uncertain. Check MT5 positions/history before re-arming.' if saved['uncertain'] else ''))
                history=record.get('history')
                if history is not None:
                    if not isinstance(history,dict) or history.get('phase') not in ('finished','skipped','invalidated') or history.get('result') is not None and not isinstance(history['result'],dict):raise ValueError('Invalid saved history.')
                    runner.run.update(phase=history['phase'],result=copy.deepcopy(history.get('result')),message=str(history.get('message','Finished setup restored from history.')),sent=bool(history.get('sent')),attempted=bool(history.get('attempted')),saved=None)
                    index=history.get('index',len(sequence.rows))
                    if not isinstance(index,int) or not 0<=index<=len(sequence.rows):raise ValueError('Invalid saved progress.')
                    sequence.index=index
                if history is None and self.resume_policy.enabled and rid in claimed and not saved['uncertain']:
                    try:
                        if rid in recorded_submission_ids:
                            saved['uncertain']=True;raise ValueError('A submitted execution for this setup is already in the journal. Check MT5.')
                        snap=claimed[rid]
                        if not all(finite(snap.get(key)) and 0<=self.clock()-snap[key]<=MAX_RESTART_GAP for key in ('captured_at','last_observed_at','last_quote_time')):raise ValueError('Restart gap is over 30 seconds or timestamps changed.')
                        restored,observations,confirmation=restore_sequence(record,snap)
                        if sum(item.run['phase']=='resuming' for item in self.runners.values())>=20:raise ValueError('Automatic resume limit reached.')
                        runner.run.update(phase='resuming',_restart_checkpoint=snap,_restart_sequence=restored,_restart_observations=observations,_restart_confirmation=confirmation,safe_resume=dict(state='checking',deadline=min(snap['last_observed_at'],snap['last_quote_time'])+MAX_RESTART_GAP),message='Checking clean-restart continuity. Orders are blocked until account, quotes, cancellation and candle checks pass.')
                    except Exception as error:runner.run['message']='Saved—automatic resume blocked: '+str(error)+' Review and explicitly Start.'
                runner.before_send=self._before_auto_send;runner._event('Restored history' if history is not None else 'Restored disarmed',runner.run['message']);self.runners[rid]=runner;self.latest=rid
                request_id=record.get('request_id');fingerprint=record.get('fingerprint')
                if isinstance(request_id,str) and 8<=len(request_id)<=100 and isinstance(fingerprint,str) and len(fingerprint)==64:self.requests[request_id]=(fingerprint,rid)
            except Exception:failures+=1
        if failures:self._store_load_blocked=True;self.store.read_error=True;self.storage_warning=f'{failures} saved setup(s) could not be loaded; valid setups were restored disarmed.'

    def _disarm_resume(self,runner,reason):
        run=runner.run;run['phase']='saved';run['safe_resume']=dict(state='blocked',reason=reason)
        run['message']='Saved—automatic resume blocked: '+reason+' Review and explicitly Start.'
        for key in ('_restart_checkpoint','_restart_sequence','_restart_observations','_restart_confirmation'):run.pop(key,None)
        runner._event('Restart resume blocked',run['message'])

    def _try_resume(self,runner):
        run=runner.run;now=self.clock();snap=run['_restart_checkpoint'];sequence=run['_restart_sequence'];confirmation=run.get('_restart_confirmation')
        if not self.resume_policy.enabled:self._disarm_resume(runner,'Automatic resume was disabled.');return
        if now>=run['safe_resume']['deadline']:self._disarm_resume(runner,'Restart gap exceeded 30 seconds or MT5 was not ready.');return
        if run['_cancel'].is_set():self._disarm_resume(runner,'The setup was stopped.');return
        step=sequence.rows[sequence.index] if not sequence.done else None
        frame=confirmation['timeframe'] if confirmation else step['timeframe'] if step and step['mode']=='CANDLE' else 'M1'
        try:
            data=runner._market(frame)
            if not all(finite(data.get(key)) and data[key]>0 for key in ('bid','ask')) or data['bid']>data['ask']:raise ValueError('Broker quote is invalid.')
            if data['quote_time']<=snap['last_quote_time']:return
            if runner._guard_hit(run['invalidation'],data['bid']):raise ValueError('Frozen cancellation level has been reached.')
            if sequence.timeout>0 and sequence.started is not None and data['quote_time']-sequence.started>sequence.timeout:raise ValueError('Sequence timeout expired during restart.')
            if sequence.gap>0 and sequence.last_time is not None and data['quote_time']-sequence.last_time>sequence.gap:raise ValueError('Configured quote-gap reset elapsed during restart.')
            if confirmation and now>=confirmation['expires']:raise ValueError('Retest confirmation window expired.')
            if confirmation or step and step['mode']=='CANDLE':
                expected=confirmation['last_candle'] if confirmation else getattr(sequence.tracker,'last_time',None) if sequence.tracker else sequence.candle
                bars=closed(data)
                if expected is None or not bars or bars[-1]['time']!=expected or not any(bar['time']==expected for bar in bars):raise ValueError('A required closed candle was missed or history changed.')
                recorded=snap.get('continuity_candle')
                if not isinstance(recorded,dict) or any(bars[-1].get(key)!=recorded.get(key) for key in ('time','open','high','low','close')):raise ValueError('The last observed closed candle was revised or cannot be verified.')
                run['_last_closed_snapshot']=dict(index=sequence.index,timeframe=frame,candle=copy.deepcopy(bars[-1]))
            sequence.previous=data['bid'];sequence.memory={};sequence.last_time=data['quote_time']
            run.update(sequence=sequence,observations=run['_restart_observations'],retest_confirmation=confirmation,phase='running',saved=None,last_poll=now,last_quote_time=data['quote_time'],last_observed_at=now,safe_resume=dict(state='resumed',at=int(now*1000)),message='Resumed after a clean server restart. Progress retained; live sampling re-baselined. No entry evaluated on the recovery poll.')
            for key in ('_restart_checkpoint','_restart_sequence','_restart_observations','_restart_confirmation'):run.pop(key,None)
            runner._event('Restart resumed',run['message'])
        except MonitorInterruption as error:run['message']='Checking restart: '+str(error)+' Orders remain blocked until the 30-second window expires.'
        except Exception as error:self._disarm_resume(runner,str(error))

    def configure_restart_resume(self,body):
        if self.shutdown.is_set():raise ValueError('Server is shutting down.')
        self.resume_policy.configure(body.get('enabled'))
        if not self.resume_policy.enabled:
            for runner in self.runners.values():
                if runner.run['phase']=='resuming':self._disarm_resume(runner,'Automatic resume was disabled.')
        return self.status()

    def _before_auto_send(self,runner):
        if self.shutdown.is_set() or runner.run['_cancel'].is_set():raise ValueError('Server is stopping. No order was sent.')
        runner.run['_submission_intent']=True
        try:self._persist(strict=True)
        except Exception:
            runner.run.pop('_submission_intent',None);runner.run['sent']=False
            if runner.run.get('_prepared_preview'):self.terminal.previews.pop(runner.run['_prepared_preview'],None)
            raise

    def status(self,body=None):
        body=body or {};selected=body.get('id',self.latest)
        runs=[runner.status()['run'] for runner in self.runners.values()]
        self.snapshot_revision+=1
        return dict(run=next((run for run in runs if run['id']==selected),None),runs=runs,registry_id=self.registry_id,snapshot_revision=self.snapshot_revision,storage_warning=self.storage_warning,journal_sync=copy.deepcopy(self.journal_sync),keep_awake=self._sync_keep_awake(),restart_resume=dict(enabled=self.resume_policy.enabled,max_gap_seconds=MAX_RESTART_GAP,checking=sum(runner.run['phase']=='resuming' for runner in self.runners.values()),error=self.resume_policy.error or self.resume_warning))

    def start(self,body):
        if self.shutdown.is_set():raise ValueError('The server is shutting down. No new setup was started.')
        request_id=body.get('request_id')
        fingerprint=hashlib.sha256(json.dumps(body,sort_keys=True,allow_nan=False).encode()).hexdigest()
        if isinstance(request_id,str) and request_id in self.requests:
            old,run_id=self.requests[request_id]
            if old!=fingerprint:raise ValueError('Start request already used with different settings.')
            return self.status({'id':run_id})
        name=body.get('name','');group=body.get('group','');policy=body.get('group_policy','ALL')
        if not isinstance(name,str) or len(name)>80 or not isinstance(group,str) or len(group)>60 or policy not in ('ALL','FIRST_ENTRY'):
            raise ValueError('Use a setup name up to 80 characters and a group up to 60 characters.')
        group=group.strip()
        if policy=='FIRST_ENTRY' and not group:raise ValueError('Name a linked group for first-entry cancellation.')
        replace=body.get('replace_id') if body.get('multiple') else self.latest
        if replace and replace not in self.runners:raise ValueError('Setup no longer exists. Start a new independent draft.')
        active=[runner for key,runner in self.runners.items() if key!=replace and runner.run['phase'] in self.ACTIVE]
        if len(active)>=20:raise ValueError('Up to 20 setups can monitor at once. Stop a setup first.')
        for runner in active:
            run=runner.run
            if group and (run['account'],run['server'],run['symbol'],run.get('group'))==(str(body.get('expected_account')),body.get('expected_server'),body.get('symbol'),group) and run.get('group_policy')!=policy:
                raise ValueError('Linked setups on the same symbol must use the same group policy.')
        # Validate/freeze the complete new setup before stopping a replaced runner.
        runner=ConditionRun(self.terminal,self.lock,self.clock,self.interval);runner.start(body)
        next_generation=self.generation+1;run=runner.run;run.update(generation=next_generation,name=name.strip() or f'{run["symbol"]} {run["settings"]["ticket"]["side"]} #{next_generation}',group=group,group_policy=policy)
        prospective={**self.runners,run['id']:runner};replaced_history=bool(replace and completed_history(self.runners[replace].run));records=self._records(prospective,exclude=None if replaced_history else replace)
        records[-1]['fingerprint']=fingerprint
        self._persist(strict=True,records=records)
        if replace and not replaced_history:self.runners[replace].run['_dismissed']=True;self.runners[replace].stop({'reason':'Stopped: replaced by an explicitly restarted setup.'})
        self.generation=next_generation;runner.before_send=self._before_auto_send
        self.runners[run['id']]=runner;self.latest=run['id'];self.requests[request_id]=(fingerprint,run['id'])
        # Bound completed history, without ever dropping an active setup.
        for key in list(self.runners):
            if len(self.runners)<=100:break
            if key!=self.latest and self.runners[key].run['phase'] not in self.ACTIVE:del self.runners[key]
        return self.status()

    def estimate(self,body):
        run_id=body.get('id');runner=self.runners.get(run_id) if isinstance(run_id,str) else None
        if not runner:raise ValueError('Choose an existing monitor to estimate.')
        previous=self.estimates.get(run_id)
        if previous and previous['phase']==runner.run['phase'] and 0<=self.clock()-previous['time']<3:return dict(estimate=copy.deepcopy(previous['value']))
        try:value=estimate_run(runner)
        except Exception as error:value=dict(id=run_id,status='unavailable',at=int(self.clock()*1000),reason=str(error),note='Estimate unavailable; monitoring is unchanged.')
        self.estimates[run_id]=dict(time=self.clock(),phase=runner.run['phase'],value=value)
        for key in list(self.estimates):
            if key not in self.runners:del self.estimates[key]
        return dict(estimate=copy.deepcopy(value))

    def _targets(self,body):
        if body.get('all') or not body.get('id'):return list(self.runners.values())
        runner=self.runners.get(body.get('id') or self.latest)
        return [runner] if runner else []

    def stop(self,body=None,*,persist=True):
        body=body or {}
        for runner in self._targets(body):
            if completed_history(runner.run):continue
            runner.run['_dismissed']=True;runner.stop({key:value for key,value in body.items() if key!='id'})
        if persist:self._persist()
        return self.status({'id':body.get('id') or self.latest})

    def signal_stop(self,body):
        # Iteration snapshot permits cancellation intent outside the API lock.
        # An omitted id is also used by shutdown and must cancel every runner.
        for runner in list(self.runners.values()):
            if body.get('all') or not body.get('id') or runner.run['id']==body['id']:runner.signal_stop({})

    def _stop_linked(self,winner,uncertain=False):
        run=winner.run
        if not run.get('group') or run.get('group_policy')!='FIRST_ENTRY':return
        for runner in self.runners.values():
            other=runner.run
            if runner is not winner and (other['scope'],other['symbol'],other.get('group'))==(run['scope'],run['symbol'],run['group']):
                runner.stop({'reason':f'Stopped: linked setup “{run["name"]}” '+('had an uncertain submission; check MT5.' if uncertain else 'submitted an entry. First entry stops this group.')})

    def tick(self):
        self._sync_keep_awake()
        try:self._tick()
        finally:self._sync_keep_awake()

    def _tick(self):
        for runner in list(self.runners.values()):
            if runner.run['phase']=='resuming':self._try_resume(runner);continue
            if runner.run['phase'] not in self.ACTIVE:continue
            try:runner.tick()
            except Exception as error:runner._finish('Stopped: monitoring failed. '+str(error)+' Check MT5.','stopped')
            result=runner.run.get('result')
            if result is not None:runner.run.pop('_submission_intent',None)
            elif runner.run['phase'] in ('skipped','invalidated') and not runner.run.get('sent'):runner.run.pop('_submission_intent',None)
            if result and result.get('retcode') in (10008,10009,10010):self._stop_linked(runner)
            elif runner.run.get('sent') and not result:self._stop_linked(runner,uncertain=True)
        pending=[runner for runner in self.runners.values() if (runner.run.get('result') or {}).get('operation')=='pending' and (runner.run.get('result') or {}).get('retcode') in (10008,10009,10010) and (runner.run.get('trade_outcome') or {}).get('state') not in ('closed','cancelled','expired','rejected') and self.clock()-runner.run.get('_outcome_probe_at',-float('inf'))>=10]
        if pending:
            runner=min(pending,key=lambda item:item.run.get('_outcome_probe_at',-float('inf')));runner.run['_outcome_probe_at']=self.clock()
            try:
                from condition_outcome import outcome
                runner.run['trade_outcome']=outcome(self.terminal,runner.run);runner.run.pop('outcome_error',None)
            except Exception as error:runner.run['outcome_error']=str(error)
        bridge=getattr(self.terminal,'bridge',None)
        if bridge and callable(getattr(bridge,'sync_condition_trades',None)) and self.clock()-self._journal_sync_at>=10:
            self._journal_sync_at=self.clock()
            try:self.journal_sync=dict(bridge.sync_condition_trades(),checked_at=self.clock())
            except Exception as error:self.journal_sync=dict(error=str(error),checked_at=self.clock())
        due=[runner for runner in self.runners.values() if runner.run['phase']=='stopped' and runner.run.get('interruption',{} ) and runner.run['interruption'].get('enabled') and self.clock()-runner.run.get('_recovery_probe_time',-float('inf'))>=10]
        if due:
            runner=min(due,key=lambda item:item.run.get('_recovery_probe_time',-float('inf')));runner.run['_recovery_probe_time']=self.clock();runner.recovery()
        self._persist()

    def recovery(self,body):
        runner=self.runners.get(body.get('id'))
        if not runner:raise ValueError('Choose an existing monitor.')
        runner.recovery();return self.status({'id':runner.run['id']})

    def _review_runner(self,body):
        return next((runner for runner in self.runners.values() if runner.run['phase']=='review' and runner.run.get('review',{}).get('preview')==body.get('preview')),None)

    def before_submission(self,body):
        if self.shutdown.is_set():raise ValueError('Server is stopping; order review cannot send.')
        runner=self._review_runner(body)
        if runner:
            runner.before_submission(body)
            runner.run['_submission_intent']=True
            try:self._persist(strict=True)
            except Exception:
                runner.run.pop('_submission_intent',None);self.terminal.previews.pop(body.get('preview'),None)
                raise

    def record_submission(self,body,result=None,error=None):
        runner=self._review_runner(body)
        if not runner:return
        runner.record_submission(body,result,error)
        if result is not None or isinstance(error,(ConditionInvalidated,EntryQualitySkipped)):runner.run.pop('_submission_intent',None)
        if result and result.get('retcode') in (10008,10009,10010):self._stop_linked(runner)
        elif error and not isinstance(error,(ConditionInvalidated,EntryQualitySkipped)):self._stop_linked(runner,uncertain=True)
        self._persist()
