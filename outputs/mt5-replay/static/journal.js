let journalModel={accounts:[],account:null,trades:[]}, journalPosition=null, journalDirty=false;
let journalView='journal', journalDay=null, journalRequest=0, journalSaving=false;
let journalImageUrls=[];
let journalRevision=0;
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
function allowJournalSwitch(){return !journalDirty||confirm('Discard unsaved review changes? Choose Cancel to save them first.');}
function showJournalView(view){
  if(journalView==='replay'&&view!=='replay'&&data&&$('chart').width>0&&$('chart').getBoundingClientRect().width>0){
    window.journalChartSnapshot={position:data.trade.id,account:window.journalConnectedAccount,clock,image:$('chart').toDataURL('image/png')};
  }
  journalView=view;
  $('journal-pane').hidden=view==='replay';$('replay-pane').hidden=view!=='replay';$('calendar-panel').hidden=view!=='calendar';
  for(const name of ['journal','calendar','replay'])$('nav-'+name).classList.toggle('selected',name===view);
  renderJournal();updateReplayActions();
}
for(const view of ['journal','calendar','replay'])$('nav-'+view).onclick=()=>showJournalView(view);
function updateReplayActions(){
  $('journal-replay').disabled=!connected||!journalPosition;
  const account=journalModel.accounts.find(row=>row.id===journalModel.account);
  const snapshot=window.journalChartSnapshot;
  $('journal-capture').disabled=!snapshot||snapshot.position!==journalPosition||!account||account.login!==snapshot.account?.account||account.server!==snapshot.account?.server;
}
async function refreshJournal(account){
  const result=await api('journal/overview',account?{account}:{});
  const changed=result.account!==journalModel.account;
  journalModel=result;
  $('journal-account').replaceChildren();
  if(!result.accounts.length)$('journal-account').append(new Option('No synced accounts yet',''));
  for(const row of result.accounts)$('journal-account').append(new Option(`${row.server} · ${row.login} · ${row.currency}`,row.id));
  $('journal-account').value=result.account||'';
  $('journal-context').textContent=result.accounts.length?'Saved locally · '+journalCurrency()+' · supported closed positions synced from MT5. Other accounts are kept separate.':'Connect MT5 to sync trades. Reviews, calendar and screenshots stay available after MT5 closes.';
  if(changed){journalPosition=null;journalDirty=false;$('journal-form').hidden=true;$('journal-empty').hidden=false;}
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
function renderJournal(){
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
    button.append(element('strong',`${trade.symbol} · ${trade.side}`),element('span',money(trade.net,trade.currency),result.style),element('small',`${journalDate(trade.end)} · ${trade.review?.reviewed?'Reviewed':'Needs review'}`));
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
    button.onclick=()=>{journalDay=journalDay===key?null:key;renderJournal();};grid.append(button);
  }
}
async function openJournalTrade(position){
  if(!allowJournalSwitch())return;
  const request=++journalRequest,account=journalModel.account;
  try{
    const entry=await api('journal/entry',{account,position});
    if(request!==journalRequest||account!==journalModel.account)return;
    journalPosition=position;journalDirty=false;journalRevision=0;
    const trade=entry.trade,review=entry.review||{};
    $('journal-empty').hidden=true;$('journal-form').hidden=false;
    $('journal-title').textContent=`${trade.symbol} / ${trade.side}`;
    $('journal-trade-details').textContent=`#${trade.id} · ${trade.volume} lots · ${journalDate(trade.end)} · Exit: ${trade.reason}`;
    $('journal-pnl').textContent=money(trade.net,trade.currency);$('journal-pnl').className=outcome(trade.net).style;
    $('journal-trade-levels').textContent=`Entry ${fmt(trade.entry)} → Exit ${fmt(trade.exit)} · SL ${trade.sl?fmt(trade.sl):'not saved'} · TP ${trade.tp?fmt(trade.tp):'not saved'}`;
    $('journal-tags').value=(review.tags||[]).join(', ');$('journal-notes').value=review.notes||'';$('journal-lesson').value=review.lesson||'';
    $('journal-rating').value=review.rating||0;$('journal-reviewed').checked=Boolean(review.reviewed);
    for(const key of ['planned','risk','entry','exit'])$('review-'+key).checked=Boolean(review.checks?.[key]);
    $('journal-save-status').textContent=entry.updated?'Saved '+new Date(entry.updated).toLocaleString():'No review saved yet';
    renderJournal();updateReplayActions();await renderJournalImages(entry.images,account,position);
  }catch(error){status(error.message);}
}
$('journal-form').addEventListener('input',event=>{if(event.target.id==='journal-upload')return;journalDirty=true;journalRevision++;$('journal-save-status').textContent='Unsaved changes';});
$('journal-form').onsubmit=async event=>{
  event.preventDefault();if(journalSaving||!journalPosition)return;
  journalSaving=true;$('journal-save').disabled=true;
  const account=journalModel.account,position=journalPosition,revision=journalRevision;
  const review={notes:$('journal-notes').value,lesson:$('journal-lesson').value,tags:$('journal-tags').value.split(',').map(t=>t.trim()).filter(Boolean),rating:Number($('journal-rating').value),reviewed:$('journal-reviewed').checked,checks:{}};
  for(const key of ['planned','risk','entry','exit'])review.checks[key]=$('review-'+key).checked;
  try{
    const result=await api('journal/save',{account,position,review});
    if(account===journalModel.account&&position===journalPosition){journalDirty=journalRevision!==revision;$('journal-save-status').textContent=journalDirty?'Saved previous version · new changes are unsaved':'Saved '+new Date(result.updated).toLocaleTimeString();}
    if(account===journalModel.account)await refreshJournal(account);
  }catch(error){$('journal-save-status').textContent=error.message;}
  finally{journalSaving=false;$('journal-save').disabled=false;}
};
async function renderJournalImages(images,account,position){
  for(const url of journalImageUrls)URL.revokeObjectURL(url);journalImageUrls=[];$('journal-images').replaceChildren();
  for(const attachment of images){
    const result=await api('journal/image',{account,id:attachment.id});
    if(account!==journalModel.account||position!==journalPosition)return;
    const bytes=Uint8Array.from(atob(result.data),character=>character.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:result.mime}));journalImageUrls.push(url);
    const figure=element('figure'),image=element('img');image.src=url;image.alt=attachment.name;
    const link=element('a');link.href=url;link.target='_blank';link.rel='noopener';link.append(image);
    const remove=element('button','Remove');remove.type='button';remove.onclick=async()=>{
      if(!confirm('Remove this screenshot from your journal?'))return;
      try{await api('journal/remove-image',{account,id:attachment.id});figure.remove();}catch(error){status(error.message);}
    };
    figure.append(link,element('figcaption',attachment.name),remove);$('journal-images').append(figure);
  }
}
async function attachJournalImage(name,encoded){
  if(!journalPosition)return;
  const account=journalModel.account,position=journalPosition;
  await api('journal/attach',{account,position,name,data:encoded});
  if(account===journalModel.account&&position===journalPosition){const entry=await api('journal/entry',{account,position});await renderJournalImages(entry.images,account,position);}
}
$('journal-upload').onchange=async()=>{
  const file=$('journal-upload').files[0];if(!file)return;
  try{
    if(file.size>3*1024*1024)throw Error('Choose a screenshot smaller than 3 MB.');
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
    await attachJournalImage(file.name,encoded);status('Screenshot saved to your journal.');
  }catch(error){status(error.message);}finally{$('journal-upload').value='';}
};
$('journal-capture').onclick=async()=>{try{updateReplayActions();if($('journal-capture').disabled)return;const snapshot=window.journalChartSnapshot;await attachJournalImage('Replay chart · '+stamp(snapshot.clock),snapshot.image.split(',')[1]);status('Replay chart saved to this trade.');}catch(error){status(error.message);}};
$('journal-replay').onclick=()=>task(async()=>{
  const account=journalModel.accounts.find(row=>row.id===journalModel.account);
  if(!account||account.login!==window.journalConnectedAccount?.account||account.server!==window.journalConnectedAccount?.server)throw Error('Connect MT5 to this journal account to replay its trades.');
  const response=await api('replay',{id:journalPosition,context_minutes:Number($('context-minutes').value)});
  setData(response);showJournalView('replay');status('Replay loaded. Your review is kept in the Journal tab.');
});
$('journal-account').onchange=async()=>{if(!allowJournalSwitch()){$('journal-account').value=journalModel.account;return;}journalDay=null;try{await refreshJournal($('journal-account').value);}catch(error){status(error.message);}};
$('journal-refresh').onclick=()=>refreshJournal(journalModel.account).catch(error=>status(error.message));
for(const name of ['journal-search','journal-filter'])$(name).addEventListener('input',()=>renderJournal());
$('journal-timezone').onchange=()=>{localStorage.setItem('journal-timezone',$('journal-timezone').value);journalDay=null;renderJournal();};
function shiftMonth(offset){const [year,month]=journalMonth.split('-').map(Number);journalMonth=new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,7);journalDay=null;renderJournal();}
$('month-prev').onclick=()=>shiftMonth(-1);$('month-next').onclick=()=>shiftMonth(1);$('month-today').onclick=()=>{journalMonth=journalDate(Date.now()).slice(0,7);journalDay=null;renderJournal();};$('clear-day').onclick=()=>{journalDay=null;renderJournal();};
$('journal-backup').onclick=async()=>{
  try{
    const response=await fetch('/api/journal/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Replay-Token':document.querySelector('meta[name=replay-token]').content},body:'{}'});
    if(!response.ok)throw Error('Could not create journal backup.');
    const url=URL.createObjectURL(await response.blob()),link=element('a');link.href=url;link.download='MT5-Journal-'+new Date().toISOString().slice(0,10)+'.sqlite3';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Journal backup downloaded. It includes reviews and screenshots, not your API key.');
  }catch(error){status(error.message);}
};
window.addEventListener('beforeunload',event=>{if(journalDirty){event.preventDefault();event.returnValue='';}});
refreshJournal().catch(error=>status(error.message));
