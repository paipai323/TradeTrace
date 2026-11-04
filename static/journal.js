let journalModel={accounts:[],account:null,trades:[]}, journalPosition=null, journalDirty=false;
let journalView='journal', journalDay=null, journalRequest=0, journalSaving=false;
let journalImageUrls=[];
let journalRevision=0;
let journalSavedVersion=null,draftTimer=null;
let draftSafeRevision=-1,draftSafeSelection=-1;
const draftIsSafe=()=>draftSafeRevision===journalRevision&&draftSafeSelection===journalRequest;
const draftPending=new Map(),draftWorkers=new Set();
const draftKey=(account,position)=>'mt5-journal-draft:'+account+':'+position;
function reviewFromForm(){
  const review={notes:$('journal-notes').value,lesson:$('journal-lesson').value,tags:$('journal-tags').value.split(',').map(t=>t.trim()).filter(Boolean),rating:Number($('journal-rating').value),reviewed:$('journal-reviewed').checked,checks:{}};
  for(const key of ['planned','risk','entry','exit'])review.checks[key]=$('review-'+key).checked;
  return review;
}
function persistDraftLocally(){
  if(!journalPosition||!journalDirty)return true;
  try{localStorage.setItem(draftKey(journalModel.account,journalPosition),JSON.stringify({review:reviewFromForm(),updated:new Date().toISOString(),base_updated:journalSavedVersion}));return true;}catch(_){return false;}
}
function flushJournalDraft(){
  clearTimeout(draftTimer);
  if(!journalPosition||!journalDirty)return;
  const payload={account:journalModel.account,position:journalPosition,review:reviewFromForm(),base_updated:journalSavedVersion,revision:journalRevision,selection:journalRequest};
  const key=draftKey(payload.account,payload.position);draftPending.set(key,payload);
  if(draftWorkers.has(key))return;
  draftWorkers.add(key);
  (async()=>{
    while(draftPending.has(key)){
      const next=draftPending.get(key);draftPending.delete(key);
      try{
        await api('journal/draft',next);
        if(next.account===journalModel.account&&next.position===journalPosition&&next.selection===journalRequest&&next.revision===journalRevision&&journalDirty){draftSafeRevision=journalRevision;draftSafeSelection=journalRequest;$('journal-save-status').textContent='Draft saved automatically · click Save review to finalize';}
      }catch(error){if(next.account===journalModel.account&&next.position===journalPosition&&next.selection===journalRequest&&journalDirty&&!journalSaving)$('journal-save-status').textContent='Draft kept in browser · '+error.message;}
    }
    draftWorkers.delete(key);
  })();
}
const replayPlayer=document.querySelector('.player');
for(const button of replayPlayer.querySelectorAll('button'))button.type='button';
let inlineReplay=false;
function replayMatchesJournal(){
  const account=journalModel.accounts.find(row=>row.id===journalModel.account),source=window.replayDataAccount;
  return data&&data.trade.id===journalPosition&&account&&account.login===source?.account&&account.server===source?.server;
}
function snapshotReplay(){
  if(data&&$('chart').width>0&&$('chart').getBoundingClientRect().width>0){
    window.journalChartSnapshot={position:data.trade.id,account:window.replayDataAccount,clock,image:$('chart').toDataURL('image/png')};
  }
}
function placeReplay(){
  const inline=inlineReplay&&journalView!=='replay'&&replayMatchesJournal();
  const destination=inline?$('journal-inline-replay'):$('replay-pane');
  if(replayPlayer.parentElement!==destination)destination.append(replayPlayer);
  $('journal-inline-replay').hidden=!inline;
  $('journal-replay').textContent=inline?'Hide replay':connected?'Show replay here':'Connect & show replay';
  $('journal-replay').setAttribute('aria-expanded',String(Boolean(inline)));
}
function closeInlineReplay(){snapshotReplay();pause();inlineReplay=false;placeReplay();}
function clearJournalSelection(){
  if($('screenshot-viewer').open)$('screenshot-viewer').close();
  closeInlineReplay();journalRequest++;journalPosition=null;journalDirty=false;journalRevision=0;
  $('journal-form').reset();$('journal-form').hidden=true;$('journal-empty').hidden=false;
  $('journal-empty').querySelector('h2').textContent='Select a trade from this date.';
  $('journal-empty').querySelector('p').textContent='Choose a position on the left to open its review and replay.';
  $('journal-save-status').textContent='';$('journal-replay-status').textContent='';
  $('journal-upload-status').textContent='';
  for(const url of journalImageUrls)URL.revokeObjectURL(url);journalImageUrls=[];$('journal-images').replaceChildren();
  updateReplayActions();
}
function changeCalendarScope(change){
  if(!allowJournalSwitch())return false;
  clearJournalSelection();change();renderJournal();return true;
}
const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
if(!['Asia/Bangkok','UTC'].includes(localZone))$('journal-timezone').append(new Option(localZone,localZone));
const savedZone=localStorage.getItem('journal-timezone');
if([...$('journal-timezone').options].some(option=>option.value===savedZone))$('journal-timezone').value=savedZone;
function journalDate(ms){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:$('journal-timezone').value,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
}
let journalMonth=journalDate(Date.now()).slice(0,7);
const journalCurrency=()=>journalModel.accounts.find(account=>account.id===journalModel.account)?.currency||'';
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
function allowJournalSwitch(){if(!journalDirty)return true;if(persistDraftLocally()||draftIsSafe()){flushJournalDraft();return true;}return confirm('Could not preserve this draft locally. Discard changes? Choose Cancel to save them first.');}
function showJournalView(view){
  if(view==='calendar'&&journalView!=='calendar'){
    if(!allowJournalSwitch())return;
    clearJournalSelection();
  }
  snapshotReplay();
  journalView=view;
  try{localStorage.setItem('tradetrace.last-view',view);}catch(_){/* Navigation remains available. */}
  $('terminal-pane').hidden=view!=='terminal';
  $('journal-pane').hidden=view==='replay'||view==='terminal';$('replay-pane').hidden=view!=='replay';$('calendar-panel').hidden=view!=='calendar';
  for(const name of ['journal','calendar','replay','terminal'])$('nav-'+name).classList.toggle('selected',name===view);
  placeReplay();
  if(view!=='replay'&&$('journal-inline-replay').hidden)pause();
  renderJournal();updateReplayActions();
  if(['journal','calendar'].includes(view))refreshJournal(journalModel.account).catch(error=>status(error.message));
}
for(const view of ['journal','calendar','replay','terminal'])$('nav-'+view).onclick=()=>showJournalView(view);
function updateReplayActions(){
  placeReplay();
  $('journal-replay').disabled=!journalPosition||busy;
  $('journal-capture-exit').disabled=!journalPosition||busy;
  const account=journalModel.accounts.find(row=>row.id===journalModel.account);
  const snapshot=window.journalChartSnapshot;
  const live=replayMatchesJournal()&&$('chart').getBoundingClientRect().width>0;
  $('journal-capture').disabled=!live&&(!snapshot||snapshot.position!==journalPosition||!account||account.login!==snapshot.account?.account||account.server!==snapshot.account?.server);
}
async function refreshJournal(account){
  const result=await api('journal/overview',account?{account}:{});
  const changed=result.account!==journalModel.account;
  journalModel=result;renderJournalConditionEntries();
  $('journal-account').replaceChildren();
  if(!result.accounts.length)$('journal-account').append(new Option('No synced accounts yet',''));
  for(const row of result.accounts)$('journal-account').append(new Option(`${row.server} · ${row.login} · ${row.currency}`,row.id));
  $('journal-account').value=result.account||'';
  $('journal-context').textContent=result.accounts.length?'Saved locally · '+journalCurrency()+' · supported closed positions synced from MT5. Other accounts are kept separate.':'Connect MT5 to sync trades. Reviews, calendar and screenshots stay available after MT5 closes.';
  if(changed)clearJournalSelection();
  renderJournal();updateReplayActions();
}
function filteredTrades(){
  const search=$('journal-search').value.trim().toLowerCase(), filter=$('journal-filter').value;
  return journalModel.trades.filter(trade=>{
    const review=trade.review||{};
    if(filter==='reviewed'&&!review.reviewed||filter==='unreviewed'&&review.reviewed)return false;
    if(search&&![trade.symbol,trade.side,trade.id,review.notes,review.lesson,...(review.tags||[])].join(' ').toLowerCase().includes(search))return false;
    return journalView!=='calendar'||journalDate(trade.end).slice(0,7)===journalMonth;
  });
}
function renderSetupPerformance(){
  const host=$('journal-setup-performance-table'),rows=journalModel.setup_performance||[];host.replaceChildren();
  if(!rows.length){host.append(element('p','No linked closed setup trades yet.'));return;}
  const table=element('table'),head=element('tr');for(const title of ['Setup','Entry','Trades','Win rate','Net P/L','Total R','Avg R','R sample'])head.append(element('th',title));const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
  for(const row of rows){const tr=element('tr');for(const value of [row.family,({MARKET:'Market',RETEST:'Retest limit',CONFIRM:'Retest + confirmation'})[row.entry]||row.entry,row.trades,row.win_rate.toFixed(1)+'%',money(row.net,journalCurrency()),row.r_count?row.total_r.toFixed(2):'—',row.average_r!==null?row.average_r.toFixed(2):'—',row.r_count+' / '+row.trades])tr.append(element('td',String(value)));body.append(tr);}table.append(body);host.append(table);
}
function renderJournal(){
  renderSetupPerformance();
  const trades=filteredTrades(), wins=trades.filter(t=>t.net>0).length, losses=trades.filter(t=>t.net<0);
  const net=trades.reduce((sum,t)=>sum+t.net,0), grossWin=trades.reduce((sum,t)=>sum+Math.max(0,t.net),0), grossLoss=-losses.reduce((sum,t)=>sum+t.net,0);
  if(journalModel.accounts.length)$('journal-context').textContent=(journalView==='calendar'?'Month '+journalMonth:'Saved trade history')+' · '+journalCurrency()+' · exit dates in '+$('journal-timezone').value+' · filters apply to these statistics. Accounts stay separate.';
  const stats=[['Net P&L',money(net,journalCurrency()),outcome(net).style],['Trades',String(trades.length)],['Win rate',trades.length?(100*wins/trades.length).toFixed(1)+'%':'—'],['Profit factor',grossLoss?(grossWin/grossLoss).toFixed(2):grossWin?'No losses':'—'],['Average trade',trades.length?money(net/trades.length,journalCurrency()):'—'],['Reviewed',`${trades.filter(t=>t.review?.reviewed).length} / ${trades.length}`]];
  $('journal-stats').replaceChildren(...stats.map(([label,value,color])=>{const card=element('div',undefined,'journal-stat');card.append(element('span',label),element('strong',value,color));return card;}));
  renderCalendar(trades);
  const shown=journalDay&&journalView==='calendar'?trades.filter(t=>journalDate(t.end)===journalDay):trades;
  $('journal-list-title').textContent=(journalDay&&journalView==='calendar'?journalDay:'Saved trades')+` · ${shown.length}`;
  $('journal-trades').replaceChildren();
  if(!shown.length)$('journal-trades').append(element('p',journalModel.trades.length?'No trades match these filters.':'No saved trades yet. Connect MT5 and load your history.','journal-hint'));
  for(const trade of shown){
    const result=outcome(trade.net),button=element('button',undefined,'journal-row '+(journalPosition===trade.id?'active':''));
    let hasDraft=trade.has_draft;try{hasDraft=hasDraft||Boolean(localStorage.getItem(draftKey(journalModel.account,trade.id)));}catch(_){}
    button.append(element('strong',`${trade.symbol} · ${trade.side}`),element('span',money(trade.net,trade.currency),result.style),element('small',`${journalDate(trade.end)} · ${hasDraft?'Draft':trade.review?.reviewed?'Reviewed':'Needs review'}`));
    if(trade.review?.tags?.length)button.append(element('small',trade.review.tags.join(' · '),'setup-tags'));
    button.onclick=()=>openJournalTrade(trade.id);$('journal-trades').append(button);
  }
}
function renderCalendar(trades){
  const [year,month]=journalMonth.split('-').map(Number),first=new Date(Date.UTC(year,month-1,1));
  $('calendar-title').textContent=first.toLocaleDateString('en-US',{year:'numeric',month:'long',timeZone:'UTC'});
  $('clear-day').hidden=!journalDay;
  const daily=new Map();
  for(const trade of trades){const key=journalDate(trade.end),day=daily.get(key)||{count:0,net:0};day.count++;day.net+=trade.net;daily.set(key,day);}
  const grid=$('journal-calendar');grid.replaceChildren();
  for(let pad=0;pad<(first.getUTCDay()+6)%7;pad++)grid.append(element('div',undefined,'calendar-blank'));
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  for(let day=1;day<=days;day++){
    const key=journalMonth+'-'+String(day).padStart(2,'0'),summary=daily.get(key);
    const button=element('button',undefined,'calendar-day '+(summary?outcome(summary.net).style:'')+(journalDay===key?' selected':'')+(journalDate(Date.now())===key?' today':''));
    button.append(element('span',String(day),'day-number'));
    if(summary){button.append(element('strong',money(summary.net,'')),element('small',summary.count+(summary.count===1?' trade':' trades')));}
    button.setAttribute('aria-label',key+(summary?`, ${summary.count} trades, ${money(summary.net,journalCurrency())}`:', no trades'));
    button.onclick=()=>changeCalendarScope(()=>{journalDay=journalDay===key?null:key;});grid.append(button);
  }
}
async function openJournalTrade(position){
  if(!allowJournalSwitch())return;
  const request=++journalRequest,account=journalModel.account;
  try{
    const entry=await api('journal/entry',{account,position});
    if(request!==journalRequest||account!==journalModel.account)return;
    if(position!==journalPosition)closeInlineReplay();
    journalPosition=position;journalDirty=false;journalRevision=0;
    $('journal-replay-status').textContent='';
    journalSavedVersion=entry.updated||null;
    let draft=entry.draft&&entry.draft.base_updated===journalSavedVersion?entry.draft:null;
    try{const local=JSON.parse(localStorage.getItem(draftKey(account,position)));if(local?.base_updated===journalSavedVersion&&typeof local.review?.notes==='string'&&(!draft||local.updated>draft.updated))draft=local;}catch(_){}
    renderConditionEntryCards($('journal-trade-condition-entries').querySelector('div'),entry.condition_entries||[]);$('journal-trade-condition-entries').hidden=!entry.condition_entries?.length;
    const trade=entry.trade,review=draft?draft.review:entry.review||{};
    $('journal-empty').hidden=true;$('journal-form').hidden=false;
    $('journal-title').textContent=`${trade.symbol} / ${trade.side}`;
    $('journal-trade-details').textContent=`#${trade.id} · ${trade.volume} lots · ${journalDate(trade.end)} · Exit: ${trade.reason}`;
    $('journal-pnl').textContent=money(trade.net,trade.currency);$('journal-pnl').className=outcome(trade.net).style;
    $('journal-trade-levels').textContent=`Entry ${fmt(trade.entry)} → Exit ${fmt(trade.exit)} · SL ${trade.sl?fmt(trade.sl):'not saved'} · TP ${trade.tp?fmt(trade.tp):'not saved'}`;
    $('journal-tags').value=(review.tags||[]).join(', ');$('journal-notes').value=review.notes||'';$('journal-lesson').value=review.lesson||'';
    $('journal-rating').value=review.rating||0;$('journal-reviewed').checked=Boolean(review.reviewed);
    for(const key of ['planned','risk','entry','exit'])$('review-'+key).checked=Boolean(review.checks?.[key]);
    journalDirty=Boolean(draft);
    $('journal-save-status').textContent=draft?'Draft restored · click Save review to finalize':entry.updated?'Saved '+new Date(entry.updated).toLocaleString():'No review saved yet';
    if(draft){persistDraftLocally();draftTimer=setTimeout(flushJournalDraft,800);}
    renderJournal();updateReplayActions();await renderJournalImages(entry.images,account,position);
  }catch(error){status(error.message);}
}
$('journal-form').addEventListener('input',event=>{if(event.target.id==='journal-upload'||replayPlayer.contains(event.target))return;journalDirty=true;journalRevision++;$('journal-save-status').textContent=persistDraftLocally()?'Saving draft…':'Saving draft to journal…';clearTimeout(draftTimer);draftTimer=setTimeout(flushJournalDraft,800);});
$('journal-form').onsubmit=async event=>{
  event.preventDefault();if(journalSaving||!journalPosition)return;
  journalSaving=true;$('journal-save').disabled=true;
  const account=journalModel.account,position=journalPosition,revision=journalRevision;
  const review=reviewFromForm();clearTimeout(draftTimer);draftPending.delete(draftKey(account,position));
  try{
    const result=await api('journal/save',{account,position,review});
    if(account===journalModel.account&&position===journalPosition){journalSavedVersion=result.updated;journalDirty=journalRevision!==revision;if(!journalDirty)localStorage.removeItem(draftKey(account,position));else persistDraftLocally();$('journal-save-status').textContent=journalDirty?'Saved previous version · saving new draft…':'Saved '+new Date(result.updated).toLocaleTimeString();}
    if(account===journalModel.account)await refreshJournal(account);
  }catch(error){$('journal-save-status').textContent=error.message;}
  finally{journalSaving=false;$('journal-save').disabled=false;if(journalDirty)draftTimer=setTimeout(flushJournalDraft,800);}
};
async function renderJournalImages(images,account,position){
  if($('screenshot-viewer').open)$('screenshot-viewer').close();
  for(const url of journalImageUrls)URL.revokeObjectURL(url);journalImageUrls=[];$('journal-images').replaceChildren();
  for(const attachment of images){
    const result=await api('journal/image',{account,id:attachment.id});
    if(account!==journalModel.account||position!==journalPosition)return;
    const bytes=Uint8Array.from(atob(result.data),character=>character.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:result.mime}));journalImageUrls.push(url);
    const figure=element('figure'),image=element('img');image.src=url;image.alt=attachment.name;
    const link=element('button',undefined,'screenshot-thumbnail');link.type='button';link.setAttribute('aria-label','Enlarge '+attachment.name);link.append(image);
    link.onclick=()=>openScreenshot(url,attachment.name);
    const remove=element('button','Remove');remove.type='button';remove.onclick=async()=>{
      if(!confirm('Remove this screenshot from your journal?'))return;
      try{await api('journal/remove-image',{account,id:attachment.id});figure.remove();}catch(error){status(error.message);}
    };
    figure.append(link,element('figcaption',attachment.name),remove);$('journal-images').append(figure);
  }
}
async function attachJournalImage(name,encoded,target=null){
  if(!target&&!journalPosition)return;
  const account=target?target.account:journalModel.account,position=target?target.position:journalPosition;
  await api('journal/attach',{account,position,name,data:encoded});
  if(account===journalModel.account&&position===journalPosition){const entry=await api('journal/entry',{account,position});await renderJournalImages(entry.images,account,position);}
}
let screenshotQueue=Promise.resolve();
function uploadScreenshotFiles(files){
  if(!journalPosition)return;
  const target={account:journalModel.account,position:journalPosition},batch=Array.from(files);
  screenshotQueue=screenshotQueue.then(async()=>{
    let saved=0;const failures=[];
    const current=()=>target.account===journalModel.account&&target.position===journalPosition;
    if(current())$('journal-upload-status').textContent='Saving screenshots…';
    for(const file of batch){
      try{
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)&&!(file.type===''&&/\.(png|jpe?g|webp)$/i.test(file.name)))throw Error('Use PNG, JPEG or WebP images.');
        if(file.size>3*1024*1024)throw Error('Each screenshot must be smaller than 3 MB.');
        const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Could not read image.'));reader.readAsDataURL(file);});
        await attachJournalImage(file.name||'Clipboard image.png',encoded,target);saved++;
      }catch(error){failures.push(error.message);}
    }
    if(current())$('journal-upload-status').textContent=(saved?`${saved} screenshot${saved===1?'':'s'} saved. `:'')+[...new Set(failures)].join(' ');
  }).catch(error=>status(error.message));
}
$('journal-upload').onchange=()=>{uploadScreenshotFiles($('journal-upload').files);$('journal-upload').value='';};
let screenshotDragDepth=0;
$('journal-dropzone').addEventListener('dragenter',event=>{if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;event.preventDefault();screenshotDragDepth++;$('journal-dropzone').classList.add('drag-over');});
$('journal-dropzone').addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
$('journal-dropzone').addEventListener('dragleave',event=>{event.preventDefault();screenshotDragDepth=Math.max(0,screenshotDragDepth-1);if(!screenshotDragDepth)$('journal-dropzone').classList.remove('drag-over');});
$('journal-dropzone').addEventListener('drop',event=>{event.preventDefault();screenshotDragDepth=0;$('journal-dropzone').classList.remove('drag-over');uploadScreenshotFiles(event.dataTransfer.files);});
$('journal-dropzone').addEventListener('keydown',event=>{if(event.target===$('journal-dropzone')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();$('journal-upload').click();}});
document.addEventListener('paste',event=>{
  if(!journalPosition||$('journal-form').hidden||$('journal-pane').hidden||$('screenshot-viewer').open)return;
  if(document.activeElement!==document.body&&!$('journal-form').contains(document.activeElement))return;
  const images=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
  if(images.length){event.preventDefault();uploadScreenshotFiles(images);}
});
$('journal-capture').onclick=async()=>{try{snapshotReplay();updateReplayActions();if($('journal-capture').disabled)return;const snapshot=window.journalChartSnapshot;await attachJournalImage('Replay chart · '+stamp(snapshot.clock),snapshot.image.split(',')[1]);status('Replay chart saved to this trade.');}catch(error){status(error.message);}};
async function ensureJournalReplay(){
  const position=journalPosition,sourceAccount=journalModel.account;
  if(!position)return false;
  if(!connected){
    $('journal-replay-status').textContent='Connecting to your running MT5…';
    const result=await api('connect-all',{path:$('path').value||$('terminals').value,url:$('native-url').value.trim(),key:$('native-key').value});
    showAccount(result);
    directConnected=['active','connected'].includes(result.native.state);
    if('key_saved' in result.native)keyState(result.native.key_saved);
    applyLevels(result.native);
    if(directConnected)$('native-key').value='';
    if(position!==journalPosition||sourceAccount!==journalModel.account)return false;
  }
  const account=journalModel.accounts.find(row=>row.id===journalModel.account);
  if(!account||account.login!==window.journalConnectedAccount?.account||account.server!==window.journalConnectedAccount?.server)throw Error('Connect MT5 to this journal account to replay its trades.');
  $('journal-replay-status').textContent='Loading historical prices…';
  if(!replayMatchesJournal()){
    const response=await api('replay',{id:position,context_minutes:historyRequest(),candle_timeframe:$('candle-timeframe').value,after_minutes:Number($('after-minutes').value)});
    if(position!==journalPosition||sourceAccount!==journalModel.account)return false;
    setData(response);
  }
  return true;
}
$('journal-replay').onclick=()=>task(async()=>{
  try {
  if(inlineReplay&&!$('journal-inline-replay').hidden){closeInlineReplay();return;}
  if(!await ensureJournalReplay())return;
  inlineReplay=true;placeReplay();updateReplayActions();
  $('journal-replay-status').textContent='';
  status('Replay ready below. You can play the trade and write your review on this page.');
  } catch(error) {
    $('journal-replay-status').textContent=error.message;
    throw error;
  }
});
$('journal-capture-exit').onclick=()=>task(async()=>{
  try {
    if(!await ensureJournalReplay())return;
    const chart=document.createElement('canvas');
    draw({canvas:chart,width:1400,height:520,time:data.trade.end,end:data.trade.end,index:data.points.length-1});
    const screenshot=document.createElement('canvas');screenshot.width=1400;screenshot.height=630;
    const ctx=screenshot.getContext('2d'),trade=data.trade;
    ctx.fillStyle='#0e1725';ctx.fillRect(0,0,1400,630);ctx.fillStyle='#e8eef8';ctx.font='bold 23px Segoe UI';
    ctx.fillText(`${trade.symbol} / ${trade.side} · Position #${trade.id}`,22,36);
    ctx.fillStyle=trade.net<0?'#f18d9b':'#70e4c2';ctx.font='bold 21px Segoe UI';ctx.textAlign='right';
    ctx.fillText(`${outcome(trade.net).label} · ${money(trade.net,trade.currency||currency)}`,1378,36);ctx.textAlign='left';
    ctx.fillStyle='#94a5bd';ctx.font='13px Segoe UI';ctx.fillText(`EXIT SNAPSHOT · ${stamp(trade.end)} · ${trade.reason} · Fill ${fmt(trade.exit)}`,22,66);
    ctx.drawImage(chart,0,85);ctx.fillStyle='#94a5bd';ctx.fillText('Recorded historical quotes and execution fill. SL/TP are recorded reference levels; quote coverage may have gaps.',22,618);
    await attachJournalImage('Exit replay chart · '+stamp(trade.end),screenshot.toDataURL('image/png').split(',')[1]);
    $('journal-replay-status').textContent='Exit chart saved. Your replay position has not changed.';
    status('Exit replay chart saved to this trade.');
  }catch(error){$('journal-replay-status').textContent=error.message;throw error;}
});
function openScreenshot(url,name){
  $('screenshot-title').textContent=name;$('screenshot-full').src=url;$('screenshot-full').alt=name;
  $('screenshot-viewport').classList.remove('actual-size');$('screenshot-zoom').textContent='Actual size';
  $('screenshot-viewer').showModal();
}
function toggleScreenshotZoom(){const zoomed=$('screenshot-viewport').classList.toggle('actual-size');$('screenshot-zoom').textContent=zoomed?'Fit to window':'Actual size';}
$('screenshot-zoom').onclick=toggleScreenshotZoom;$('screenshot-full').onclick=toggleScreenshotZoom;
$('screenshot-close').onclick=()=>$('screenshot-viewer').close();
$('screenshot-viewer').addEventListener('click',event=>{if(event.target===$('screenshot-viewer')){const rect=$('screenshot-viewer').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('screenshot-viewer').close();}});
$('screenshot-viewer').addEventListener('close',()=>{$('screenshot-full').removeAttribute('src');});
$('journal-account').onchange=async()=>{if(!allowJournalSwitch()){$('journal-account').value=journalModel.account;return;}journalDay=null;try{await refreshJournal($('journal-account').value);}catch(error){status(error.message);}};
$('journal-refresh').onclick=()=>refreshJournal(journalModel.account).catch(error=>status(error.message));
for(const name of ['journal-search','journal-filter'])$(name).addEventListener('input',()=>renderJournal());
let journalTimezone=$('journal-timezone').value;
$('journal-timezone').onchange=()=>{
  const next=$('journal-timezone').value;
  if(!changeCalendarScope(()=>{journalDay=null;localStorage.setItem('journal-timezone',next);journalTimezone=next;}))$('journal-timezone').value=journalTimezone;
};
function shiftMonth(offset){changeCalendarScope(()=>{const [year,month]=journalMonth.split('-').map(Number);journalMonth=new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,7);journalDay=null;});}
$('month-prev').onclick=()=>shiftMonth(-1);$('month-next').onclick=()=>shiftMonth(1);$('month-today').onclick=()=>changeCalendarScope(()=>{journalMonth=journalDate(Date.now()).slice(0,7);journalDay=null;});$('clear-day').onclick=()=>changeCalendarScope(()=>{journalDay=null;});
$('journal-backup').onclick=async()=>{
  try{
    const response=await fetch('/api/journal/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Replay-Token':document.querySelector('meta[name=replay-token]').content},body:'{}'});
    if(!response.ok)throw Error('Could not create journal backup.');
    const url=URL.createObjectURL(await response.blob()),link=element('a');link.href=url;link.download='MT5-Journal-'+new Date().toISOString().slice(0,10)+'.sqlite3';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Journal backup downloaded. It includes reviews and screenshots, not your API key.');
  }catch(error){status(error.message);}
};
window.addEventListener('beforeunload',event=>{if(journalDirty&&!persistDraftLocally()&&!draftIsSafe()){event.preventDefault();event.returnValue='';}});
refreshJournal().catch(error=>status(error.message));

