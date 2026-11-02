const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18884,url=`http://127.0.0.1:${port}`;
const server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['tests/monitor_browser_server.py','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.on('data',s=>{if(s.toString().includes('http://'))resolve();});server.stderr.on('data',s=>process.stderr.write(s));server.on('error',reject);setTimeout(()=>reject(Error('Server startup timeout')),15000).unref();});
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1536,height:1100}}),errors=[];
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.context().addInitScript(()=>localStorage.setItem('tradetrace.quickEditorOpen','true'));await page.goto(url);await page.locator('#nav-terminal').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 const token=await page.locator('meta[name=replay-token]').getAttribute('content');
 const post=async(route,body={})=>{const response=await context.request.post(url+'/api/'+route,{headers:{'X-Replay-Token':token},data:body});assert.equal(response.status(),200,await response.text());return response.json();};
 const waitState=async(predicate)=>{const until=Date.now()+12000;while(Date.now()<until){const value=await post('test/feed');if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Monitor state timeout: '+JSON.stringify(await post('test/feed')));};
 const setup=async(level,action)=>{
  await page.locator('#terminal-setup-new').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();await page.locator('.terminal-condition-row [data-field=level]').fill(String(level));
  await page.locator('#terminal-invalidation-enabled').check();await page.locator('#terminal-invalidation-settings').evaluate(e=>e.open=true);
  await page.locator('#terminal-invalidation-source').selectOption('LEVEL');await page.locator('#terminal-invalidation-direction').selectOption('ABOVE');await page.locator('#terminal-invalidation-level').fill('1.11');
  await page.locator('#terminal-condition-action').selectOption(action);await page.locator('#terminal-condition-start').click();
  return (await waitState(s=>s.state.run?.phase==='running')).state.run.id;
 };

 await setup(1.104,'AUTO');
 await page.locator('#terminal-invalidation-level').fill('1.2');
 await post('test/feed',{bid:1.111});
 let state=await waitState(s=>s.state.run.phase==='invalidated');
 assert.equal(state.sent,0,'cancellation wins over entry on the same quote');assert.equal(state.state.run.invalidation.level,1.11,'draft edits cannot move the applied guard');
 await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('Invalidated'));
 await page.locator('#terminal-pane').screenshot({path:path.join(root,'work/invalidation-chart.png')});
 await post('test/feed',{bid:1.103});await setup(1.104,'REVIEW');await post('test/feed',{bid:1.105});
 state=await waitState(s=>s.state.run.phase==='review');const preview=state.state.run.review.preview;
 await page.close();await post('test/feed',{bid:1.11});state=await waitState(s=>s.state.run.phase==='invalidated');
 assert.equal(state.sent,0);assert.equal(state.state.run.review,null,'review cleared with the browser closed');
 const rejected=await context.request.post(url+'/api/terminal/submit',{headers:{'X-Replay-Token':token},data:{preview}});assert.notEqual(rejected.status(),200,'old review token cannot submit');
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#nav-terminal').click();await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 await post('test/feed',{bid:1.103});await setup(1.104,'AUTO');await post('test/feed',{bid:1.105});await waitState(s=>s.sent===1&&s.state.run.phase==='finished');
 await post('test/feed',{bid:1.111});assert.equal((await post('test/feed')).state.run.phase,'finished','guard ends after submission');
 assert.deepEqual(errors,[]);console.log('Invalidation browser tests passed: frozen guard, entry priority, closed-page review cancellation, expired token, one attempt; fake broker only');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
