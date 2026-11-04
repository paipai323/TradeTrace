const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18889,url=`http://127.0.0.1:${port}`;
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
 const setup=async(level,action,name,minimum=0)=>{
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-monitor-toolbar').click();await page.locator('#terminal-monitor-add').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();await page.locator('.terminal-condition-row [data-field=level]').fill(String(level));
  await page.locator('#terminal-monitor-name').fill(name);if(minimum){await page.locator('#terminal-quality-enabled').check();await page.locator('#terminal-quality-settings').evaluate(e=>e.open=true);await page.locator('#terminal-quality-min_rr').fill(String(minimum));}
  await page.locator('#terminal-condition-action').selectOption(action);await page.locator('#terminal-condition-start').click();
  return (await waitState(s=>s.state.run?.phase==='running'&&s.state.run.name===name)).state.run.id;
 };

 let requests=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/terminal/conditions/estimate')requests++;});
 const first=await setup(1.2,'AUTO','Estimate pass');let card=page.locator(`[data-monitor-id="${first}"]`);await page.locator('#terminal-monitor-toolbar').click();await card.locator(':scope>.terminal-monitor-row-details>summary').click();await card.locator('.terminal-monitor-estimate>summary').click();
 await card.locator('.terminal-estimate-outcome').filter({hasText:'Would pass'}).waitFor();assert.match(await card.locator('.terminal-monitor-estimate-body').textContent(),/modeled risk.*Available RR/);
 const before=(await post('test/feed'));assert.equal(before.previews,0);assert.equal(before.sent,0);assert.equal(before.state.run.phase,'running');assert.equal(before.state.run.applied.index,0);
 await page.waitForTimeout(2200);assert.equal(requests,1,'estimates do not poll automatically');
 const second=await setup(1.2,'AUTO','Estimate skip',2);const other=page.locator(`[data-monitor-id="${second}"]`);await page.locator('#terminal-monitor-toolbar').click();await other.locator(':scope>.terminal-monitor-row-details>summary').click();await other.locator('.terminal-monitor-estimate>summary').click();
 await other.locator('.terminal-estimate-outcome').filter({hasText:'Would skip'}).waitFor();assert.match(await other.locator('.terminal-monitor-estimate-body').textContent(),/below minimum/);
 let state=await post('test/feed');assert.equal(state.state.runs.filter(run=>run.phase==='running').length,2,'estimate failure does not skip a real monitor');assert.equal(state.previews,0);assert.equal(state.sent,0);
 card=page.locator(`[data-monitor-id="${first}"]`);await card.locator('.terminal-estimate-age').evaluate(node=>node.dataset.received=String(Date.now()-20000));await card.locator('.terminal-estimate-age').filter({hasText:'Old estimate'}).waitFor();
 await page.waitForTimeout(3200);await post('test/feed',{bid:1.106});await card.getByRole('button',{name:'Refresh estimate',exact:true}).click();
 await page.waitForFunction(id=>document.querySelector(`[data-monitor-id="${id}"] .terminal-monitor-estimate-body`).textContent.includes('1.10610'),first);
 await page.locator('#terminal-monitor-list').screenshot({path:path.join(root,'work/monitor-estimates.png')});
 assert.equal((await post('test/feed')).previews,0);assert.deepEqual(errors,[]);
 console.log('Monitor estimate browser tests passed: independent pass/skip, no tokens or orders, unchanged progress, on-demand refresh and stale labeling; fake broker only');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
