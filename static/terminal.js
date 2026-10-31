(() => {
  const el = name => document.getElementById('terminal-' + name);
  let market=null, preview=null, running=false, loading=false, revision=0, count=100, offset=0, pointer=null, drag=null;
  const drawings=new Map(); let pending=null, scale=null;
  const canvas=el('chart');
  const status=message=>{el('status').textContent=message;};
  const key=()=>el('symbol').value+':'+el('timeframe').value;
  const invalidate=()=>{preview=null;el('submit').hidden=true;el('order-summary').textContent='';};
  async function call(route, body={}) {
    const response=await fetch('/api/terminal/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Replay-Token':document.querySelector('meta[name="replay-token"]').content},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw Error(value.error||'Request failed');return value;
  }
  async function refresh(){
    if(loading||!running||el('pane').hidden)return;
    loading=true;const version=revision, symbol=el('symbol').value, timeframe=el('timeframe').value;
    try{
      const next=await call('market',{symbol,timeframe});if(version!==revision)return;
      if(market&&(market.account!==next.account||market.server!==next.server))invalidate();
      market=next;
      const price=v=>Number(v).toFixed(market.digits);
      el('bid').textContent='BID '+price(market.bid);el('ask').textContent='ASK '+price(market.ask);
      const stale=Date.now()/1000-market.quote_time>30;
      el('quote-time').textContent=(stale?'STALE QUOTE · ':'')+new Date(market.quote_time*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
      el('account').textContent=`${market.demo?'DEMO':'LIVE · execution disabled'} · ${market.account} / ${market.server} · Balance ${market.balance} ${market.currency} · Equity ${market.equity} · Free margin ${market.margin_free}`;
      el('preview').disabled=!market.demo||stale;
      el('volume').min=market.volume_min;el('volume').max=market.volume_max;el('volume').step=market.volume_step;
      const rows=market.positions.map(p=>{const row=document.createElement('tr');for(const value of [p.ticket,p.symbol,p.type===0?'BUY':'SELL',p.volume,p.price_open,p.price_current,p.sl||'—',p.tp||'—',p.profit]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;});
      el('positions').replaceChildren(...rows);status(stale?'Market quote is stale. Chart shows the last available broker data.':`${symbol} · ${market.bars.length} candles · connected to MT5`);draw();
    }catch(error){if(version===revision){status(error.message);el('preview').disabled=true;invalidate();}}
    finally{loading=false;}
  }
  el('start').onclick=async()=>{el('start').disabled=true;invalidate();try{const data=await call('symbols');el('symbol').replaceChildren(...data.symbols.map(name=>new Option(name,name)));if(!data.symbols.length)throw Error('Add symbols to Market Watch in MT5 first.');running=true;revision++;await refresh();}catch(error){status(error.message);}finally{el('start').disabled=false;}};
  for(const name of ['symbol','timeframe'])el(name).onchange=()=>{revision++;market=null;offset=0;pending=null;invalidate();el('preview').disabled=true;draw();refresh();};
  el('ticket').oninput=invalidate;
  el('ticket').onsubmit=async event=>{event.preventDefault();invalidate();el('preview').disabled=true;const version=revision;try{const result=await call('preview',{symbol:el('symbol').value,side:el('side').value,volume:el('volume').value,sl:el('sl').value,tp:el('tp').value});if(version!==revision)return;preview=result.preview;const r=result.request;el('order-summary').textContent=`DEMO ${result.account} / ${result.server}: ${el('side').value} ${r.volume} lots ${r.symbol} at market (quote ${r.price}), SL ${r.sl||'none'}, TP ${r.tp||'none'}.`;el('submit').hidden=false;}catch(error){el('order-summary').textContent=error.message;}finally{el('preview').disabled=!market?.demo;}};
  el('submit').onclick=async()=>{if(!preview)return;const token=preview;preview=null;el('submit').hidden=true;el('preview').disabled=true;try{const result=await call('submit',{preview:token});el('order-summary').textContent=`Broker result ${result.retcode}: ${result.comment}. Order ${result.order}, deal ${result.deal}, filled volume ${result.volume} at ${result.price}. ${result.message}`;}catch(error){el('order-summary').textContent=error.message+' Check MT5 before retrying.';}finally{await refresh();}};
  function draw(){
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const dpr=devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height,left=12,right=w-85,top=24,bottom=h-35;
    ctx.fillStyle='#0e1725';ctx.fillRect(0,0,w,h);ctx.font='11px Segoe UI';ctx.fillStyle='#94a5bd';scale=null;
    if(!market?.bars.length){ctx.fillText('Load the workspace to view broker candles.',25,60);return;}
    const all=market.bars,end=Math.max(1,all.length-offset),start=Math.max(0,end-count),bars=all.slice(start,end);
    let lo=Math.min(...bars.map(b=>b[3])),hi=Math.max(...bars.map(b=>b[2]));const pad=(hi-lo)*.12||.001;lo-=pad;hi+=pad;
    const step=(right-left)/bars.length,x=i=>left+(i+.5)*step,y=p=>bottom-(p-lo)/(hi-lo)*(bottom-top);
    scale={price:py=>lo+(bottom-py)/(bottom-top)*(hi-lo),time:px=>bars[0][0]+((px-left)/step-.5)*(bars[1]?.[0]-bars[0][0]||60000),x:time=>x((time-bars[0][0])/(bars[1]?.[0]-bars[0][0]||60000)),y};
    for(let i=0;i<6;i++){const p=lo+(hi-lo)*i/5;ctx.strokeStyle='#243047';ctx.beginPath();ctx.moveTo(left,y(p));ctx.lineTo(right,y(p));ctx.stroke();ctx.fillStyle='#94a5bd';ctx.fillText(p.toFixed(market.digits),right+8,y(p)+4);}
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
    bars.forEach((b,i)=>{ctx.strokeStyle=ctx.fillStyle=b[4]>=b[1]?'#70e4c2':'#f18d9b';ctx.beginPath();ctx.moveTo(x(i),y(b[2]));ctx.lineTo(x(i),y(b[3]));ctx.stroke();ctx.fillRect(x(i)-step*.32,y(Math.max(b[1],b[4])),Math.max(1,step*.64),Math.max(1,Math.abs(y(b[1])-y(b[4]))));});
    if(el('ma').checked){ctx.strokeStyle='#e5be72';ctx.beginPath();let begun=false;bars.forEach((b,i)=>{const index=start+i;if(index<19)return;const average=all.slice(index-19,index+1).reduce((s,v)=>s+v[4],0)/20;if(!begun){ctx.moveTo(x(i),y(average));begun=true;}else ctx.lineTo(x(i),y(average));});ctx.stroke();}
    const line=(price,color,label)=>{if(!price)return;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(left,y(price));ctx.lineTo(right,y(price));ctx.stroke();ctx.setLineDash([]);ctx.fillText(label,left+4,y(price)-5);};
    line(market.bid,'#81a5fb','BID');
    market.positions.filter(p=>p.symbol===el('symbol').value).forEach(p=>{line(p.price_open,'#b5a6e0',`#${p.ticket} ENTRY`);line(p.sl,'#f18d9b','SL');line(p.tp,'#70e4c2','TP');});
    for(const item of drawings.get(key())||[]){if(item.type==='level')line(item.a.price,'#e5be72',item.a.price.toFixed(market.digits));else{ctx.strokeStyle='#e5be72';ctx.beginPath();ctx.moveTo(scale.x(item.a.time),y(item.a.price));ctx.lineTo(scale.x(item.b.time),y(item.b.price));ctx.stroke();}}
    if(pending){ctx.fillStyle='#e5be72';ctx.beginPath();ctx.arc(scale.x(pending.time),y(pending.price),4,0,Math.PI*2);ctx.fill();}
    if(pointer){ctx.strokeStyle='#72839e';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(pointer.x,top);ctx.lineTo(pointer.x,bottom);ctx.moveTo(left,pointer.y);ctx.lineTo(right,pointer.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#d8e6fa';ctx.fillText(scale.price(pointer.y).toFixed(market.digits),left+5,top+12);}
    ctx.restore();ctx.fillStyle='#94a5bd';for(let i=0;i<bars.length;i+=Math.max(1,Math.ceil(bars.length/5))){ctx.fillText(new Date(bars[i][0]).toISOString().slice(5,16).replace('T',' '),x(i),h-12);}
  }
  canvas.addEventListener('wheel',event=>{event.preventDefault();count=Math.max(20,Math.min(500,Math.round(count*(event.deltaY>0?1.2:.8))));draw();},{passive:false});
  canvas.onpointermove=event=>{const rect=canvas.getBoundingClientRect();pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};if(drag&&market){offset=Math.max(0,Math.min(market.bars.length-20,drag.offset+Math.round((event.clientX-drag.x)/rect.width*count)));}draw();};
  canvas.onpointerleave=()=>{pointer=null;draw();};
  canvas.onpointerdown=event=>{if(!scale)return;const rect=canvas.getBoundingClientRect(),tool=el('tool').value;if(tool==='crosshair'){drag={x:event.clientX,offset};canvas.setPointerCapture(event.pointerId);return;}const point={time:scale.time(event.clientX-rect.left),price:scale.price(event.clientY-rect.top)};const list=drawings.get(key())||[];if(tool==='level')list.push({type:tool,a:point});else if(!pending)pending=point;else{list.push({type:tool,a:pending,b:point});pending=null;}drawings.set(key(),list);draw();};
  canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
  el('clear').onclick=()=>{drawings.delete(key());pending=null;draw();};el('fit').onclick=()=>{count=100;offset=0;draw();};el('ma').onchange=draw;el('tool').onchange=()=>{pending=null;draw();};
  new ResizeObserver(draw).observe(canvas);
  setInterval(refresh,2000);
})();
