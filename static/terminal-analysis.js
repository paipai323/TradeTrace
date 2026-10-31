/* Pure indicator calculations shared by the workspace and numerical tests. */
(function(root) {
  'use strict';
  const values = bars => bars.map(b => b.close);
  function sma(input, period) {
    const result=Array(input.length).fill(null);let sum=0;
    for(let i=0;i<input.length;i++){sum+=input[i];if(i>=period)sum-=input[i-period];if(i>=period-1)result[i]=sum/period;}
    return result;
  }
  function ema(input, period) {
    const result=Array(input.length).fill(null);if(input.length<period)return result;
    result[period-1]=input.slice(0,period).reduce((s,v)=>s+v,0)/period;
    for(let i=period;i<input.length;i++)result[i]=input[i]*2/(period+1)+result[i-1]*(1-2/(period+1));
    return result;
  }
  function rsi(input, period=14) {
    const result=Array(input.length).fill(null);if(input.length<=period)return result;
    let gain=0,loss=0;
    for(let i=1;i<=period;i++){const d=input[i]-input[i-1];gain+=Math.max(0,d)/period;loss+=Math.max(0,-d)/period;}
    const value=()=>loss===0?(gain===0?50:100):100-100/(1+gain/loss);
    result[period]=value();
    for(let i=period+1;i<input.length;i++){const d=input[i]-input[i-1];gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;result[i]=value();}
    return result;
  }
  function bollinger(input, period=20, multiplier=2) {
    const middle=sma(input,period),upper=Array(input.length).fill(null),lower=[...upper];
    for(let i=period-1;i<input.length;i++){const deviation=Math.sqrt(input.slice(i-period+1,i+1).reduce((s,v)=>s+(v-middle[i])**2,0)/period);upper[i]=middle[i]+deviation*multiplier;lower[i]=middle[i]-deviation*multiplier;}
    return {middle,upper,lower};
  }
  function macd(input) {
    const fast=ema(input,12),slow=ema(input,26),line=input.map((_,i)=>slow[i]===null?null:fast[i]-slow[i]);
    const signal=[...Array(25).fill(null),...ema(line.slice(25),9)].slice(0,input.length);
    return {line,signal,histogram:line.map((v,i)=>signal[i]===null?null:v-signal[i])};
  }
  const points=(bars,series)=>bars.flatMap((bar,i)=>series[i]===null||!Number.isFinite(series[i])?[]:[{time:bar.time,value:series[i]}]);
  // Real candles define the timeline; empty space uses interval-sized projections.
  function logicalToTime(bars, logical, interval) {
    if(!bars.length||!Number.isFinite(logical))return null;
    const last=bars.length-1;
    if(logical<0)return bars[0].time+logical*interval;
    if(logical>=last)return bars[last].time+(logical-last)*interval;
    const i=Math.floor(logical);
    return bars[i].time+(bars[i+1].time-bars[i].time)*(logical-i);
  }
  function timeToLogical(bars, time, interval) {
    if(!bars.length||!Number.isFinite(time))return null;
    const last=bars.length-1;
    if(time<bars[0].time)return (time-bars[0].time)/interval;
    if(time>=bars[last].time)return last+(time-bars[last].time)/interval;
    let lo=0,hi=last;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(bars[mid].time<=time)lo=mid;else hi=mid;}
    return lo+(time-bars[lo].time)/(bars[hi].time-bars[lo].time);
  }
  function timeToCoordinate(bars,time,interval,coordinateForIndex){
    const logical=timeToLogical(bars,time,interval);
    if(logical===null)return null;
    // LWC 5.0.9 silently returns zero for non-integer logical coordinates.
    const left=Math.floor(logical),right=Math.ceil(logical),x1=coordinateForIndex(left);
    if(!Number.isFinite(x1))return null;
    if(left===right)return x1;
    const x2=coordinateForIndex(right);
    return Number.isFinite(x2)?x1+(x2-x1)*(logical-left):null;
  }
  function segmentDistance(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }
  function hitDrawing(type,a,b,p,tolerance=7){
    if(!a||a.y===null)return false;
    if(type==='level')return Math.abs(p.y-a.y)<=tolerance;
    if(!b||[a.x,a.y,b.x,b.y].some(v=>v===null||!Number.isFinite(v)))return false;
    if(type==='trend')return segmentDistance(p,a,b)<=tolerance;
    const insideX=p.x>=Math.min(a.x,b.x)-tolerance&&p.x<=Math.max(a.x,b.x)+tolerance;
    if(type==='rectangle')return insideX&&p.y>=Math.min(a.y,b.y)-tolerance&&p.y<=Math.max(a.y,b.y)+tolerance;
    if(type==='fib')return insideX&&[0,.236,.382,.5,.618,.786,1].some(r=>Math.abs(p.y-(a.y+(b.y-a.y)*r))<=tolerance);
    return false;
  }
  function shareDrawingTimeframes(drawings,scope){
    const result={},seen=new Map();
    for(const [key,items] of Object.entries(drawings||{})){
      let parts;try{parts=JSON.parse(key);}catch(_){result[key]=items;continue;}
      if(!Array.isArray(parts)||![2,3].includes(parts.length)||parts[0]!==scope||!Array.isArray(items)){result[key]=items;continue;}
      const shared=JSON.stringify(parts.slice(0,2));
      if(!Array.isArray(result[shared])){result[shared]=[];seen.set(shared,new Set());}
      for(const item of items){const fingerprint=JSON.stringify(item);if(!seen.get(shared).has(fingerprint)){seen.get(shared).add(fingerprint);result[shared].push(item);}}
    }
    return result;
  }
  const api={values,sma,ema,rsi,bollinger,macd,points,logicalToTime,timeToLogical,timeToCoordinate,hitDrawing,shareDrawingTimeframes};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TerminalAnalysis=api;
})(typeof globalThis!=='undefined'?globalThis:this);
