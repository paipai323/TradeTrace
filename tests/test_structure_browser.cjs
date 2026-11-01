/* Isolated, headless UI regression test. Every broker endpoint is intercepted. */
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const playwright=require('playwright');
const demo=process.env.TRADETRACE_TEST_LIVE!=='1';
const root=path.resolve(__dirname,'..'),port=18880,url=`http://127.0.0.1:${port}`;
const server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['server.py','--port',String(port),'--no-browser'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
const candles=Array.from({length:300},(_,i)=>[Date.UTC(2026,9,20)/1+300000*i,1.1+i*.00001,1.1003+i*.00001,1.0997+i*.00001,1.1001+i*.00001,100+i]);
const hourlyCandles=candles.map((bar,i)=>[Math.floor(candles.at(-1)[0]/3600000)*3600000-(299-i)*3600000,...bar.slice(1)]);
let browser;
let tradingAllowed=true,quoteAge=0;
let estimateMultiplier=1;
let equityOffset=0;
let mockBid=1.103;
let marketDelay=0;
const conditionBodies=[];
const journalEntries=[],previewSetups=new Map();
const journalAccount=JSON.stringify(['123','Test-Demo']);
(async()=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test server timeout')),15000);server.stdout.on('data',chunk=>{if(chunk.toString().includes('http://')){clearTimeout(timer);resolve();}});server.on('error',reject);server.stderr.on('data',chunk=>process.stderr.write(chunk));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
  browser=await playwright.chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1536,height:1100}}),errors=[];let draftEstimateDelay=0,draftEstimateCalls=0,positionAmendments=0,positionLevels={sl:1.09,tp:1.12},proposedLevels=null,previews=0,submissions=0,planRequests=0,planDelay=0,positionClosed=false,pendingExists=false,pendingSnapshot=null,pendingModification=null,mockConnected=false,connectionCalls=0,lastConnectionPath=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const request=route.request(),endpoint=new URL(request.url()).pathname,body=request.postDataJSON()||{};
    if(endpoint==='/api/terminal/market'&&marketDelay)await new Promise(resolve=>setTimeout(resolve,marketDelay));
    if(endpoint==='/api/terminal/preview'&&body.condition_entry)conditionBodies.push(body);
    let value={};
    if(endpoint==='/api/session')value={connected:mockConnected,key_saved:false,account:'123',server:'Test-Demo',currency:'USD',direct:false};
    else if(endpoint==='/api/journal/overview')value={accounts:journalEntries.length?[{id:journalAccount,login:'123',server:'Test-Demo',currency:'USD'}]:[],account:journalEntries.length?journalAccount:null,trades:[],condition_entries:journalEntries};
    else if(endpoint==='/api/connect'||endpoint==='/api/connect-all'){mockConnected=true;connectionCalls++;lastConnectionPath=body.path;value={account:'123',server:'Test-Demo',currency:'USD',path:'C:/Test/terminal64.exe',native:{state:'setup',message:'Test history connector optional',levels:[],key_saved:false}};}
    else if(endpoint==='/api/history')value={trades:[],skipped:0};
    else if(endpoint==='/api/terminal/symbols')value={symbols:['EURUSD','GBPUSD','XAUUSD'],visible:['EURUSD','GBPUSD'],account:'123',server:'Test-Demo',currency:'USD',demo};
    else if(endpoint==='/api/terminal/market')value={bars:body.timeframe==='H1'?hourlyCandles:candles,bid:mockBid,ask:mockBid+.0001,quote_time:Date.now()/1000-quoteAge,trading_allowed:tradingAllowed,digits:5,tick_size:.00001,volume_min:.01,volume_max:10,volume_step:.01,balance:10000,equity:10020+equityOffset,margin_free:9990,currency:'USD',account:'123',server:'Test-Demo',demo,orders:pendingExists?[pendingSnapshot]:[],positions:positionClosed?[]:[{ticket:'42',symbol:'EURUSD',type:0,volume:.01,price_open:1.101,price_current:1.103,...positionLevels,profit:20}]};
    else if(endpoint==='/api/terminal/closed')value={account:'123',server:'Test-Demo',currency:'USD',positions:[{id:'41',symbol:'EURUSD',side:'BUY',volume:.01,entry:1.1,exit:1.102,end:Date.now(),net:1.8}],note:'Last 30 days · test net P/L'};
    else if(endpoint==='/api/terminal/quotes')value={account:'123',server:'Test-Demo',quotes:Object.fromEntries(body.symbols.map(s=>[s,{bid:mockBid,ask:mockBid+.0001,time:Date.now()/1000}]))};
    else if(endpoint==='/api/terminal/estimate'){draftEstimateCalls++;if(draftEstimateDelay)await new Promise(resolve=>setTimeout(resolve,draftEstimateDelay));const sign=body.side==='BUY'?1:-1,profit=price=>price?sign*(Number(price)-Number(body.entry))*Number(body.volume)*100000*estimateMultiplier:null;value={account:'123',server:'Test-Demo',currency:'USD',sl:profit(Number(body.sl)),tp:profit(Number(body.tp))};}
    else if(endpoint==='/api/terminal/plan'){planRequests++;if(planDelay)await new Promise(resolve=>setTimeout(resolve,planDelay));value={account:'123',server:'Test-Demo',currency:'USD',risk:12.5,reward:25,mark_to_market:3,quote_time:Date.now()/1000-quoteAge,trading_allowed:tradingAllowed,note:'Mock gross estimate; no trade placed'};}
    else if(endpoint==='/api/terminal/position-preview'){assert.equal(body.position,'42');proposedLevels={sl:Number(body.sl),tp:Number(body.tp)};value={preview:'mock-position-token',expires_in:60,account:'123',server:'Test-Demo',request:{action:6,position:42,symbol:'EURUSD',...proposedLevels}};}
    else if(endpoint==='/api/terminal/modify-preview'){pendingModification={price:Number(body.price),sl:Number(body.sl),tp:Number(body.tp)};value={preview:'mock-modify-token',expires_in:60,account:'123',server:'Test-Demo',request:{order:88,symbol:'EURUSD',...pendingModification}};}
    else if(endpoint==='/api/terminal/cancel-preview')value={preview:'mock-cancel-token',expires_in:60,account:'123',server:'Test-Demo',request:{order:88,symbol:'EURUSD',action:8}};
    else if(endpoint==='/api/terminal/close-preview')value={preview:'mock-close-token',expires_in:60,account:'123',server:'Test-Demo',request:{position:42,symbol:'EURUSD',volume:.01,price:1.103,type:1}};
    else if(endpoint==='/api/terminal/preview'){previews++;await new Promise(resolve=>setTimeout(resolve,250));const pending=body.order_kind&&body.order_kind!=='MARKET',kind=body.order_kind==='PENDING'?(body.side==='BUY'?(Number(body.price)<1.1031?'LIMIT':'STOP'):(Number(body.price)>1.103?'LIMIT':'STOP')):body.order_kind;if(pending)pendingSnapshot={ticket:'88',symbol:body.symbol,type:body.side==='BUY'?(kind==='LIMIT'?2:4):(kind==='LIMIT'?3:5),volume:Number(body.volume),price:Number(body.price),sl:Number(body.sl),tp:Number(body.tp)};value={preview:pending?'mock-pending-token':'test-token',order_kind:kind,expires_in:60,account:'123',server:'Test-Demo',request:{symbol:body.symbol,volume:Number(body.volume),price:pending?Number(body.price):1.1031,sl:Number(body.sl)||0,tp:Number(body.tp)||0}};}
    else if(endpoint==='/api/terminal/submit'){if(body.preview==='mock-position-token'){positionAmendments++;positionLevels={...proposedLevels};value={retcode:10009,comment:'Mocked protection amendment',operation:'position-sltp',order:'0',deal:'0',volume:0,price:0,message:'Test only'};}else {submissions++;}if(body.preview==='mock-position-token'){}else if(body.preview==='mock-modify-token'){pendingSnapshot={...pendingSnapshot,...pendingModification};value={retcode:10009,comment:'Mocked amendment',order:'88',deal:'0',volume:0,price:0,operation:'modify',message:'Test only'};}else if(body.preview==='mock-cancel-token'){pendingExists=false;value={retcode:10009,comment:'Mocked cancellation',order:'88',deal:'0',volume:0,price:0,operation:'cancel',message:'Test only'};}else if(body.preview==='mock-pending-token'){pendingExists=true;value={retcode:10008,comment:'Mocked pending accepted',order:'88',deal:'0',volume:0,price:0,operation:'pending',message:'Test only'};}else if(body.preview==='mock-close-token'){positionClosed=true;value={retcode:10009,comment:'Mocked closure',order:'101',deal:'102',volume:.01,price:1.103,operation:'close',remaining_volume:0,message:'Test only'};}else value={retcode:10009,comment:'Mocked execution',order:'99',deal:'100',volume:.01,price:1.1031,message:'Test only'};}
    else return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Not available in isolated browser test'})});
    if(endpoint==='/api/terminal/preview'){if(body.condition_entry)previewSetups.set(value.preview,structuredClone(body));else previewSetups.delete(value.preview);}
    if(endpoint==='/api/terminal/submit'&&previewSetups.has(body.preview)){
      const saved=previewSetups.get(body.preview);previewSetups.delete(body.preview);
      journalEntries.unshift({id:'entry-'+journalEntries.length,created:new Date().toISOString(),position:null,demo,setup:saved.condition_setup,request:{symbol:saved.symbol,sl:saved.sl,tp:saved.tp},result:{...value,operation:value.operation||'open'}});value.journal_recorded=true;
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  });
  await page.goto(url);await page.locator('#nav-terminal').click();
  await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
  const structureSubmissions=submissions;
  await page.locator('#nav-terminal').click();await page.locator('#terminal-setup-new').click();
  await page.locator('#terminal-symbol').selectOption('EURUSD');
  await page.locator('#terminal-interval-favorites [data-interval="M5"]').click();
  const structureValues=[10,14,11,16,12,15,13,17,14,18,15,11,13,10];
  const startTime=Math.floor(Date.now()/300000)*300000-300000*20;
  const structureBars=structureValues.map((value,i)=>{const p=1.1+value*.0001;return [startTime+i*300000,p,p+.00002,p-.00002,p,100];});
  candles.splice(0,candles.length,...structureBars.slice(0,8));
  await page.waitForTimeout(2500);
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();
  const structureRow=page.locator('.terminal-condition-row').last();
  await structureRow.locator('[data-field=rule]').selectOption('BOS_UP');
  assert.equal(await structureRow.locator('[data-field=mode]').inputValue(),'CANDLE');
  assert.equal(await structureRow.locator('[data-field=mode]').isDisabled(),true);
  assert.equal(await structureRow.locator('[data-field=level]').isVisible(),false);
  assert.equal(await structureRow.locator('[data-field=sensitivity]').inputValue(),'2');
  assert.equal(await structureRow.locator('[data-field=sensitivity]').locator('..').getByRole('button',{name:'Pick on chart'}).count(),0);
  await structureRow.locator('[data-field=timeframe]').selectOption('M5');await structureRow.locator('[data-field=sensitivity]').fill('1');
  await page.waitForFunction(()=>document.querySelector('#terminal-setup-readiness-checks').textContent.includes('Bullish structure'));
  await page.locator('#terminal-fit').click();
  await page.locator('[data-condition-grip=structure]').waitFor();
  assert.match(await page.locator('[data-condition-grip=structure]').getAttribute('title'),/Calculated confirmed swing/);
  const beforeDrag=await structureRow.locator('[data-field=level]').inputValue(),grip=await page.locator('[data-condition-grip=structure]').boundingBox();
  await page.mouse.move(grip.x+20,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x+20,grip.y+50,{steps:5});await page.mouse.up();
  assert.equal(await structureRow.locator('[data-field=level]').inputValue(),beforeDrag,'calculated swing cannot be dragged');
  await page.locator('#terminal-condition-show-levels').uncheck();await page.locator('[data-condition-grip=structure]').waitFor();
  await structureRow.locator('.terminal-condition-summary').click();await page.locator('[data-condition-grip=structure]').waitFor({state:'detached'});
  await structureRow.locator('.terminal-condition-summary').click();await page.locator('[data-condition-grip=structure]').waitFor();
  await page.locator('#terminal-condition-show-levels').check();
  await page.locator('#terminal-pane').screenshot({path:path.join(root,'work/structure-levels.png')});
  await structureRow.locator('[data-field=sensitivity]').fill('0');assert.equal(await page.locator('#terminal-condition-start').isDisabled(),true);
  await structureRow.locator('[data-field=sensitivity]').fill('1');
  for(const rule of ['MS_DOWN','BOS_DOWN','MS_UP','BOS_UP'])await structureRow.locator('[data-field=rule]').selectOption(rule);
  await page.locator('#terminal-condition-start').click();
  await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('watching'));
  candles.splice(0,candles.length,...structureBars.slice(0,9));
  await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('All conditions passed. Finished'));
  assert.match(await page.locator('#terminal-condition-events').textContent(),/BOS, swing/);
  await page.locator('#terminal-condition-templates summary').click();
  await page.locator('#terminal-condition-template-name').fill('Structure continuation');await page.locator('#terminal-condition-template-save').click();
  await page.locator('#terminal-setup-new').click();await page.locator('#terminal-condition-template-load').click();
  assert.equal(await page.locator('.terminal-condition-row [data-field=rule]').inputValue(),'BOS_UP');
  assert.equal(await page.locator('.terminal-condition-row [data-field=sensitivity]').inputValue(),'1');
  assert.equal(await page.locator('#terminal-condition-action').inputValue(),'ALERT');
  await page.locator('#terminal-condition-preview summary').click();
  assert.match(await page.locator('#terminal-condition-preview-text').textContent(),/Bullish BOS on M5.*using 1 candles each side/);
  await page.locator('#terminal-pane').screenshot({path:path.join(root,'work/structure-conditions.png')});
  assert.equal(submissions,structureSubmissions,'structure previews, alert monitoring and templates never send orders');
  candles.splice(0,candles.length,...structureBars.slice(0,8));await page.waitForTimeout(2500);
  await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-action').selectOption('AUTO');
  await page.locator('#terminal-condition-start').click();
  await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('watching'));
  candles.splice(0,candles.length,...structureBars.slice(0,9));
  await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('Setup saved to journal'));
  assert.equal(submissions,structureSubmissions+1);
  const observation=conditionBodies.at(-1).condition_setup.observations.find(event=>event.structure);
  assert.equal(observation.structure.type,'BOS');assert.equal(observation.structure.level,1.10152);
  assert.equal(observation.structure.candle.time,structureBars[7][0]/1000);
  await page.locator('#nav-journal').click();await page.waitForFunction(()=>Number(document.querySelector('#journal-condition-count').textContent)===1);
  await page.locator('#journal-condition-log>summary').click();await page.locator('#journal-condition-entries>details>summary').click();
  await page.locator('#journal-condition-entries details details>summary').click();
  assert.match(await page.locator('#journal-condition-entries').textContent(),/Bullish BOS.*1 swing candles each side/);
  assert.match(await page.locator('#journal-condition-entries').textContent(),/BOS at 1.10152/);
  await page.locator('#journal-condition-log').screenshot({path:path.join(root,'work/structure-journal.png')});
  assert.deepEqual(errors,[]);console.log('Structure browser tests passed (mock broker; no real trades)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