window.addEventListener('DOMContentLoaded',()=>{
  try{const savedView=localStorage.getItem('tradetrace.last-view')||(localStorage.getItem('tradetrace.terminal.v2')?'terminal':'journal');if(['journal','calendar','replay','terminal'].includes(savedView))showJournalView(savedView);}catch(_){/* Keep the initial journal view. */}
});

function conditionEntryCard(item){
  const card=element('details'),result=item.result||{},request=item.request||{},setup=item.setup||{},plan=setup.automatic_plan;
  card.className='journal-setup-card';
  const number=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString(undefined,{maximumFractionDigits:8}):'Not recorded';
  const money=value=>Number.isFinite(Number(value))&&value!==null&&value!==undefined?Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'Not recorded';
  const when=value=>value?new Date(value).toLocaleString():'Not recorded';
  const side=setup.settings?.ticket?.side||([0,2,4].includes(request.type)?'BUY':'SELL'),kind=({2:'LIMIT',3:'LIMIT',4:'STOP',5:'STOP'})[request.type]||'MARKET';
  const accepted=[10008,10009,10010].includes(result.retcode),filled=accepted&&Number(result.deal)>0;
  const status=!accepted?'Broker result: '+(result.comment||result.retcode||'unknown'):filled?'Entry execution reported':result.operation==='pending'?'Pending order accepted · fill not confirmed':'Order accepted · check MT5';
  const summary=element('summary'),heading=element('span');heading.className='journal-setup-heading';heading.append(element('strong',`${request.symbol||'Unknown symbol'} · ${side} ${kind}`),element('span',`${item.demo?'DEMO':'LIVE'} · ${status}`));summary.append(heading);card.append(summary);
  if(setup.name)card.append(element('h4',setup.name));
  const metrics=element('dl');metrics.className='journal-setup-metrics';
  const metric=(label,value)=>{const box=element('div');box.append(element('dt',label),element('dd',value));metrics.append(box);};
  metric(filled?'Reported entry':'Requested entry',number(filled?result.price:request.price));metric('Stop loss',request.sl?number(request.sl):'Not set');metric('Take profit',request.tp?number(request.tp):'Not set');metric('Lots',number(filled?result.volume:request.volume));
  metric('Equity risk',plan?number(plan.risk_percent)+'%':setup.settings?.autoPlan?.enabled?number(setup.settings.autoPlan.risk)+'%':setup.settings?.sizing==='AUTO'?'2%':'Fixed lots');
  if(plan){metric('Modeled risk',money(plan.modeled_loss)+' '+(plan.currency||''));metric('Modeled reward',money(plan.modeled_reward)+' '+(plan.currency||''));metric('Planned reward / risk',number(plan.rr)+'R');}
  card.append(metrics);
  card.append(element('h4',filled?'Why this entry opened':'Entry conditions'));
  const list=element('ol');list.className='journal-setup-conditions';
  for(const row of setup.rows||[]){const label=window.TerminalConditions?.rules[row.rule]||row.rule;const li=element('li');li.append(element('strong',label),element('span',row.mode==='LIVE'?'Live Bid':row.timeframe+' candle close'));if(window.TerminalConditions?.structure(row.rule))li.append(element('span',`${row.sensitivity} candle${row.sensitivity===1?'':'s'} each side confirm the swing`));else li.append(element('span',window.TerminalConditions?.zone(row.rule)?number(row.low)+' – '+number(row.high):'Level '+number(row.level)));list.append(li);}card.append(list);
  if(!(setup.rows||[]).length)card.append(element('p','No conditions recorded. An empty sequence acts immediately.'));
  if(setup.invalidation?.enabled){const g=setup.invalidation;const note=element('p',`Setup cancellation: Bid ${g.direction==='BELOW'?'at or below':'at or above'} ${number(g.level)}. Frozen when monitoring started; this did not protect the open position.`);note.className='journal-setup-note';card.append(note);}
  const observations=setup.observations||[];
  card.append(element('h4','Entry timeline'));
  const timeline=element('ol');timeline.className='journal-setup-timeline';
  const addEvent=(title,time,description)=>{const row=element('li');row.append(element('strong',title),element('time',when(time)));if(description)row.append(element('span',description));timeline.append(row);};
  addEvent('Monitoring started',setup.started,setup.action==='AUTO'?'Automatic entry armed':setup.action==='REVIEW'?'Order required manual confirmation':'Condition entry');
  for(const event of observations)addEvent(event.type==='reset'?'Conditions reset':event.type==='retest_confirmed'?'Retest confirmed':'Step '+(event.index+1)+' passed',event.observed_at,event.type==='reset'?event.reason:event.structure?`${event.structure.type} confirmed at ${number(event.structure.level)} · Bid ${number(event.bid)}`:'Bid '+number(event.bid));
  addEvent(status,item.created,'Order '+(result.order||'not recorded'));card.append(timeline);
  const technical=element('details');technical.className='journal-setup-technical';technical.append(element('summary','Broker & technical details'));
  const info=element('dl');info.className='journal-setup-technical-fields';
  for(const [label,value] of [['Order ID',result.order],['Deal ID',result.deal],['Broker response',`${result.retcode??'Unknown'} · ${result.comment||''}`],['Requested entry',number(request.price)],['Requested lots',number(request.volume)],['Reported entry',number(result.price)],['Reported lots',number(result.volume)],['Sequence timeout',`${setup.settings?.timeout??'Not recorded'} minutes`],['Reset after quote gap',`${setup.settings?.gap??'Not recorded'} seconds`]])info.append(element('dt',label),element('dd',String(value??'Not recorded')));
  if(plan){info.append(element('dt','Stop placement'),element('dd',plan.stop_basis==='SIGNAL'?'Beyond confirmed swing and signal candle':'Confirmed swing'));if(plan.hold_breakout)info.append(element('dt','Breakout holding check'),element('dd','Required at order submission · level '+number(plan.breakout_level)));info.append(element('dt','Risk budget'),element('dd',money(plan.budget)+' '+(plan.currency||'')));info.append(element('dt','Stop swing / buffer'),element('dd',`${number(plan.stop_swing?.price)} / ${plan.buffer_ticks} broker ticks`));if(plan.expires_at)info.append(element('dt','Pending expiry'),element('dd',when(plan.expires_at*1000)));}
  if(setup.entry_quality_result){const q=setup.entry_quality_result;info.append(element('dt','Entry quality passed'),element('dd',`Distance ${number(q.distance)} / maximum ${number(q.max_distance)} · RR ${number(q.rr)} / minimum ${number(q.min_rr)}`));}
  technical.append(info);
  for(const event of observations)if(event.candle){const c=event.candle;technical.append(element('p',`${when(c.time*1000)} · Open ${number(c.open)} · High ${number(c.high)} · Low ${number(c.low)} · Close ${number(c.close)}`));}
  for(const event of observations)if(event.structure?.swing_time)technical.append(element('p','Confirmed swing time: '+when(event.structure.swing_time*1000)));
  technical.append(element('p','Modeled risk and reward exclude costs and slippage. Entry execution is separate from the final trade result.'));card.append(technical);
  if(item.position){const button=element('button',`Open linked trade #${item.position}`);button.type='button';button.onclick=()=>openJournalTrade(item.position);card.append(button);}
  return card;
}
function renderConditionEntryCards(node,entries){const cards=entries.map(conditionEntryCard);if(node.closest('#journal-trade-condition-entries'))for(const card of cards)card.open=true;node.replaceChildren(...cards);}
function renderJournalConditionEntries(){
  const entries=journalModel.condition_entries||[];$('journal-condition-count').textContent=entries.length;
  renderConditionEntryCards($('journal-condition-entries'),entries);
  if(!entries.length)$('journal-condition-entries').append(element('p','No condition entries recorded for this account yet.'));
}
