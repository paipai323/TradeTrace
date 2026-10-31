/* Trading workspace. All charts, drawings, settings and quotes stay local. */
(() => {
  'use strict';
  const el=name=>document.getElementById('terminal-'+name), A=window.TerminalAnalysis, L=window.LightweightCharts;
  if(!L||!A){el('status').textContent='Chart library did not load. Restart the app and refresh.';return;}
  const storageKey='tradetrace.terminal.v2';
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}');if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};}catch(_){saved={};}
  const indicators=['sma','ema','bb','rsi','macd','volume-indicator'];
  let chart, main, overlays={}, primitive, priceLines=[], market=null, bars=[], symbols=[], quotes={}, scope='offline';
  let loading=false, connecting=false, running=false, revision=0, ticketRevision=0, preview=null, submitting=false, reviewing=false, tool='cursor', pending=null, lastChartKey='', expiryTimer;
  let state={watch:[],drawings:{},alerts:[],views:{}};
  let selectedDrawing=-1,drawingDrag=null,selectedPriceLines=[];
  const workspaceKey=()=>JSON.stringify([scope,el('symbol').value,el('timeframe').value]);
  const status=message=>{el('status').textContent=message;};
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
  const safeList=value=>Array.isArray(value)?value:[];
  function persist(){
    saved.settings=layout();saved.workspaces={...(saved.workspaces||{}),[scope]:state};
    try{localStorage.setItem(storageKey,JSON.stringify(saved));el('save-state').textContent='Saved locally';}
    catch(_){el('save-state').textContent='Storage full or unavailable — changes are temporary';}
  }
  function layout(){return {symbol:el('symbol').value,timeframe:el('timeframe').value,style:el('style').value,indicators:Object.fromEntries(indicators.map(name=>[name,el(name).checked]))};}
  function applyLayout(value){
    if(!value||typeof value!=='object')return;
    if(symbols.includes(value.symbol))el('symbol').value=value.symbol;
    if(['M1','M5','M15','M30','H1','H4','D1'].includes(value.timeframe))el('timeframe').value=value.timeframe;
    if(['candles','line'].includes(value.style))el('style').value=value.style;
    for(const name of indicators)if(typeof value.indicators?.[name]==='boolean')el(name).checked=value.indicators[name];
  }
  applyLayout(saved.settings);
  function invalidate(clear=true){ticketRevision++;preview=null;clearTimeout(expiryTimer);el('submit').hidden=true;if(clear)el('order-summary').replaceChildren();updateTicket();}
  function updateTicket(){
    const fresh=market&&Date.now()/1000-market.quote_time<=30&&market.quote_time<=Date.now()/1000+5;
    el('preview').disabled=!market?.demo||!fresh||submitting||reviewing;
    el('alert-add').disabled=!market;
  }
  async function call(route,body={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Replay-Token':document.querySelector('meta[name="replay-token"]').content},body:JSON.stringify(body),signal:controller.signal});
      const value=await response.json();if(!response.ok)throw Error(value.error||'Request failed');return value;
    }catch(error){if(error.name==='AbortError')throw Error('Request timed out. For order submission, check MT5 positions/history before retrying.');throw error;}finally{clearTimeout(timeout);}
  }
  function currentDrawings(){return safeList(state.drawings[workspaceKey()]);}
  const drawingPoint=p=>({x:chart.timeScale().logicalToCoordinate(drawingLogical(p.time)),y:main.priceToCoordinate(p.price)});
  function updateSelectionPrices(){
    const item=currentDrawings()[selectedDrawing];
    const levels=!item?[]:item.type==='fib'?[0,.236,.382,.5,.618,.786,1].map(r=>({title:`Fib ${r}`,price:item.a.price+(item.b.price-item.a.price)*r})):item.type==='level'?[{title:'Level',price:item.a.price}]:[{title:item.type==='rectangle'?'Corner A':'Anchor A',price:item.a.price},{title:item.type==='rectangle'?'Corner B':'Anchor B',price:item.b.price}];
    if(main){while(selectedPriceLines.length>levels.length)main.removePriceLine(selectedPriceLines.pop());levels.forEach((level,i)=>{const options={...level,title:'',color:'#70e4c2',axisLabelColor:'#70e4c2',axisLabelTextColor:'#10241f',axisLabelVisible:true,lineVisible:false,lineWidth:1};if(selectedPriceLines[i])selectedPriceLines[i].applyOptions(options);else selectedPriceLines.push(main.createPriceLine(options));});}
    el('selection-values').hidden=!levels.length;
    el('selection-values').replaceChildren(...levels.map(level=>{const label=text('span',`${level.title}: ${Number(level.price).toFixed(market?.digits??5)}`);label.dataset.price=level.price;return label;}));
  }
  function selectDrawing(index){selectedDrawing=index;el('delete-drawing').disabled=index<0;updateSelectionPrices();primitive?.update();el('tool-hint').textContent=index>=0?'Drawing selected · drag to move · drag handles to resize · Delete removes · Escape deselects':'Click a drawing to select · drag empty space to pan';}
  function removeSelectedDrawing(){if(selectedDrawing<0)return;state.drawings[workspaceKey()]=currentDrawings().filter((_,i)=>i!==selectedDrawing);selectDrawing(-1);persist();}
  function drawingHit(p){
    const list=currentDrawings(),selected=list[selectedDrawing];
    if(selected)for(const anchor of ['a','b']){if(!selected[anchor])continue;const point=drawingPoint(selected[anchor]);if(point.x!==null&&point.y!==null&&Math.hypot(p.x-point.x,p.y-point.y)<=9)return {index:selectedDrawing,anchor};}
    for(let i=list.length-1;i>=0;i--){const item=list[i];if(item?.a&&A.hitDrawing(item.type,drawingPoint(item.a),item.b?drawingPoint(item.b):null,p))return {index:i,anchor:null};}
    return null;
  }
  function pointerPoint(event){const rect=el('chart').getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
  function finishDrawingDrag(cancel=false){
    if(!drawingDrag)return;const drag=drawingDrag;drawingDrag=null;
    if(cancel)drag.list[drag.index]=drag.original;else persist();
    if(el('chart').hasPointerCapture(drag.pointerId))el('chart').releasePointerCapture(drag.pointerId);
    updateSelectionPrices();primitive?.update();
  }
  const intervalSeconds=()=>({M1:60,M5:300,M15:900,M30:1800,H1:3600,H4:14400,D1:86400}[el('timeframe').value]);
  const drawingTime=logical=>A.logicalToTime(bars,logical,intervalSeconds());
  const drawingLogical=time=>A.timeToLogical(bars,time,intervalSeconds());
  function visibleDrawingRange(){const range=chart?.timeScale().getVisibleLogicalRange();return range&&bars.length?{from:drawingTime(range.from),to:drawingTime(range.to)}:null;}
  function restoreDrawingRange(range){if(range&&Number.isFinite(range.from)&&Number.isFinite(range.to)&&range.from<range.to)chart.timeScale().setVisibleLogicalRange({from:drawingLogical(range.from),to:drawingLogical(range.to)});}
  class DrawingPrimitive {
    attached({requestUpdate}){this.requestUpdate=requestUpdate;}
    detached(){this.requestUpdate=null;}
    updateAllViews(){}
    paneViews(){return [{zOrder:()=> 'top',renderer:()=>({draw:target=>target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>renderDrawings(ctx,mediaSize))})}];}
    update(){this.requestUpdate?.();}
  }
  function renderDrawings(ctx,size){
    if(!chart||!main)return;
    const point=drawingPoint;
    ctx.save();ctx.font='11px Segoe UI';ctx.lineWidth=1.3;
    for(const [drawingIndex,item] of currentDrawings().entries()){
      if(!item?.a)continue;const a=point(item.a),b=item.b?point(item.b):null;
      const selected=drawingIndex===selectedDrawing;
      if(a.y===null)continue;ctx.lineWidth=selected?2.5:1.3;ctx.strokeStyle=selected?'#70e4c2':'#e4bd70';ctx.fillStyle=ctx.strokeStyle;ctx.setLineDash([]);
      const horizontal=(y,label)=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(size.width,y);ctx.stroke();ctx.fillText(label,8,y-5);};
      if(item.type==='level'){ctx.setLineDash([5,4]);horizontal(a.y,item.a.price.toFixed(market?.digits??5));}
      else if(b&&a.x!==null&&b.x!==null&&b.y!==null){
        if(item.type==='trend'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
        if(item.type==='rectangle'){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);ctx.fillStyle='rgba(228,189,112,.10)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
        if(item.type==='fib')for(const ratio of [0,.236,.382,.5,.618,.786,1]){const y=a.y+(b.y-a.y)*ratio;ctx.strokeStyle=ratio===.5||ratio===.618?'#70e4c2':'#8a9cb6';ctx.beginPath();ctx.moveTo(Math.min(a.x,b.x),y);ctx.lineTo(Math.max(a.x,b.x),y);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillText(`${ratio} · ${(item.a.price+(item.b.price-item.a.price)*ratio).toFixed(market?.digits??5)}`,Math.min(a.x,b.x)+5,y-4);}
      }
      if(selected){ctx.setLineDash([]);for(const p of [a,b].filter(Boolean)){if(p.x===null||p.y===null)continue;ctx.fillStyle='#0d1420';ctx.strokeStyle='#70e4c2';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();}}
    }
    if(pending){const p=point(pending);if(p.x!==null&&p.y!==null){ctx.fillStyle='#70e4c2';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();}}
    ctx.restore();
  }
  function buildChart(){
    const range=visibleDrawingRange();chart?.remove();priceLines=[];selectedPriceLines=[];overlays={};
    chart=L.createChart(el('chart'),{autoSize:true,layout:{background:{type:L.ColorType.Solid,color:'#0d1420'},textColor:'#8e9eb4',fontFamily:'Segoe UI, Arial',fontSize:11,attributionLogo:true,panes:{separatorColor:'#263143',separatorHoverColor:'#415671',enableResize:true}},grid:{vertLines:{color:'#192335'},horzLines:{color:'#192335'}},rightPriceScale:{borderColor:'#29364b',minimumWidth:74},timeScale:{borderColor:'#29364b',timeVisible:true,secondsVisible:false,rightOffset:24,barSpacing:7},crosshair:{mode:L.CrosshairMode.Normal},localization:{locale:'en-US'}});
    const priceFormat={type:'price',precision:market?.digits??5,minMove:market?.tick_size||10**-(market?.digits??5)};
    main=chart.addSeries(el('style').value==='line'?L.LineSeries:L.CandlestickSeries,el('style').value==='line'?{color:'#78a7ff',lineWidth:2,priceFormat}:{upColor:'#43c9a0',downColor:'#ef7385',wickUpColor:'#43c9a0',wickDownColor:'#ef7385',borderVisible:false,priceFormat});
    const line=(name,color,pane=0,title=name)=>{overlays[name]=chart.addSeries(L.LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,title,priceFormat:pane===0?priceFormat:{type:'price',precision:name==='rsi'?2:6,minMove:name==='rsi'?.01:.000001}},pane);};
    if(el('sma').checked)line('sma','#e4bd70',0,'SMA 20');if(el('ema').checked)line('ema','#a994ef',0,'EMA 50');
    if(el('bb').checked){line('bbMiddle','#657ba4',0,'BB 20');line('bbUpper','#577da6',0,'BB upper');line('bbLower','#577da6',0,'BB lower');}
    let pane=0;
    if(el('rsi').checked){line('rsi','#ae97f3',++pane,'RSI 14');overlays.rsi.applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});for(const value of [30,70])overlays.rsi.createPriceLine({price:value,color:'#59647b',lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:true,title:String(value)});}
    if(el('macd').checked){line('macd','#78a7ff',++pane,'MACD');line('signal','#e4bd70',pane,'Signal');overlays.histogram=chart.addSeries(L.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,title:'MACD histogram'},pane);}
    if(el('volume-indicator').checked)overlays.volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false,title:'Tick volume'},++pane);
    el('chart').closest('.terminal-chart-area').style.height=(420+pane*120)+'px';
    chart.panes().forEach((p,i)=>p.setStretchFactor(i===0?4:1));
    primitive=new DrawingPrimitive();main.attachPrimitive(primitive);
    // Handle drawing anchors directly; chart click gestures can suppress quick clicks.
    el('chart').onpointerup=event=>{
      if(tool==='cursor'||!market||event.button!==0)return;
      const rect=el('chart').getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,size=chart.paneSize(0);
      if(x<0||y<0||x>size.width||y>size.height)return;
      const logical=chart.timeScale().coordinateToLogical(x),time=logical===null?null:drawingTime(logical);
      const price=main.coordinateToPrice(y);if(typeof time!=='number'||price===null)return;
      const p={time,price},list=currentDrawings();
      if(tool==='level')list.push({type:tool,a:p});else if(!pending){pending=p;primitive.update();el('tool-hint').textContent='Choose the second anchor · Escape cancels';return;}else{list.push({type:tool,a:pending,b:p});pending=null;}
      state.drawings[workspaceKey()]=list;persist();setTool('cursor');selectDrawing(list.length-1);primitive.update();
    };
    const showIndicatorValues=event=>{
      const values=Object.entries(overlays).flatMap(([name,series])=>{const point=event.seriesData.get(series);if(!Number.isFinite(point?.value))return [];const precision=name==='volume'?0:name==='rsi'?2:['macd','signal','histogram'].includes(name)?6:market?.digits??5;return [`${series.options().title||name}: ${point.value.toFixed(precision)}`];});
      el('indicator-values').textContent=values.join(' · ');
    };
    chart.subscribeClick(showIndicatorValues);
    chart.subscribeCrosshairMove(event=>{
      const point=event.seriesData.get(main);if(point){const value='open'in point?`O ${format(point.open)}  H ${format(point.high)}  L ${format(point.low)}  C ${format(point.close)}`:`Close ${format(point.value)}`;el('ohlc').textContent=value;}
      showIndicatorValues(event);
    });
    let saveTimer;chart.timeScale().subscribeVisibleLogicalRangeChange(()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(market&&lastChartKey===workspaceKey()){const visible=visibleDrawingRange();if(visible){state.views[workspaceKey()]=visible;persist();}}},300);});
    if(bars.length)renderMarket(range);
  }
  const format=value=>Number(value).toFixed(market?.digits??5);
  function renderMarket(range){
    if(!main)return;
    if(!bars.length){el('chart-empty').hidden=false;el('chart-empty').replaceChildren(text('span','No candle history available.'),text('small','Try another market or interval in MT5.'));return;}
    const first=lastChartKey!==workspaceKey();const visible=range||(!first?visibleDrawingRange():state.views[workspaceKey()]);
    main.applyOptions({priceFormat:{type:'price',precision:market.digits,minMove:market.tick_size||10**-market.digits}});
    for(const name of ['sma','ema','bbMiddle','bbUpper','bbLower'])overlays[name]?.applyOptions({priceFormat:{type:'price',precision:market.digits,minMove:market.tick_size||10**-market.digits}});
    main.setData(el('style').value==='line'?bars.map(b=>({time:b.time,value:b.close})):bars);
    const input=A.values(bars),put=(name,series)=>overlays[name]?.setData(A.points(bars,series));
    put('sma',A.sma(input,20));put('ema',A.ema(input,50));
    if(overlays.bbMiddle){const bb=A.bollinger(input);put('bbMiddle',bb.middle);put('bbUpper',bb.upper);put('bbLower',bb.lower);}
    if(overlays.rsi)put('rsi',A.rsi(input));
    if(overlays.macd){const macd=A.macd(input);put('macd',macd.line);put('signal',macd.signal);overlays.histogram.setData(A.points(bars,macd.histogram).map(p=>({...p,color:p.value>=0?'#43c9a080':'#ef738580'})));}
    overlays.volume?.setData(bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'#43c9a060':'#ef738560'})));
    for(const line of priceLines)main.removePriceLine(line);priceLines=[];
    const priceLine=(price,color,title)=>{if(price>0)priceLines.push(main.createPriceLine({price,color,lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:true,title}));};
    priceLine(market.ask,'#ef7385','ASK');
    for(const p of market.positions.filter(p=>p.symbol===el('symbol').value)){priceLine(p.price_open,'#a994ef',`#${p.ticket}`);priceLine(p.sl,'#ef7385','SL');priceLine(p.tp,'#43c9a0','TP');}
    if(first){if(visible&&visible.from<visible.to)restoreDrawingRange(visible);else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-110),to:bars.length+24});}
    else if(range)restoreDrawingRange(range);
    lastChartKey=workspaceKey();updateSelectionPrices();primitive.update();el('chart-empty').hidden=true;
  }
  function setTool(value){finishDrawingDrag(true);selectDrawing(-1);tool=value;pending=null;document.querySelectorAll('[data-drawing]').forEach(b=>{b.classList.toggle('selected',b.dataset.drawing===value);b.setAttribute('aria-pressed',String(b.dataset.drawing===value));});chart?.applyOptions({handleScroll:value==='cursor',handleScale:{axisPressedMouseMove:true,mouseWheel:value==='cursor',pinch:value==='cursor'}});el('chart').style.cursor=value==='cursor'?'crosshair':'copy';el('tool-hint').textContent=value==='cursor'?'Scroll to zoom · click drawings to select · drag empty space to pan':value==='level'?'Click anywhere in the price pane to place a level':'Click two anchors · Escape cancels';primitive?.update();}
  function clearMarket(){market=null;bars=[];lastChartKey='';invalidate();pending=null;main?.setData([]);for(const series of Object.values(overlays))series.setData([]);for(const line of priceLines)main.removePriceLine(line);priceLines=[];el('chart-empty').hidden=false;el('chart-empty').replaceChildren(text('span','Loading broker candles…'));el('ohlc').textContent='';el('bid').textContent='BID —';el('ask').textContent='ASK —';el('positions').replaceChildren();}
  function selectionChanged(){revision++;clearMarket();setTool('cursor');persist();renderWatchlist();refresh();}
  function chooseSymbol(symbol){if(!symbols.includes(symbol))return;el('symbol').value=symbol;el('search').value='';el('search-results').hidden=true;selectionChanged();}
  function renderWatchlist(){
    const rows=state.watch.map(symbol=>{const row=text('div','',symbol===el('symbol').value?'terminal-watch-row active':'terminal-watch-row');const button=text('button','');button.type='button';button.append(text('strong',symbol),text('small',quotes[symbol]?String(quotes[symbol].bid):'—'));button.onclick=()=>chooseSymbol(symbol);const remove=text('button','×');remove.type='button';remove.title='Remove '+symbol;remove.onclick=()=>{state.watch=state.watch.filter(s=>s!==symbol);persist();renderWatchlist();};row.append(button,remove);return row;});
    el('watchlist').replaceChildren(...(rows.length?rows:[text('p','Add markets using search or ＋ Add.')]));
  }
  el('search').oninput=()=>{const query=el('search').value.trim().toLowerCase();el('search-results').hidden=!query;el('search-results').replaceChildren(...symbols.filter(s=>s.toLowerCase().includes(query)).slice(0,25).map(symbol=>{const button=text('button',symbol);button.type='button';button.onclick=()=>{if(!state.watch.includes(symbol)&&state.watch.length<20)state.watch.push(symbol);chooseSymbol(symbol);};return button;}));};
  el('pin').onclick=()=>{const symbol=el('symbol').value;if(!symbol)return;if(!state.watch.includes(symbol)){if(state.watch.length>=20){status('Watchlist supports up to 20 markets. Remove one to add another.');return;}state.watch.push(symbol);persist();renderWatchlist();}};
  function renderAlerts(){el('alert-list').replaceChildren(...state.alerts.map(alert=>{const row=text('div','',alert.fired?'terminal-alert fired':'terminal-alert');row.append(text('strong',`${alert.symbol} ${alert.direction==='above'?'≥':'≤'} ${alert.price}`),text('small',alert.fired?'Triggered '+new Date(alert.fired).toLocaleTimeString():'Armed'));const button=text('button','×');button.type='button';button.title='Remove alert';button.onclick=()=>{state.alerts=state.alerts.filter(a=>a.id!==alert.id);persist();renderAlerts();};row.append(button);return row;}));}
  el('alert-form').onsubmit=event=>{event.preventDefault();if(!market)return;const price=Number(el('alert-price').value);if(!Number.isFinite(price)||price<=0)return;if(state.alerts.length>=20){status('Remove an alert before adding another (maximum 20).');return;}state.alerts.push({id:crypto.randomUUID(),symbol:el('symbol').value,price,direction:el('alert-direction').value,fired:null});persist();renderAlerts();};
  function checkAlerts(){let changed=false;for(const alert of state.alerts){const quote=quotes[alert.symbol];if(alert.fired||!quote||Date.now()/1000-quote.time>30||quote.time>Date.now()/1000+5)continue;if(alert.direction==='above'?quote.bid>=alert.price:quote.bid<=alert.price){alert.fired=Date.now();changed=true;}}if(changed){persist();renderAlerts();}}
  async function connectWorkspace(auto=false){
    if(connecting)return;connecting=true;el('start').disabled=true;
    try{
      if(!auto){status('Connecting to your running MT5 terminal…');const session=await call('session');if(!session.connected){const account=await call('connect',{path:document.getElementById('path').value||document.getElementById('terminals').value});if(typeof showAccount==='function')showAccount(account);}}
      const data=await call('terminal/symbols');const nextScope=JSON.stringify([data.server,data.account]);
      if(scope!==nextScope){invalidate();scope=nextScope;const source=saved.workspaces?.[scope]||{};state={watch:safeList(source.watch).filter(s=>typeof s==='string').slice(0,20),drawings:source.drawings&&typeof source.drawings==='object'?source.drawings:{},alerts:safeList(source.alerts).filter(a=>a&&typeof a.symbol==='string'&&Number.isFinite(a.price)).slice(0,20),views:source.views&&typeof source.views==='object'?source.views:{}};quotes={};}
      symbols=data.symbols;el('symbol').replaceChildren(...symbols.map(name=>new Option(name,name)));el('symbol').disabled=!symbols.length;
      if(!symbols.length)throw Error('Your broker returned no symbols. Check MT5 connection.');
      if(!state.watch.length)state.watch=(data.visible?.length?data.visible:symbols).slice(0,6);state.watch=state.watch.filter(s=>symbols.includes(s));
      applyLayout(saved.settings);if(!el('symbol').value)el('symbol').value=state.watch[0]||symbols[0];
      renderWatchlist();renderAlerts();running=true;selectionChanged();
    }catch(error){if(!auto)status(error.message);}finally{connecting=false;el('start').disabled=false;}
  }
  async function refresh(){
    if(loading||!running||drawingDrag||el('pane').hidden||document.hidden)return;
    loading=true;const version=revision;
    try{
      const symbol=el('symbol').value,timeframe=el('timeframe').value;
      const next=await call('terminal/market',{symbol,timeframe});if(version!==revision||drawingDrag)return;
      if(JSON.stringify([next.server,next.account])!==scope){running=false;clearMarket();throw Error('MT5 account changed. Connect again to load its workspace.');}
      market=next;bars=next.bars.map(b=>({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]||0}));
      const stale=Date.now()/1000-next.quote_time>30;
      el('feed').textContent=stale?'Last available quotes':next.demo?'Demo · connected':'Live · analysis';el('feed').classList.toggle('online',!stale);
      el('chart-title').textContent=`${symbol} · ${timeframe}`;el('ticket-symbol').textContent=symbol;
      el('bid').textContent='BID '+format(next.bid);el('ask').textContent='ASK '+format(next.ask);el('quote-time').textContent=(stale?'STALE · ':'')+new Date(next.quote_time*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
      el('account').replaceChildren(text('strong',`${next.demo?'DEMO':'LIVE · analysis only'} · ${next.account}`),text('small',next.server),...['balance','equity','margin_free'].map(name=>text('div',`${name==='margin_free'?'Free margin':name[0].toUpperCase()+name.slice(1)}  ${Number(next[name]).toFixed(2)} ${next.currency}`)));
      el('volume').min=next.volume_min;el('volume').max=next.volume_max;el('volume').step=next.volume_step;el('volume-info').textContent=`${next.volume_min}–${next.volume_max} lots · step ${next.volume_step} · spread ${format(next.ask-next.bid)}`;
      el('position-count').textContent=next.positions.length;
      const rows=next.positions.map(p=>{const row=document.createElement('tr');for(const value of [p.ticket,p.symbol,p.type===0?'BUY':'SELL',p.volume,p.price_open,p.price_current,p.sl||'—',p.tp||'—',p.profit])row.append(text('td',value));row.lastChild.className=p.profit>=0?'gain':'loss';return row;});
      el('positions').replaceChildren(...(rows.length?rows:[(()=>{const row=document.createElement('tr'),cell=text('td','No open positions.');cell.colSpan=9;row.append(cell);return row;})()]));
      updateTicket();renderMarket();status(stale?'Market is quiet or closed. Showing the latest available broker candles.':`${symbol} · ${bars.length} broker candles · Drawings and layouts save locally`);
      const quoteSymbols=[...new Set([...state.watch,...state.alerts.filter(a=>!a.fired).map(a=>a.symbol)])];
      if(quoteSymbols.length){try{const result=await call('terminal/quotes',{symbols:quoteSymbols});if(version===revision){if(JSON.stringify([result.server,result.account])!==scope)throw Error('Account changed. Reconnect MT5.');quotes=result.quotes;renderWatchlist();checkAlerts();}}catch(error){if(version===revision)status('Chart loaded; watchlist quotes unavailable: '+error.message);}}
    }catch(error){if(version===revision){el('feed').textContent='Disconnected';el('feed').classList.remove('online');status(error.message);market=null;invalidate();}}
    finally{loading=false;if(version!==revision)refresh();}
  }
  el('start').onclick=()=>connectWorkspace();
  el('symbol').onchange=selectionChanged;el('timeframe').onchange=selectionChanged;
  for(const name of [...indicators,'style'])el(name).onchange=()=>{buildChart();setTool(tool);persist();};
  document.querySelectorAll('[data-drawing]').forEach(button=>button.onclick=()=>setTool(button.dataset.drawing));
  el('delete-drawing').onclick=removeSelectedDrawing;
  el('undo').onclick=()=>{selectDrawing(-1);state.drawings[workspaceKey()]=currentDrawings().slice(0,-1);pending=null;persist();primitive?.update();};el('clear').onclick=()=>{selectDrawing(-1);state.drawings[workspaceKey()]=[];pending=null;persist();primitive?.update();};
  el('fit').onclick=()=>chart.timeScale().fitContent();el('latest').onclick=()=>chart.timeScale().scrollToRealTime();
  el('layout-save').onclick=()=>{saved.namedLayout=layout();persist();status('Layout saved. Use Restore layout to return to these settings.');};
  el('layout-restore').onclick=()=>{if(!saved.namedLayout){status('Save a layout first.');return;}applyLayout(saved.namedLayout);selectionChanged();buildChart();status('Saved layout restored.');};
  el('pane').addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;if(event.key==='Escape')setTool('cursor');if((event.key==='Delete'||event.key==='Backspace')&&selectedDrawing>=0){event.preventDefault();removeSelectedDrawing();}});
  el('ticket').oninput=()=>invalidate();
  el('ticket').onsubmit=async event=>{
    event.preventDefault();if(submitting||reviewing)return;invalidate();reviewing=true;updateTicket();const version=ticketRevision;
    const body={symbol:el('symbol').value,side:el('side').value,volume:el('volume').value,sl:el('sl').value,tp:el('tp').value};
    try{const result=await call('terminal/preview',body);if(version!==ticketRevision)return;preview=result.preview;
      const r=result.request;el('order-summary').replaceChildren(text('strong',`DEMO ${result.account} / ${result.server}`),text('p',`${body.side} ${r.volume} lots ${r.symbol} at market (quote ${r.price}). SL ${r.sl||'none'} · TP ${r.tp||'none'}.`));el('submit').hidden=false;
      expiryTimer=setTimeout(()=>{if(preview===result.preview){invalidate(false);el('order-summary').append(text('p','Preview expired. Review again.'));}},result.expires_in*1000);
    }catch(error){if(version===ticketRevision)el('order-summary').textContent=error.message;}finally{reviewing=false;updateTicket();}
  };
  el('submit').onclick=async()=>{
    if(!preview||submitting)return;const token=preview;invalidate(false);submitting=true;updateTicket();
    try{const result=await call('terminal/submit',{preview:token});el('order-summary').replaceChildren(text('strong',`Broker result ${result.retcode}: ${result.comment}`),text('p',`Order ${result.order} · deal ${result.deal} · filled ${result.volume} at ${result.price}. ${result.message}`));}
    catch(error){el('order-summary').textContent=error.message+' Check MT5 before retrying.';}finally{submitting=false;updateTicket();refresh();}
  };
  el('journal').onclick=()=>{if(typeof allowJournalSwitch==='function'&&!allowJournalSwitch())return;document.getElementById('journal-search').value=el('symbol').value;showJournalView('journal');};
  el('sync-journal').onclick=async()=>{if(typeof task!=='function')return;await task(async()=>{await loadHistory();status('Closed trades synced to your journal for the selected history dates.');});};
  // Capture selected-object drags before the chart can interpret them as panning.
  el('chart').addEventListener('pointerdown',event=>{
    if(tool!=='cursor'||!market||event.button!==0)return;
    const p=pointerPoint(event),size=chart.paneSize(0);if(p.x<0||p.y<0||p.x>size.width||p.y>size.height)return;
    const hit=drawingHit(p);selectDrawing(hit?.index??-1);
    if(!hit)return;
    el('chart').focus({preventScroll:true});event.preventDefault();event.stopImmediatePropagation();
    const list=currentDrawings(),original=structuredClone(list[hit.index]);
    drawingDrag={...hit,list,original,pointerId:event.pointerId,logical:chart.timeScale().coordinateToLogical(p.x),price:main.coordinateToPrice(p.y)};
    el('chart').setPointerCapture(event.pointerId);
  },true);
  el('chart').addEventListener('pointermove',event=>{
    if(!market||tool!=='cursor')return;
    const p=pointerPoint(event);
    if(!drawingDrag){const size=chart.paneSize(0);el('chart').style.cursor=p.x>=0&&p.y>=0&&p.x<size.width&&p.y<size.height&&drawingHit(p)?'move':'crosshair';return;}
    event.preventDefault();event.stopImmediatePropagation();
    const drag=drawingDrag,size=chart.paneSize(0),x=Math.max(0,Math.min(size.width,p.x)),y=Math.max(0,Math.min(size.height,p.y));
    const logical=chart.timeScale().coordinateToLogical(x),price=main.coordinateToPrice(y);if(logical===null||price===null)return;
    const updated=structuredClone(drag.original);
    if(drag.anchor)updated[drag.anchor]={time:drawingTime(logical),price};
    else for(const name of ['a','b'])if(updated[name])updated[name]={time:drawingTime(drawingLogical(drag.original[name].time)+logical-drag.logical),price:drag.original[name].price+price-drag.price};
    drag.list[drag.index]=updated;updateSelectionPrices();el('chart').style.cursor='grabbing';primitive?.update();
  },true);
  el('chart').addEventListener('pointerup',event=>{if(!drawingDrag)return;event.preventDefault();event.stopImmediatePropagation();finishDrawingDrag();},true);
  el('chart').addEventListener('pointercancel',()=>finishDrawingDrag(true),true);
  buildChart();setTool('cursor');
  new MutationObserver(()=>{if(!el('pane').hidden){if(!running)connectWorkspace(true);else refresh();}}).observe(el('pane'),{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(refresh,2000);
})();
