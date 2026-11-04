"""Read-only projection of frozen monitor settings; never creates a review token."""
import copy
import math
from condition_engine import Structure,finite
from entry_quality import resolve_quality,EntryQualitySkipped


class EstimateUnavailable(ValueError):pass


def estimate_run(runner):
    run=runner.run;terminal=runner.terminal
    result=dict(id=run['id'],status='unavailable',at=int(runner.clock()*1000),note='Estimate at current quote. Conditions have not passed; prices, swings and lots are recalculated at execution. Broker checks run at execution.')
    if run['phase']!='running':return dict(result,reason='This setup is not waiting for conditions. Open its result or prepared review.')
    if run['action']=='ALERT':return dict(result,status='alert',reason='Alerts only: this setup will not place an order.')
    try:data=runner._market('M1')
    except Exception as error:return dict(result,reason=str(error))
    result.update(quote_time=data['quote_time'],currency=data.get('currency',''),digits=data.get('digits',5))
    if runner._guard_hit(run['invalidation'],data['bid']):return dict(result,status='would_skip',reason='The frozen cancellation level is reached at this quote.')
    last_reset=next((i for i in range(len(run['observations'])-1,-1,-1) if run['observations'][i].get('type')=='reset'),-1)
    observations=[event for event in run['observations'][last_reset+1:] if event.get('type')!='passed' or event.get('index',-1)<run['sequence'].index]
    settings=copy.deepcopy(run['settings']);ticket=settings['ticket'];plan=settings.get('autoPlan') or {}
    body=dict(symbol=run['symbol'],side=ticket['side'],order_kind=ticket['order-kind'],price=ticket.get('order-price'),volume=ticket.get('volume'),sl=ticket.get('sl'),tp=ticket.get('tp'),
              condition_entry=True,condition_invalidation=copy.deepcopy(run['invalidation']),expected_account=run['account'],expected_server=run['server'],condition_risk_auto=settings['sizing']=='AUTO')
    try:
        if plan.get('enabled'):
            history=runner._market(plan['timeframe']);tracker=Structure(plan['sensitivity'])
            for bar in history['bars'][:-1]:tracker.push(dict(time=bar[0]/1000,open=bar[1],high=bar[2],low=bar[3],close=bar[4]))
            swing=(tracker.lows if body['side']=='BUY' else tracker.highs)
            swing=swing[-1] if swing else None
            if not swing or swing['broken']:raise ValueError('No usable confirmed stop swing at the current quote.')
            direction=1 if body['side']=='BUY' else -1
            trigger=next((e['structure'] for e in reversed(observations) if e.get('structure',{}).get('direction')==direction),{})
            if plan['entry']=='RETEST' and not trigger:raise EstimateUnavailable('Retest entry needs an observed matching BOS/MS break; its entry price is not known yet.')
            body,calculation=terminal.calculate_condition_plan(dict(body,auto_plan=plan,stop_swing=dict(price=swing['price'],time=swing['time'],confirmed_time=swing['confirmed']),retest_level=trigger.get('level'),signal_candle=trigger.get('candle')))
            result['calculation']=calculation
        else:
            entry=(data['ask'] if body['side']=='BUY' else data['bid']) if body['order_kind']=='MARKET' else float(body['price'])
            if settings['sizing']=='AUTO':
                adverse=entry+(1 if body['side']=='BUY' else -1)*20*data.get('point',data['tick_size'])
                basis=terminal.plan(dict(symbol=run['symbol'],side=body['side'],entry=adverse,stop=float(body['sl']),target=float(body['tp']),volume=data['volume_min']))
                if (basis['account'],basis['server'])!=(run['account'],run['server']) or not finite(basis.get('risk')) or basis['risk']<=0:raise ValueError('Broker risk estimate unavailable.')
                raw=min(data['volume_max'],data['equity']*.02/basis['risk']*data['volume_min'])
                body['volume']=round(math.floor(raw/data['volume_step'])*data['volume_step'],8)
                if body['volume']<data['volume_min']:raise ValueError('Minimum lot exceeds the 2% risk budget.')
            body['price']=entry
        entry=float(body['price']) if body['order_kind']!='MARKET' or plan.get('enabled') else (data['ask'] if body['side']=='BUY' else data['bid'])
        stop,target,volume=[float(body[name]) for name in ('sl','tp','volume')]
        direction=1 if body['side']=='BUY' else -1
        modeled=entry+direction*20*data.get('point',data['tick_size']) if body['order_kind']=='MARKET' else entry
        risk=direction*(modeled-stop);reward=direction*(target-modeled)
        quality=settings.get('entryQuality') or {}
        if quality.get('enabled') and quality.get('min_rr',0)>0 and quality.get('target',0)>0:
            reward=min(reward,direction*(quality['target']-modeled));result['quality_target']=quality['target']
        result.update(entry=entry,modeled_entry=modeled,sl=stop,tp=target,volume=volume,side=body['side'],order_kind=body['order_kind'],rr=reward/risk if risk>0 and reward>0 else None)
        if result['order_kind']=='PENDING':result['order_kind']='LIMIT' if (entry<data['ask'] if body['side']=='BUY' else entry>data['bid']) else 'STOP'
        money_entry=modeled+direction*20*data.get('point',data['tick_size']) if body['order_kind']!='MARKET' and settings['sizing']=='AUTO' and not plan.get('enabled') else modeled
        result['risk_modeled_entry']=money_entry
        money=terminal.plan(dict(symbol=run['symbol'],side=body['side'],entry=money_entry,stop=stop,target=target,volume=volume))
        if (money['account'],money['server'])!=(run['account'],run['server']):raise EstimateUnavailable('Account changed during estimation.')
        if not finite(money.get('risk')) or not finite(money.get('reward')):raise EstimateUnavailable('Broker profit estimate unavailable.')
        result.update(risk=money['risk'],reward=money['reward'],currency=money.get('currency',result['currency']),risk_percent=money['risk']/data['equity']*100 if finite(data.get('equity')) and data['equity']>0 else None)
        try:resolved=resolve_quality(quality,run['rows'],observations)
        except EntryQualitySkipped:raise EstimateUnavailable('Distance check needs the observed structure break from its reference condition; that price is not known yet.')
        body['condition_entry_quality']=resolved
        if resolved.get('enabled') and resolved.get('max_distance'):
            low,high=resolved['reference']['low'],resolved['reference']['high']
            result.update(distance=max(max(low-entry,0,entry-high),max(low-modeled,0,modeled-high)),max_distance=resolved['max_distance'])
        if resolved.get('enabled'):result['min_rr']=resolved['min_rr']
        # Same local validations as execution, without MT5 order_check, tokens,
        # journal writes, attempt cooldowns or order_send.
        request,account=terminal.request(body,broker_check=False)
        if (str(account.login),account.server)!=(run['account'],run['server']):raise EstimateUnavailable('Account changed during estimation.')
        result.update(status='would_pass',reason='Local order and entry-quality checks pass at this quote. Final broker checks still run at entry.')
    except EstimateUnavailable as error:result.update(status='unavailable',reason=str(error))
    except (ValueError,TypeError,KeyError) as error:result.update(status='would_skip',reason=str(error))
    return result
