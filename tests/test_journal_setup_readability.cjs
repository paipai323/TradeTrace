const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');let browser;
(async()=>{
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await chromium.launch({headless:true,executablePath});const page=await browser.newPage({viewport:{width:1200,height:1100}});
 await page.setContent('<html><body><section id="journal-trade-condition-entries"><div></div></section></body></html>');
 await page.addStyleTag({path:path.join(root,'static/style.css')});await page.addStyleTag({path:path.join(root,'static/journal.css')});await page.addStyleTag({content:'body{padding:25px;margin:0;background:#0c1420;color:#e4edf9;font-family:Arial}#journal-trade-condition-entries{max-width:1050px;margin:auto}'});
 await page.addScriptTag({path:path.join(root,'static/terminal-conditions.js')});
 const source=fs.readFileSync(path.join(root,'static/journal.js'),'utf8'),start=source.indexOf('function conditionEntryCard('),end=source.indexOf('function renderJournalConditionEntries()',start);
 await page.addScriptTag({content:'function element(tag,value){const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;}\n'+source.slice(start,end)});
 const sample={created:'2026-11-04T12:55:02Z',demo:false,result:{retcode:10009,comment:'ok',order:'4403271756',deal:'4037055503',price:78076.2,volume:.29},request:{symbol:'BTCUSDc',type:1,price:78072.84,volume:.29,sl:78246.33,tp:77725.26},setup:{name:'Sell after M5 structure break',started:Date.parse('2026-11-04T12:29:52Z'),action:'AUTO',settings:{ticket:{side:'SELL'},autoPlan:{enabled:true,risk:.5},timeout:0,gap:300},rows:[{rule:'BOS_DOWN',mode:'CANDLE',timeframe:'M5',sensitivity:1}],invalidation:{enabled:true,direction:'ABOVE',level:78628.83},automatic_plan:{risk_percent:.5,modeled_loss:50.37,modeled_reward:100.74,currency:'USC',rr:2,stop_swing:{price:78246.23},buffer_ticks:10},observations:[{type:'passed',index:0,observed_at:Date.parse('2026-11-04T12:55:02Z'),bid:78072.84,structure:{type:'BOS',level:78094.81},candle:{time:1793796600,open:78200.97,high:78271.89,low:78021.76,close:78055.96}}]}};
 await page.evaluate(item=>renderConditionEntryCards(document.querySelector('#journal-trade-condition-entries>div'),[item]),sample);
 assert.equal(await page.locator('.journal-setup-card').evaluate(e=>e.open),true);assert.equal(await page.locator('.journal-setup-technical').evaluate(e=>e.open),false);
 assert.equal(await page.locator('.journal-setup-metrics>div').count(),8);assert.equal(await page.locator('.journal-setup-timeline>li').count(),3);
 for(const width of [1200,390]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');await page.screenshot({path:path.join(root,`work/journal-readable-${width}.png`),fullPage:true});}
 await page.locator('.journal-setup-technical>summary').click();assert.match(await page.locator('.journal-setup-technical').textContent(),/4403271756/);
 await page.evaluate(()=>renderConditionEntryCards(document.querySelector('#journal-trade-condition-entries>div'),[{created:new Date().toISOString(),result:{retcode:10013,comment:'Rejected'},request:{type:2},setup:{}}]));
 assert.match(await page.locator('.journal-setup-heading').textContent(),/Broker result: Rejected/);assert.match(await page.locator('.journal-setup-card').textContent(),/Not recorded/);
 console.log('Journal setup readability checks passed: desktop/mobile, collapsed technical details, explicit execution status, missing data, labelled prices and timeline.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
