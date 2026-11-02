"""Price-based entry filters, frozen per condition setup and rechecked at send."""
import copy
from condition_engine import finite, STRUCTURE, ZONES


class EntryQualitySkipped(ValueError):
    pass


def validate_quality(settings,rows=None):
    if settings is None:return dict(enabled=False)
    if not isinstance(settings,dict) or not isinstance(settings.get('enabled',False),bool):raise ValueError('Invalid entry quality settings.')
    if not settings.get('enabled'):return dict(enabled=False)
    result=copy.deepcopy(settings)
    for field in ('max_distance','min_rr','target'):
        value=result.get(field,0)
        if not finite(value) or value<0:raise ValueError('Entry quality values must be finite and nonnegative.')
        result[field]=value
    if not result['max_distance'] and not result['min_rr']:raise ValueError('Enable a maximum distance or minimum RR check.')
    if result['min_rr']>100:raise ValueError('Minimum RR must be at most 100.')
    if result['max_distance'] and rows is not None:
        step=result.get('reference_step')
        if not finite(step) or int(step)!=step or not 1<=step<=len(rows):raise ValueError('Choose an existing condition as the distance reference.')
        result['reference_step']=int(step)
    return result


def resolve_quality(settings,rows,observations):
    result=validate_quality(settings,rows)
    if not result.get('enabled') or not result['max_distance']:return result
    index=result['reference_step']-1;row=rows[index]
    if row['rule'] in ZONES:low,high=row['low'],row['high']
    elif row['rule'] in STRUCTURE:
        event=next((e for e in reversed(observations) if e.get('type')=='passed' and e.get('index')==index and e.get('structure')),None)
        if not event:raise EntryQualitySkipped('Skipped: reference structure break was not observed. No order sent.')
        low=high=event['structure']['level']
    else:low=high=row['level']
    result['reference']=dict(low=low,high=high,step=index+1,rule=row['rule'])
    return result


def check_quality(settings,entry,sl,tp,side,point=0,market=False):
    guard=validate_quality(settings)
    if not guard.get('enabled'):return None
    if side not in ('BUY','SELL') or not all(finite(v) and v>0 for v in (entry,sl,tp)):raise EntryQualitySkipped('Skipped: valid entry, SL and TP are required for entry-quality checks. No order sent.')
    direction=1 if side=='BUY' else -1
    if not finite(point) or point<0:raise ValueError('Invalid broker point size.')
    modeled=entry+direction*20*point if market else entry
    result=dict(entry=entry,modeled_entry=modeled,max_distance=guard['max_distance'],min_rr=guard['min_rr'],target=guard['target'])
    if guard['max_distance']:
        reference=guard.get('reference') or {};low=reference.get('low');high=reference.get('high')
        if not all(finite(v) and v>0 for v in (low,high)) or low>high:raise ValueError('Invalid frozen entry-distance reference.')
        # Use the worse distance of quote and adverse modeled fill.
        distance=max(max(low-entry,0,entry-high),max(low-modeled,0,modeled-high))
        result.update(distance=distance,reference=reference)
        if distance>guard['max_distance']+1e-8:raise EntryQualitySkipped(f'Skipped: entry distance {distance:.5f} exceeds maximum {guard["max_distance"]:g} from condition {reference.get("step","?")}. No order sent.')
    if guard['min_rr']:
        risk=direction*(modeled-sl);reward=direction*(tp-modeled)
        if guard['target']:reward=min(reward,direction*(guard['target']-modeled))
        if risk<=0 or reward<=0:raise EntryQualitySkipped('Skipped: SL or target is on the wrong side of entry; no usable RR. No order sent.')
        ratio=reward/risk;result['rr']=ratio
        if ratio+1e-8<guard['min_rr']:raise EntryQualitySkipped(f'Skipped: available RR 1:{ratio:.2f} is below minimum 1:{guard["min_rr"]:g}. No order sent.')
    return result
