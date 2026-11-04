/* Ordered, observed-price conditions. No broker actions in this module. */
(function(root){
  'use strict';
  const rules={BOS_UP:'Bullish BOS',BOS_DOWN:'Bearish BOS',MS_UP:'Bullish MS',MS_DOWN:'Bearish MS',ZONE_ENTER:'Enters zone',ZONE_TOUCH:'Is in / touches zone',TRADED_ABOVE:'Trades above level',TRADED_BELOW:'Trades below level',SWEEP_ABOVE_REJECT:'Sweeps above, returns below',SWEEP_BELOW_RECLAIM:'Sweeps below, returns above',CLOSE_ABOVE:'Candle closes above',CLOSE_BELOW:'Candle closes below',CROSS_ABOVE:'First candle close above',CROSS_BELOW:'First candle close below',CLOSE_IN_ZONE:'Candle closes inside zone'};
  const frames=['M1','M5','M15','M30','H1','H4','D1'];
  const zone=r=>['ZONE_ENTER','ZONE_TOUCH','CLOSE_IN_ZONE'].includes(r);
  const structure=r=>['BOS_UP','BOS_DOWN','MS_UP','MS_DOWN'].includes(r);
  class Structure{
    constructor(sensitivity=2){this.n=sensitivity;this.bars=[];this.highs=[];this.lows=[];this.lastPivot=null;this.protectedHigh=null;this.protectedLow=null;this.bias=0;this.lastTime=null;this.count=0;}
    push(bar){
      if(!Number.isFinite(bar?.time)||this.lastTime!==null&&bar.time<=this.lastTime)return [];
      if(!['open','high','low','close'].every(key=>Number.isFinite(bar[key])&&bar[key]>0)||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.low>bar.high)return [];
      const previous=this.bars.at(-1);this.lastTime=bar.time;this.count++;this.bars.push({...bar});
      if(this.bars.length>2*this.n+1)this.bars.shift();
      if(this.bars.length===2*this.n+1){
        const candidate=this.bars[this.n],others=this.bars.filter((_,i)=>i!==this.n);
        const high=others.every(b=>candidate.high>b.high),low=others.every(b=>candidate.low<b.low);
        // An outside bar that is both pivots has no unambiguous intrabar ordering.
        if(high!==low){
          const kind=high?'high':'low',price=high?candidate.high:candidate.low,list=high?this.highs:this.lows;
          const pivot={kind,price,time:candidate.time,confirmed:bar.time,broken:false};
          if(this.lastPivot?.kind!==kind){list.push(pivot);if(list.length>2)list.shift();this.lastPivot=pivot;}
          else if(high?price>this.lastPivot.price:price<this.lastPivot.price){list[list.length-1]=pivot;this.lastPivot=pivot;}
        }
      }
      if(!this.bias&&this.highs.length===2&&this.lows.length===2){
        const h=this.highs[1].price-this.highs[0].price,l=this.lows[1].price-this.lows[0].price;
        if(h>0&&l>0)this.bias=1;else if(h<0&&l<0)this.bias=-1;
        if(this.bias){this.protectedHigh=this.highs.at(-1);this.protectedLow=this.lows.at(-1);}
      }
      if(this.bias===1&&this.lows.at(-1)?.price>(this.protectedLow?.price??0))this.protectedLow=this.lows.at(-1);
      if(this.bias===-1&&this.highs.at(-1)?.price<(this.protectedHigh?.price??Infinity))this.protectedHigh=this.highs.at(-1);
      const events=[];
      for(const [pivot,direction] of [[this.bias===-1?this.protectedHigh:this.highs.at(-1),1],[this.bias===1?this.protectedLow:this.lows.at(-1),-1]]){
        if(!pivot||pivot.broken||!previous)continue;
        const crossed=direction===1?previous.close<=pivot.price&&bar.close>pivot.price:previous.close>=pivot.price&&bar.close<pivot.price;
        if(!crossed)continue;pivot.broken=true;
        if(!this.bias)continue;
        const before=this.bias,type=before===direction?'BOS':'MS';this.bias=direction;
        if(type==='MS'){if(direction===1)this.protectedLow=this.lows.at(-1);else this.protectedHigh=this.highs.at(-1);}
        events.push({type,direction,level:pivot.price,swing_time:pivot.time,confirmed_time:pivot.confirmed,bias_before:before,bias_after:this.bias,candle:{...bar}});
      }
      return events;
    }
    snapshot(rule){
      const direction=rule.endsWith('_UP')?1:-1,isMS=rule.startsWith('MS'),pivot=isMS?(direction===1?this.protectedHigh:this.protectedLow):(direction===1?this.highs.at(-1):this.lows.at(-1));
      const context=this.bias===1?'Bullish':'Bearish',expected=isMS?-direction:direction;
      return {bias:this.bias,level:pivot?.price||null,swing_time:pivot?.time||null,confirmed_time:pivot?.confirmed||null,broken:!!pivot?.broken,
        status:this.count<2*this.n+1?`Not enough completed candles (${this.count}/${2*this.n+1} to confirm a swing)`:!this.bias?'Waiting for clear structure':this.bias!==expected?`${context} structure; waiting for ${expected===1?'bullish':'bearish'} context`:!pivot||pivot.broken?'Waiting for a new confirmed swing':`${context} structure · watching ${pivot.price}`};
    }
  }

  const candleOnly=r=>structure(r)||r.startsWith('CLOSE_')||r.startsWith('CROSS_');
  function fieldErrors(row){
    const errors={},positive=value=>Number.isFinite(value)&&value>0;
    if(!Object.hasOwn(rules,row.rule))errors.rule='Choose a valid rule.';
    if(!['LIVE','CANDLE'].includes(row.mode))errors.mode='Choose Live Bid or completed candles.';
    if(!frames.includes(row.timeframe))errors.timeframe='Choose a supported timeframe.';
    if(row.mode==='LIVE'&&typeof row.rule==='string'&&candleOnly(row.rule))errors.mode='This rule requires completed candles.';
    if(structure(row.rule)){
      if(!Number.isInteger(row.sensitivity)||row.sensitivity<1||row.sensitivity>10)errors.sensitivity='Choose 1–10 candles on each side of a swing.';
    }else if(zone(row.rule)){
      if(!positive(row.low))errors.low='Enter a positive zone low.';
      if(!positive(row.high))errors.high='Enter a positive zone high.';
      if(positive(row.low)&&positive(row.high)&&row.low>=row.high){errors.low='Zone low must be below zone high.';errors.high='Zone high must be above zone low.';}
    }else if(!positive(row.level))errors.level='Enter a positive price level.';
    return errors;
  }
  function validate(rows){
    for(const [i,r] of rows.entries()){
      const errors=fieldErrors(r);if(Object.keys(errors).length)throw Error(`Condition ${i+1}: ${Object.values(errors)[0]}`);
    }
    return rows;
  }
  function matches(r,p,b,memory){
    if(r.mode==='LIVE'&&r.rule==='SWEEP_ABOVE_REJECT'){if(b.close>r.level)memory.above=true;return !!memory.above&&b.close<r.level;}
    if(r.mode==='LIVE'&&r.rule==='SWEEP_BELOW_RECLAIM'){if(b.close<r.level)memory.below=true;return !!memory.below&&b.close>r.level;}
    const overlaps=x=>x.low<=r.high&&x.high>=r.low;
    switch(r.rule){
      case 'ZONE_ENTER':return overlaps(b)&&!overlaps(p);
      case 'ZONE_TOUCH':return overlaps(b);
      case 'TRADED_ABOVE':return b.high>r.level;
      case 'TRADED_BELOW':return b.low<r.level;
      case 'SWEEP_ABOVE_REJECT':return b.high>r.level&&b.close<r.level;
      case 'SWEEP_BELOW_RECLAIM':return b.low<r.level&&b.close>r.level;
      case 'CLOSE_ABOVE':return b.close>r.level;
      case 'CLOSE_BELOW':return b.close<r.level;
      case 'CROSS_ABOVE':return p.close<=r.level&&b.close>r.level;
      case 'CROSS_BELOW':return p.close>=r.level&&b.close<r.level;
      case 'CLOSE_IN_ZONE':return b.close>=r.low&&b.close<=r.high;
      default:return false;
    }
  }
  class Sequence{
    constructor(rows,{timeout=0,gap=300}={}){this.rows=structuredClone(validate(rows));this.timeout=timeout;this.gap=gap;this.reset();this.done=!rows.length;}
    reset(){if(this.done)return;this.index=0;this.memory={};this.tracker=null;this.structureState=null;this.previous=null;this.lastTime=null;this.started=null;this.candle=null;this.done=false;}
    observe({bid,time,candles=[]}){
      this.events=[];
      if(this.done||!Number.isFinite(bid)||bid<=0||!Number.isFinite(time))return false;
      if(this.lastTime!==null&&time<=this.lastTime)return false;
      if(this.lastTime!==null&&this.gap>0&&time-this.lastTime>this.gap){const seconds=time-this.lastTime;this.reset();this.events.push({type:'reset',reason:'quote-gap',seconds});}
      if(this.started!==null&&this.timeout>0&&time-this.started>this.timeout){const seconds=time-this.started;this.reset();this.events.push({type:'reset',reason:'timeout',seconds});}
      this.lastTime=time;
      const r=this.rows[this.index];if(!r)return false;
      const latest=candles.at(-1);
      if(structure(r.rule)){
        if(!this.tracker){
          this.tracker=new Structure(r.sensitivity);for(const bar of candles)this.tracker.push(bar);
          this.structureState=this.tracker.snapshot(r.rule);this.candle=latest?.time??null;this.previous=bid;return false;
        }
        const newer=candles.filter(bar=>this.tracker.lastTime===null||bar.time>this.tracker.lastTime);
        let signals=[];for(const bar of newer)signals=this.tracker.push(bar);
        this.structureState=this.tracker.snapshot(r.rule);
        if(newer.length>1){this.structureState.status=`Skipped ${newer.length} closed candles; waiting for the next close`;return false;}
        if(newer.length!==1)return false;
        const match=signals.find(event=>`${event.type}_${event.direction===1?'UP':'DOWN'}`===r.rule);
        if(!match)return false;
        if(this.index===0)this.started=time;
        this.events.push({type:'passed',index:this.index,structure:match});
        this.index++;this.memory={};this.tracker=null;this.structureState=null;this.candle=null;this.done=this.index===this.rows.length;return this.done;
      }
      if(this.previous===null){this.previous=bid;this.candle=latest?.time??null;return false;}
      let p={low:this.previous,high:this.previous,close:this.previous},b={low:bid,high:bid,close:bid};this.previous=bid;
      if(r.mode==='CANDLE'){
        if(candles.length<2)return false;
        if(this.candle===null){this.candle=latest.time;return false;}
        if(latest.time<=this.candle)return false;
        this.candle=latest.time;[p,b]=candles.slice(-2);
      }
      if(!matches(r,p,b,this.memory))return false;
      if(this.index===0)this.started=time;
      this.events.push({type:'passed',index:this.index});
      this.index++;this.memory={};this.candle=null;
      this.done=this.index===this.rows.length;
      return this.done;
    }
  }
  function waitingDescription(row,state,options={}){
    if(!row)return 'All steps have passed; preparing the selected action.';
    const digits=Number.isInteger(options.digits)?options.digits:5,price=value=>Number(value).toFixed(digits),rule=row.rule,frame=row.timeframe;
    let message='';
    if(structure(rule)){
      const upward=rule.endsWith('_UP'),required=rule.startsWith('MS')?(upward?-1:1):(upward?1:-1);
      if(!state||state.bias!==required||!state.level||state.broken)return 'Waiting: '+(state?.status||'initializing confirmed structure from broker candles')+'.';
      message=`Waiting for ${frame} candle close ${upward?'above':'below'} ${price(state.level)} (${rules[rule]}). Wicks do not count.`;
    }else{
      const subject=row.mode==='CANDLE'?`${frame} candle`:'Bid',level=price(row.level),bounds=`${price(row.low)}–${price(row.high)}`;
      const actions={TRADED_ABOVE:`${subject} to trade above ${level}`,TRADED_BELOW:`${subject} to trade below ${level}`,ZONE_ENTER:`${subject} to enter ${bounds} from outside`,ZONE_TOUCH:`${subject} to touch ${bounds}`,SWEEP_ABOVE_REJECT:`${subject} to sweep above ${level} and return below`,SWEEP_BELOW_RECLAIM:`${subject} to sweep below ${level} and return above`,CLOSE_ABOVE:`${frame} candle close above ${level}`,CLOSE_BELOW:`${frame} candle close below ${level}`,CROSS_ABOVE:`${frame} candle close crossing above ${level}`,CROSS_BELOW:`${frame} candle close crossing below ${level}`,CLOSE_IN_ZONE:`${frame} candle close inside ${bounds}`};
      message='Waiting for '+(actions[rule]||rules[rule]||'the active condition')+'.';
    }
    if(row.mode==='CANDLE'&&Number.isFinite(options.now)){
      const seconds={M1:60,M5:300,M15:900,M30:1800,H1:3600,H4:14400,D1:86400}[frame],end=options.formingTime+seconds,left=Math.ceil(end-options.now);
      if(seconds&&Number.isFinite(options.formingTime)&&options.now>=options.formingTime&&left>0&&Number.isFinite(options.quoteTime)&&options.now-options.quoteTime<=30&&options.quoteTime<=options.now+5){
        const minutes=Math.floor(left/60),remaining=String(left%60).padStart(2,'0');message+=` Next scheduled close in ${minutes}:${remaining} (estimate).`;
      }
    }
    return message;
  }
  const api={waitingDescription,rules,frames,zone,structure,Structure,candleOnly,fieldErrors,validate,matches,Sequence};
  if(typeof module==='object')module.exports=api;else root.TerminalConditions=api;
})(typeof window==='object'?window:globalThis);
