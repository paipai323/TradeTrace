const assert=require('node:assert/strict');
const C=require('../static/terminal-conditions.js');
const live=(rule,values={})=>({rule,mode:'LIVE',timeframe:'H1',level:100,low:90,high:110,...values});
const tick=(s,bid,time,candles=[])=>s.observe({bid,time,candles});
let s=new C.Sequence([live('ZONE_ENTER')]);
assert.equal(tick(s,100,1),false);assert.equal(tick(s,100,2),false,'starting inside is not entry');
assert.equal(tick(s,120,3),false);assert.equal(tick(s,80,4),false,'jumping over the zone is not entry');assert.equal(tick(s,90,5),true,'inclusive boundary entry');
s=new C.Sequence([live('TRADED_ABOVE'),live('SWEEP_ABOVE_REJECT')]);
tick(s,99,1);assert.equal(tick(s,101,2),false);assert.equal(s.index,1);
assert.equal(tick(s,99,3),false,'prior step sweep memory cannot count');tick(s,101,4);assert.equal(tick(s,99,5),true);
assert.equal(tick(s,99,6),false,'finished sequence never retries');
s=new C.Sequence([live('TRADED_ABOVE'),live('TRADED_BELOW')],{timeout:5});tick(s,99,1);tick(s,101,2);tick(s,99,8);assert.equal(s.index,0,'timeout resets progress');
s=new C.Sequence([live('SWEEP_ABOVE_REJECT')],{gap:3});tick(s,99,1);tick(s,101,2);assert.equal(tick(s,99,9),false);assert.equal(tick(s,99,10),false,'gap clears sweep');
const bar=(time,close,high=close,low=close)=>({time,close,high,low});
s=new C.Sequence([live('CROSS_ABOVE',{mode:'CANDLE'})]);
const old=[bar(1,99),bar(2,101)];assert.equal(tick(s,101,3,old),false,'no old candle replay');assert.equal(tick(s,101,4,old),false);
assert.equal(tick(s,99,5,[bar(2,101),bar(3,99)]),false);assert.equal(tick(s,101,6,[bar(3,99),bar(4,101)]),true);
assert.equal(C.matches(live('SWEEP_ABOVE_REJECT',{mode:'CANDLE'}),bar(1,99),bar(2,99,101,98),{}),true);
assert.equal(C.matches(live('TRADED_ABOVE'),bar(1,99),bar(2,100),{}),false,'level comparison is strict');
assert.throws(()=>new C.Sequence([live('CLOSE_ABOVE')]),/completed candles/);
assert.throws(()=>new C.Sequence([live('ZONE_TOUCH',{low:110,high:90})]),/zone/);
assert.equal(new C.Sequence([]).done,true,'empty sequence supports explicitly started immediate action');
s=new C.Sequence([live('TRADED_ABOVE')]);tick(s,99,1);assert.equal(tick(s,101,1),false,'duplicate samples cannot advance');assert.equal(tick(s,101,2),true);
for(const rule of Object.keys(C.rules)){
 const r=live(rule,{mode:'CANDLE'}),p=bar(1,100,100,100);
 const b=rule==='ZONE_ENTER'?bar(2,100,105,95):rule.includes('BELOW')?bar(2,99,101,98):bar(2,101,102,99);
 assert.equal(typeof C.matches(r,p,b,{}),'boolean');
}
console.log('Condition sequence tests passed');
