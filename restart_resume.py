"""One-use clean-restart checkpoints; never serializes broker review tokens."""
import copy
import hashlib
import json
import os
from pathlib import Path
import uuid
from condition_engine import Sequence,Structure,STRUCTURE,finite

MAX_RESTART_GAP=30


class RestartPolicy:
    def __init__(self,path=None):
        self.path=Path(path) if path else None;self.enabled=False;self.error=''
        if self.path and self.path.exists():
            try:
                value=json.loads(self.path.read_text(encoding='utf-8'))['enabled']
                if not isinstance(value,bool):raise ValueError('Invalid preference')
                self.enabled=value
            except Exception:self.error='Restart preference unreadable; automatic resume is off.'
    def configure(self,enabled):
        if not isinstance(enabled,bool):raise ValueError('Choose enabled or disabled for restart resume.')
        if self.path:
            self.path.parent.mkdir(parents=True,exist_ok=True);temporary=self.path.with_name(self.path.name+'.tmp-'+uuid.uuid4().hex)
            try:
                with temporary.open('w',encoding='utf-8') as handle:json.dump(dict(enabled=enabled),handle);handle.flush();os.fsync(handle.fileno())
                os.replace(temporary,self.path)
            finally:
                if temporary.exists():temporary.unlink()
        self.enabled=enabled;self.error=''


def configuration_hash(record):
    values={key:record.get(key) for key in ('id','account','server','demo','symbol','settings','rows','invalidation','group','group_policy')}
    return hashlib.sha256(json.dumps(values,sort_keys=True,allow_nan=False).encode()).hexdigest()


def checkpoint(run,record,now,handoff):
    seq=run['sequence']
    if run['phase']!='running' or run.get('attempted') or run.get('sent') or run.get('review') or run.get('_submission_intent') or run['_cancel'].is_set() or not seq.rows:return None
    if seq.done and not run.get('retest_confirmation'):return None
    if not finite(run.get('last_observed_at')) or not finite(run.get('last_quote_time')) or not 0<=now-run['last_observed_at']<=MAX_RESTART_GAP or not 0<=now-run['last_quote_time']<=MAX_RESTART_GAP:return None
    state={key:copy.deepcopy(getattr(seq,key)) for key in ('index','memory','previous','last_time','started','candle','done')}
    state['tracker']=copy.deepcopy(vars(seq.tracker)) if seq.tracker else None
    current=run.get('_last_closed_snapshot') or {}
    candle=run.get('retest_confirmation',{}).get('last_bar') if run.get('retest_confirmation') else seq.tracker.bars[-1] if seq.tracker and seq.tracker.bars else current.get('candle') if current.get('index')==seq.index else None
    snap=dict(version=1,ready=True,handoff=handoff,configuration=configuration_hash(record),captured_at=now,last_quote_time=run['last_quote_time'],last_observed_at=run['last_observed_at'],sequence=state,observations=copy.deepcopy(run['observations']),confirmation=copy.deepcopy(run.get('retest_confirmation')),continuity_candle=copy.deepcopy(candle))
    snap['integrity']=hashlib.sha256(json.dumps(snap,sort_keys=True,allow_nan=False).encode()).hexdigest();return snap


