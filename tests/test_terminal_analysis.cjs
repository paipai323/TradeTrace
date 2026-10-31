const assert=require('node:assert/strict');
const A=require('../static/terminal-analysis.js');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
assert.deepEqual(A.sma([1,2,3,4,5],3),[null,null,2,3,4]);
assert.deepEqual(A.ema([1,2,3,4,5],3),[null,null,2,3,4]);
assert.deepEqual(A.ema([1,2],3),[null,null]);
const flat=Array(60).fill(10),rising=Array.from({length:60},(_,i)=>i+1);
assert.equal(A.rsi(flat)[14],50);assert.equal(A.rsi(rising)[14],100);assert.equal(A.rsi([...rising].reverse())[14],0);
// Wilder's published example, including smoothing after the initial 14 changes.
const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46,46.03,46.41,46.22,45.64];
near(A.rsi(prices)[14],70.46413502109705);near(A.rsi(prices)[15],66.24961855355505);
const bb=A.bollinger([1,2,3,4,5],5,2);near(bb.middle[4],3);near(bb.upper[4],3+2*Math.sqrt(2));near(bb.lower[4],3-2*Math.sqrt(2));
const macd=A.macd(flat);assert.equal(macd.signal[32],null);near(macd.signal[33],0);near(macd.histogram[59],0);
const trend=A.macd(rising);near(trend.line[25],7);near(trend.signal[33],7);near(trend.histogram[59],0);
assert.equal(A.macd([1,2]).signal.length,2);
assert.deepEqual(A.points([{time:1},{time:2},{time:3}],[null,NaN,5]),[{time:3,value:5}]);
console.log('Indicator reference calculations passed');
const timeline=[{time:1000},{time:1300},{time:2200}];
for(const logical of [-10,-.5,0,.25,1,1.5,2,2.75,20]){
  const time=A.logicalToTime(timeline,logical,300);
  near(A.timeToLogical(timeline,time,300),logical);
}
near(A.logicalToTime(timeline,3,300),2500);
near(A.logicalToTime(timeline,-1,300),700);
near(A.logicalToTime(timeline,.5,300),1150);
assert.equal(A.logicalToTime([],1,300),null);
// Future drawings keep their timestamp as a new real candle arrives.
const future=A.logicalToTime(timeline,5.5,300);
near(A.timeToLogical([...timeline,{time:2500}],future,300),5.5);
console.log('Drawing timeline projection checks passed');
assert.equal(A.hitDrawing('level',{x:20,y:40},null,{x:500,y:45}),true);
assert.equal(A.hitDrawing('trend',{x:0,y:0},{x:100,y:100},{x:50,y:54}),true);
assert.equal(A.hitDrawing('trend',{x:0,y:0},{x:100,y:100},{x:50,y:80}),false);
assert.equal(A.hitDrawing('trend',{x:0,y:0},{x:0,y:0},{x:2,y:2}),true);
assert.equal(A.hitDrawing('rectangle',{x:100,y:100},{x:0,y:0},{x:50,y:50}),true);
assert.equal(A.hitDrawing('rectangle',{x:100,y:100},{x:0,y:0},{x:150,y:50}),false);
assert.equal(A.hitDrawing('fib',{x:0,y:0},{x:100,y:100},{x:50,y:61.8}),true);
assert.equal(A.hitDrawing('fib',{x:0,y:0},{x:100,y:100},{x:150,y:61.8}),false);
console.log('Drawing selection geometry checks passed');
const scope='account-A',level={type:'level',a:{time:1000,price:1.1}},drawingTrend={type:'drawingTrend',a:{time:1000,price:1},b:{time:1200,price:2}};
const legacy={
  [JSON.stringify([scope,'EURUSD','M5'])]:[level],
  [JSON.stringify([scope,'EURUSD','H1'])]:[level,drawingTrend],
  [JSON.stringify([scope,'XAUUSD','M5'])]:[drawingTrend],
  [JSON.stringify(['account-B','EURUSD','M5'])]:[level]
};
const merged=A.shareDrawingTimeframes(legacy,scope);
assert.deepEqual(merged[JSON.stringify([scope,'EURUSD'])],[level,drawingTrend]);
assert.deepEqual(merged[JSON.stringify([scope,'XAUUSD'])],[drawingTrend]);
assert.deepEqual(merged[JSON.stringify(['account-B','EURUSD','M5'])],[level]);
assert.equal(Object.hasOwn(merged,JSON.stringify([scope,'EURUSD','M5'])),false);
assert.deepEqual(A.shareDrawingTimeframes(merged,scope),merged,'migration is idempotent');
merged[JSON.stringify([scope,'EURUSD'])]=[];
assert.deepEqual(A.shareDrawingTimeframes(merged,scope)[JSON.stringify([scope,'EURUSD'])],[],'deleted drawings do not return');
assert.equal(legacy[JSON.stringify([scope,'EURUSD','M5'])].length,1,'migration preserves original input');
console.log('Shared drawing migration checks passed');
// LWC 5.0.9 rejects fractional indexes by returning zero: never pass one through.
const hourly=[{time:3600},{time:7200},{time:10800}];
const chartCoordinate=index=>Number.isInteger(index)?100+20*index:0;
near(A.timeToCoordinate(hourly,5400,3600,chartCoordinate),110);
near(A.timeToCoordinate(hourly,12600,3600,chartCoordinate),150);
near(A.timeToCoordinate(hourly,1800,3600,chartCoordinate),90);
near(A.timeToCoordinate(hourly,7200,3600,chartCoordinate),120);
assert.equal(A.timeToCoordinate([],5400,3600,chartCoordinate),null);
assert.equal(A.timeToCoordinate(hourly,5400,3600,()=>null),null);
console.log('Fractional timeframe anchor projection checks passed');
const longPlan={type:'long-position',a:{time:1000,price:100},b:{time:2000,price:125},c:{time:1000,price:90}};
const shortPlan={type:'short-position',a:{time:1000,price:100},b:{time:2000,price:75},c:{time:1000,price:110}};
for(const plan of [longPlan,shortPlan]){
  const m=A.positionMetrics(plan);near(m.risk,10);near(m.reward,25);near(m.ratio,2.5);near(m.riskPercent,10);near(m.rewardPercent,25);
}
assert.equal(A.positionMetrics(longPlan).side,'BUY');assert.equal(A.positionMetrics(shortPlan).side,'SELL');
assert.equal(A.positionMetrics({...longPlan,c:{price:110}}),null);
assert.equal(A.positionMetrics({...longPlan,a:{price:Infinity}}),null);
assert.equal(A.positionMetrics({...longPlan,c:{price:100}}),null);
console.log('Long / short risk-reward checks passed');
