"""Completed-candle / sampled-Bid rules shared in behavior with terminal-conditions.js."""
import copy
import math

FRAMES=('M1','M5','M15','M30','H1','H4','D1')
STRUCTURE=('BOS_UP','BOS_DOWN','MS_UP','MS_DOWN')
ZONES=('ZONE_ENTER','ZONE_TOUCH','CLOSE_IN_ZONE')
RULES=STRUCTURE+ZONES+('TRADED_ABOVE','TRADED_BELOW','SWEEP_ABOVE_REJECT','SWEEP_BELOW_RECLAIM','CLOSE_ABOVE','CLOSE_BELOW','CROSS_ABOVE','CROSS_BELOW')


def finite(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


def validate(rows):
    if not isinstance(rows,list) or len(rows)>100:raise ValueError('Use up to 100 conditions.')
    for i,r in enumerate(rows):
        if not isinstance(r,dict) or r.get('rule') not in RULES or r.get('mode') not in ('LIVE','CANDLE') or r.get('timeframe') not in FRAMES:
            raise ValueError(f'Condition {i+1}: invalid rule, mode or timeframe.')
        rule=r['rule']
        if (rule in STRUCTURE or rule.startswith(('CLOSE_','CROSS_'))) and r['mode']!='CANDLE':raise ValueError('This rule requires completed candles.')
        if rule in STRUCTURE:
            n=r.get('sensitivity')
            if not finite(n) or int(n)!=n or not 1<=n<=10:raise ValueError('Swing sensitivity must be 1–10.')
        elif rule in ZONES:
            if not all(finite(r.get(k)) and r[k]>0 for k in ('low','high')) or r['low']>=r['high']:raise ValueError('Invalid condition zone.')
        elif not finite(r.get('level')) or r['level']<=0:raise ValueError('Invalid condition level.')
    return copy.deepcopy(rows)


class Structure:
    def __init__(self,n=2):
        self.n=int(n);self.bars=[];self.highs=[];self.lows=[];self.last_pivot=None
        self.protected_high=None;self.protected_low=None;self.bias=0;self.last_time=None;self.count=0

    def push(self,bar):
        if not finite(bar.get('time')) or self.last_time is not None and bar['time']<=self.last_time:return []
        if not all(finite(bar.get(k)) and bar[k]>0 for k in ('open','high','low','close')):return []
        if bar['high']<max(bar['open'],bar['close']) or bar['low']>min(bar['open'],bar['close']) or bar['low']>bar['high']:return []
        previous=self.bars[-1] if self.bars else None
        self.last_time=bar['time'];self.count+=1;self.bars.append(dict(bar));self.bars=self.bars[-(2*self.n+1):]
        if len(self.bars)==2*self.n+1:
            candidate=self.bars[self.n];others=self.bars[:self.n]+self.bars[self.n+1:]
            high=all(candidate['high']>b['high'] for b in others);low=all(candidate['low']<b['low'] for b in others)
            if high!=low:
                kind='high' if high else 'low';price=candidate[kind];items=self.highs if high else self.lows
                pivot=dict(kind=kind,price=price,time=candidate['time'],confirmed=bar['time'],broken=False)
                if not self.last_pivot or self.last_pivot['kind']!=kind:
                    items.append(pivot)
                    if len(items)>2:items.pop(0)
                    self.last_pivot=pivot
                elif price>self.last_pivot['price'] if high else price<self.last_pivot['price']:
                    items[-1]=pivot;self.last_pivot=pivot
        if not self.bias and len(self.highs)==2 and len(self.lows)==2:
            h=self.highs[1]['price']-self.highs[0]['price'];l=self.lows[1]['price']-self.lows[0]['price']
            if h>0 and l>0:self.bias=1
            elif h<0 and l<0:self.bias=-1
            if self.bias:self.protected_high=self.highs[-1];self.protected_low=self.lows[-1]
        if self.bias==1 and self.lows and self.lows[-1]['price']>(self.protected_low or {}).get('price',0):self.protected_low=self.lows[-1]
        if self.bias==-1 and self.highs and self.highs[-1]['price']<(self.protected_high or {}).get('price',float('inf')):self.protected_high=self.highs[-1]
        events=[]
        pairs=[(self.protected_high if self.bias==-1 else self.highs[-1] if self.highs else None,1),
               (self.protected_low if self.bias==1 else self.lows[-1] if self.lows else None,-1)]
        for pivot,direction in pairs:
            if not pivot or pivot['broken'] or not previous:continue
            crossed=previous['close']<=pivot['price']<bar['close'] if direction==1 else previous['close']>=pivot['price']>bar['close']
            if not crossed:continue
            pivot['broken']=True
            if not self.bias:continue
            before=self.bias;kind='BOS' if before==direction else 'MS';self.bias=direction
            if kind=='MS':
                if direction==1:self.protected_low=self.lows[-1] if self.lows else None
                else:self.protected_high=self.highs[-1] if self.highs else None
            events.append(dict(type=kind,direction=direction,level=pivot['price'],swing_time=pivot['time'],confirmed_time=pivot['confirmed'],bias_before=before,bias_after=self.bias,candle=dict(bar)))
        return events

    def snapshot(self,rule):
        direction=1 if rule.endswith('_UP') else -1;ms=rule.startswith('MS')
        pivot=(self.protected_high if direction==1 else self.protected_low) if ms else (self.highs[-1] if self.highs else None) if direction==1 else (self.lows[-1] if self.lows else None)
        expected=-direction if ms else direction;context='Bullish' if self.bias==1 else 'Bearish'
        status=(f'Not enough completed candles ({self.count}/{2*self.n+1} to confirm a swing)' if self.count<2*self.n+1 else
                'Waiting for clear structure' if not self.bias else f'{context} structure; waiting for {"bullish" if expected==1 else "bearish"} context' if self.bias!=expected else
                'Waiting for a new confirmed swing' if not pivot or pivot['broken'] else f'{context} structure · watching {pivot["price"]}')
        return dict(bias=self.bias,level=pivot['price'] if pivot else None,swing_time=pivot['time'] if pivot else None,confirmed_time=pivot['confirmed'] if pivot else None,broken=bool(pivot and pivot['broken']),status=status)


def matches(r,p,b,memory):
    rule=r['rule'];level=r.get('level',0)
    if r['mode']=='LIVE' and rule=='SWEEP_ABOVE_REJECT':
        if b['close']>level:memory['above']=True
        return bool(memory.get('above')) and b['close']<level
    if r['mode']=='LIVE' and rule=='SWEEP_BELOW_RECLAIM':
        if b['close']<level:memory['below']=True
        return bool(memory.get('below')) and b['close']>level
    overlap=lambda x:x['low']<=r['high'] and x['high']>=r['low']
    if rule=='ZONE_ENTER':return overlap(b) and not overlap(p)
    if rule=='ZONE_TOUCH':return overlap(b)
    if rule=='TRADED_ABOVE':return b['high']>level
    if rule=='TRADED_BELOW':return b['low']<level
    if rule=='SWEEP_ABOVE_REJECT':return b['high']>level and b['close']<level
    if rule=='SWEEP_BELOW_RECLAIM':return b['low']<level and b['close']>level
    if rule=='CLOSE_ABOVE':return b['close']>level
    if rule=='CLOSE_BELOW':return b['close']<level
    if rule=='CROSS_ABOVE':return p['close']<=level<b['close']
    if rule=='CROSS_BELOW':return p['close']>=level>b['close']
    if rule=='CLOSE_IN_ZONE':return r['low']<=b['close']<=r['high']
    return False


class Sequence:
    def __init__(self,rows,timeout=0,gap=300):
        self.rows=validate(rows);self.timeout=timeout;self.gap=gap;self.done=False;self.reset();self.done=not rows

    def reset(self):
        if self.done:return
        self.index=0;self.memory={};self.tracker=None;self.structure_state=None;self.previous=None;self.last_time=None;self.started=None;self.candle=None;self.done=False;self.events=[]

    def observe(self,bid,time,candles=None):
        candles=candles or [];self.events=[]
        if self.done or not finite(bid) or bid<=0 or not finite(time):return False
        if self.last_time is not None and time<=self.last_time:return False
        if self.last_time is not None and self.gap>0 and time-self.last_time>self.gap:
            seconds=time-self.last_time;self.reset();self.events.append(dict(type='reset',reason='quote-gap',seconds=seconds))
        if self.started is not None and self.timeout>0 and time-self.started>self.timeout:
            seconds=time-self.started;self.reset();self.events.append(dict(type='reset',reason='timeout',seconds=seconds))
        self.last_time=time;r=self.rows[self.index];latest=candles[-1] if candles else None
        if r['rule'] in STRUCTURE:
            if self.tracker is None:
                self.tracker=Structure(r['sensitivity'])
                for bar in candles:self.tracker.push(bar)
                self.structure_state=self.tracker.snapshot(r['rule']);self.candle=latest['time'] if latest else None;self.previous=bid;return False
            newer=[bar for bar in candles if self.tracker.last_time is None or bar['time']>self.tracker.last_time];signals=[]
            for bar in newer:signals=self.tracker.push(bar)
            self.structure_state=self.tracker.snapshot(r['rule'])
            if len(newer)>1:self.structure_state['status']=f'Skipped {len(newer)} closed candles; waiting for the next close';return False
            if len(newer)!=1:return False
            found=next((e for e in signals if e['type']+('_UP' if e['direction']==1 else '_DOWN')==r['rule']),None)
            if not found:return False
            if self.index==0:self.started=time
            self.events.append(dict(type='passed',index=self.index,structure=found));self.index+=1;self.memory={};self.tracker=None;self.structure_state=None;self.candle=None;self.done=self.index==len(self.rows);return self.done
        if self.previous is None:self.previous=bid;self.candle=latest['time'] if latest else None;return False
        p=dict(low=self.previous,high=self.previous,close=self.previous);b=dict(low=bid,high=bid,close=bid);self.previous=bid
        if r['mode']=='CANDLE':
            if len(candles)<2:return False
            if self.candle is None:self.candle=latest['time'];return False
            if latest['time']<=self.candle:return False
            self.candle=latest['time'];p,b=candles[-2:]
        if not matches(r,p,b,self.memory):return False
        if self.index==0:self.started=time
        self.events.append(dict(type='passed',index=self.index));self.index+=1;self.memory={};self.candle=None;self.done=self.index==len(self.rows);return self.done