def consume_checkpoints(store,loaded,now):
    expected={record['id']:(record.get('restart') or {}).get('handoff') for record in loaded if isinstance(record,dict) and isinstance(record.get('restart'),dict) and record['restart'].get('ready') is True}
    if not expected:return {}
    claim=store.path.with_name(store.path.name+'.resume-claim')
    # Exclusive ownership plus a fresh read prevents two startup processes from
    # consuming the same handoff. A stale claim fails closed for manual review.
    descriptor=os.open(claim,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        latest=store.load();claimed={}
        for record in latest['records']:
            snap=record.get('restart')
            if not isinstance(snap,dict) or snap.get('ready') is not True:continue
            if record.get('id') in expected and snap.get('handoff')==expected[record['id']]:claimed[record['id']]=copy.deepcopy(snap)
            snap['ready']=False
        store.save(latest['records'],int(now*1000))
        return claimed
    finally:
        os.close(descriptor);claim.unlink()


def _number(value,optional=False,positive=False):
    if optional and value is None:return value
    if not finite(value) or positive and value<=0:raise ValueError('Invalid checkpoint number.')
    return value


def restore_sequence(record,snap):
    if not isinstance(snap,dict) or snap.get('version')!=1 or snap.get('configuration')!=configuration_hash(record):raise ValueError('Restart checkpoint does not match the saved setup.')
    payload={key:value for key,value in snap.items() if key!='integrity'}
    if snap.get('integrity')!=hashlib.sha256(json.dumps(payload,sort_keys=True,allow_nan=False).encode()).hexdigest():raise ValueError('Checkpoint integrity check failed.')
    settings=record['settings'];seq=Sequence(record['rows'],float(settings['timeout'])*60,float(settings['gap']));state=snap['sequence']
    index=state['index']
    if type(index) is not int or not 0<=index<=len(seq.rows) or type(state.get('done')) is not bool or state['done']!=(index==len(seq.rows)):raise ValueError('Invalid checkpoint progress.')
    memory=state.get('memory')
    if not isinstance(memory,dict) or any(key not in ('above','below') or not isinstance(value,bool) for key,value in memory.items()):raise ValueError('Invalid checkpoint sampling memory.')
    seq.index=index;seq.done=state['done'];seq.memory=copy.deepcopy(memory)
    for key in ('previous','last_time','started','candle'):setattr(seq,key,_number(state.get(key),optional=True,positive=key=='previous'))
    saved=state.get('tracker')
    if saved is not None:
        if index>=len(seq.rows) or seq.rows[index]['rule'] not in STRUCTURE or not isinstance(saved,dict) or saved.get('n')!=seq.rows[index]['sensitivity']:raise ValueError('Invalid checkpoint structure tracker.')
        tracker=Structure(saved['n']);bars=saved['bars']
        if not isinstance(bars,list) or not 0<len(bars)<=2*tracker.n+1:raise ValueError('Invalid checkpoint bars.')
        previous=None
        for bar in bars:
            for key in ('time','open','high','low','close'):_number(bar[key],positive=key!='time')
            if previous is not None and bar['time']<=previous or bar['high']<max(bar['open'],bar['close']) or bar['low']>min(bar['open'],bar['close']):raise ValueError('Invalid checkpoint candle.')
            previous=bar['time']
        tracker.bars=copy.deepcopy(bars);tracker.last_time=_number(saved['last_time']);tracker.count=saved['count'];tracker.bias=saved['bias']
        if tracker.last_time!=bars[-1]['time'] or type(tracker.count) is not int or tracker.count<len(bars) or tracker.bias not in (-1,0,1):raise ValueError('Invalid checkpoint tracker state.')
        pool={}
        def pivot(value,kind=None):
            if value is None:return None
            if not isinstance(value,dict) or value.get('kind') not in ('high','low') or kind and value['kind']!=kind or type(value.get('broken')) is not bool:raise ValueError('Invalid checkpoint pivot.')
            for key in ('price','time','confirmed'):_number(value[key],positive=key=='price')
            if not value['time']<value['confirmed']<=tracker.last_time:raise ValueError('Invalid checkpoint swing confirmation.')
            key=(value['kind'],value['price'],value['time'],value['confirmed'])
            if key in pool and pool[key]['broken']!=value['broken']:raise ValueError('Inconsistent checkpoint pivot.')
            if key not in pool:pool[key]=copy.deepcopy(value)
            return pool[key]
        for name,kind in (('highs','high'),('lows','low')):
            values=saved[name]
            if not isinstance(values,list) or len(values)>2:raise ValueError('Invalid checkpoint swings.')
            if any(value is None for value in values):raise ValueError('Invalid checkpoint pivot list.')
            setattr(tracker,name,[pivot(value,kind) for value in values])
        tracker.last_pivot=pivot(saved.get('last_pivot'));tracker.protected_high=pivot(saved.get('protected_high'),'high');tracker.protected_low=pivot(saved.get('protected_low'),'low')
        seq.tracker=tracker;seq.structure_state=tracker.snapshot(seq.rows[index]['rule'])
    observations=snap.get('observations')
    if not isinstance(observations,list) or len(observations)>100 or any(not isinstance(item,dict) for item in observations):raise ValueError('Invalid restart observations.')
    last_reset=max((i for i,event in enumerate(observations) if event.get('type')=='reset'),default=-1)
    passed=[event.get('index') for event in observations[last_reset+1:] if event.get('type')=='passed']
    if passed!=list(range(index)):raise ValueError('Checkpoint progress and observations disagree.')
    confirmation=snap.get('confirmation')
    if confirmation is not None:
        plan=settings.get('autoPlan') or {}
        if not seq.done or plan.get('entry')!='CONFIRM' or not plan.get('enabled') or not isinstance(confirmation,dict) or confirmation.get('direction') not in (-1,1) or type(confirmation.get('touched')) is not bool:raise ValueError('Invalid restart confirmation wait.')
        for key in ('level','last_candle','expires'):_number(confirmation[key],positive=key=='level')
        if confirmation.get('timeframe') not in ('M1','M5','M15','M30','H1','H4','D1'):raise ValueError('Invalid confirmation timeframe.')
    elif seq.done:raise ValueError('Completed conditions cannot resume as a new entry attempt.')
    return seq,copy.deepcopy(observations),copy.deepcopy(confirmation)
