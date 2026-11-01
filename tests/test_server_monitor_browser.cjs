const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18883,url=`http://127.0.0.1:${port}`;
const server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['tests/monitor_browser_server.py','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.on('data',s=>{if(s.toString().includes('http://'))resolve();});server.stderr.on('data',s=>process.stderr.write(s));server.on('error',reject);setTimeout(()=>reject(Error('Server startup timeout')),15000).unref();});
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1536,height:1100}}),errors=[];
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#nav-terminal').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 const token=await page.locator('meta[name=replay-token]').getAttribute('content');
 const post=async(route,body={})=>{const response=await context.request.post(url+'/api/'+route,{headers:{'X-Replay-Token':token},data:body});assert.equal(response.status(),200,await response.text());return response.json();};
 const waitState=async(predicate)=>{const until=Date.now()+12000;while(Date.now()<until){const value=await post('test/feed');if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Monitor state timeout: '+JSON.stringify(await post('test/feed')));};
 const setup=async(level,action)=>{
  await page.locator('#terminal-setup-new').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();await page.locator('.terminal-condition-row [data-field=level]').fill(String(level));
  await page.locator('#terminal-condition-action').selectOption(action);await page.locator('#terminal-condition-start').click();
  return (await waitState(s=>s.state.run?.phase==='running')).state.run.id;
 };
 const first=await setup(1.104,'AUTO');const background=await context.newPage();await background.goto('about:blank');await background.bringToFront();
 // Headless Chromium can keep all tabs "visible"; explicitly dispatch the hidden
 // state as well as testing a genuinely closed page below.
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await post('test/feed',{bid:1.105});
 await waitState(s=>s.sent===1&&s.state.run.phase==='finished');
 await page.bringToFront();await page.reload();await page.locator('#nav-terminal').click();await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('Finished · broker'));
 assert.equal((await post('terminal/conditions/status')).run.id,first,'reload reconnects to same completed run');
 const second=await setup(1.2,'AUTO');await page.reload();await page.locator('#nav-terminal').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-condition-status').textContent.includes('Server monitoring'));
 assert.equal((await post('terminal/conditions/status')).run.id,second);await page.locator('#terminal-condition-stop').click();await waitState(s=>s.state.run.phase==='stopped');
 await post('test/feed',{bid:1.21});assert.equal((await post('test/feed')).sent,1,'stopped server cannot submit');await post('test/feed',{bid:1.105});
 await setup(1.106,'AUTO');await page.close();await post('test/feed',{bid:1.107});await waitState(s=>s.sent===2&&s.state.run.phase==='finished');
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#nav-terminal').click();await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 await post('test/feed',{preview_delay:1.5});await setup(1.108,'AUTO');await post('test/feed',{bid:1.109});
 const previewDeadline=Date.now()+3000;let entered=false;while(Date.now()<previewDeadline){entered=(await (await context.request.get(url+'/test/preview-started')).json()).started;if(entered)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(entered,true,'server is inside the slow broker preview');
 await post('terminal/conditions/stop');assert.equal((await post('test/feed')).sent,2,'HTTP Stop during preview prevents a later order send');
 await post('test/feed',{preview_delay:0,bid:1.107});
 await setup(1.108,'REVIEW');await background.bringToFront();await post('test/feed',{bid:1.109});await waitState(s=>s.state.run.phase==='review');assert.equal((await post('test/feed')).sent,2);
 await page.bringToFront();await page.reload();await page.locator('#nav-terminal').click();await page.locator('#terminal-submit').waitFor();assert.equal((await post('test/feed')).sent,2,'review never auto-sends while hidden');
 await post('test/feed',{expire:true});await waitState(s=>s.state.run.phase==='finished');await page.waitForFunction(()=>document.querySelector('#terminal-submit').hidden);
 await setup(1.11,'AUTO');await background.bringToFront();await post('test/feed',{account:'456',bid:1.111});await waitState(s=>s.state.run.phase==='stopped');assert.equal((await post('test/feed')).sent,2);
 await page.bringToFront();await page.locator('#terminal-pane').screenshot({path:path.join(root,'work/server-monitor.png')});assert.deepEqual(errors,[]);
 console.log('Real local-server monitor browser tests passed (fake broker; no real trades): hidden tab, reload, closed page, Stop, review expiry and account change');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
