'use strict';
import {createSession, ranking, beginRound, tick, pause, resume, skipRound, endSession, acceptGuess, seedScenario, publicSnapshot} from './session.mjs';
const $ = id => document.getElementById(id);
const collections = [
  {name:'Gece Altını',x:8,y:6,w:249,h:370,backX:266,light:false},
  {name:'Parşömen',x:541,y:6,w:252,h:370,backX:800,light:true},
  {name:'Gece Mavisi',x:8,y:387,w:249,h:365,backX:266,light:false},
  {name:'Prizma',x:541,y:387,w:252,h:365,backX:800,light:false},
  {name:'Rüya Tozu',x:8,y:759,w:249,h:348,backX:266,light:true},
  {name:'Sakura',x:541,y:759,w:252,h:348,backX:800,light:true},
  {name:'Ejderha',x:8,y:1118,w:249,h:350,backX:266,light:false},
  {name:'Bastet',x:541,y:1118,w:252,h:350,backX:800,light:true},
];
const variants = [
  {name:'Orijinal',color:'#b69b65',filter:'none'},
  {name:'Ay Işığı',color:'#8cadcb',filter:'hue-rotate(165deg) saturate(.7)'},
  {name:'Gün Batımı',color:'#c87d6b',filter:'hue-rotate(315deg) saturate(.8)'},
];
const packs = {
  tr:{general:[{target:'KUTUP IŞIKLARI',taboos:['Gökyüzü','Kuzey','Yeşil','Gece','Aurora']},{target:'PUSULA',taboos:['Yön','Kuzey','İğne','Harita','Manyetik']},{target:'KUM SAATİ',taboos:['Zaman','Cam','Kum','Dakika','Çevirmek']}],nature:[{target:'AYÇİÇEĞİ',taboos:['Güneş','Sarı','Çekirdek','Tarla','Çiçek']},{target:'ŞELALE',taboos:['Su','Nehir','Yüksek','Düşmek','Akmak']}]},
  en:{general:[{target:'NORTHERN LIGHTS',taboos:['Sky','Aurora','Green','Night','Arctic']},{target:'COMPASS',taboos:['North','Needle','Direction','Map','Magnetic']}],nature:[{target:'SUNFLOWER',taboos:['Sun','Yellow','Seed','Field','Flower']},{target:'WATERFALL',taboos:['Water','River','Drop','Flow','Cliff']}]},
};
const providerInfo = {
  twitch:{name:'Twitch',description:'Kanalın sohbet olaylarını oku. İlk sürümde Twitch EventSub üzerinden tahmin alınır.',scopes:'EventSub taşımasına göre sohbet okuma ve bot/kanal yetkilendirmesi. Sohbete mesaj yazma ayrı ve isteğe bağlıdır.'},
  kick:{name:'Kick',description:'Kanal sohbetini imzalı webhook olaylarıyla al. Ortak oyun akışı değişmez.',scopes:'events:subscribe + gereken kanal/hesap okuma izinleri. İmzalar gerçek entegrasyonda sunucuda doğrulanır.'},
  youtube:{name:'YouTube',description:'Önce hesabını, sonra aktif canlı yayınını seç. Sohbet, seçtiğin yayına bağlıdır.',scopes:'Aktif yayın keşfi için youtube.readonly. Canlı sohbet akışı streamList üzerinden izlenir; yazma izni bu demoda istenmez.'},
};
const state = {...createSession(),provider:null,chosenProvider:null,collection:0,variant:0,back:false,owned:new Set(),equipped:null};
let revision = 0;
let lastInput = null;
const sessionId = crypto.randomUUID();
const channel = new BroadcastChannel('hushle-preview-' + sessionId);
const publicUrl = new URL('public.html',location.href); publicUrl.searchParams.set('session',sessionId);
$('public-link').href = publicUrl.href;
$('public-preview').src = publicUrl.href;
const overlayUrl = new URL(publicUrl); overlayUrl.searchParams.set('overlay','1'); $('overlay-link').href = overlayUrl.href;
channel.onmessage = ({data}) => { if (data?.type === 'preview-ready') publish(); };
function publish(){
  channel.postMessage(publicSnapshot(state, ++revision));
}
function toast(message){$('toast').textContent=message; $('toast').hidden=false; clearTimeout(toast.timeout); toast.timeout=setTimeout(()=>{$('toast').hidden=true;},4000);}
function art(collection,back){
  const ns='http://www.w3.org/2000/svg'; const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`${back?collection.backX:collection.x} ${collection.y} ${collection.w} ${collection.h}`);
  svg.setAttribute('preserveAspectRatio','none'); svg.setAttribute('aria-hidden','true');
  const image=document.createElementNS(ns,'image'); image.setAttribute('href','reference-cards.png'); image.setAttribute('width','1065'); image.setAttribute('height','1477'); svg.append(image);return svg;
}
function setArt(node,index,back,variant=0){
  const collection=collections[index];node.querySelector('.card-art').replaceChildren(art(collection,back));
  node.classList.toggle('light-art',collection.light);node.classList.toggle('back',back);node.style.setProperty('--art-filter',variants[variant].filter);
}
function word(){const deck=packs[state.language][state.category];return deck[state.index%deck.length];}
function writeWords(target,list,item){$(target).textContent=item.target;$(list).replaceChildren(...item.taboos.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
function log(text,correct=false,playerName='hushle'){
  const line=document.createElement('div');line.className='chat-line'+(correct?' correct':'');
  const name=document.createElement('b');name.textContent=playerName;
  const message=document.createElement('span');message.textContent=text;line.append(name,message);$('chat-feed').append(line);
  while($('chat-feed').children.length>30)$('chat-feed').firstElementChild.remove();$('chat-feed').scrollTop=$('chat-feed').scrollHeight;
}
function render(){
  const phaseNames={ready:'Hazır',running:'Tahminler açık',paused:'Duraklatıldı',finished:'Tur tamamlandı',ended:'Oturum tamamlandı'};
  $('phase').textContent=phaseNames[state.phase];$('timer').replaceChildren(document.createTextNode(String(state.remaining)));const seconds=document.createElement('span');seconds.textContent='sn';$('timer').append(seconds);
  $('round-number').textContent=String(state.round).padStart(2,'0');
  $('pack-summary').textContent=`${state.language==='tr'?'Türkçe':'English'} kelimeler · ${state.category==='general'?'Genel':'Doğa'} · ${state.duration} sn`;
  $('connection-state').textContent=state.provider?(state.connected?providerInfo[state.provider].name+' bağlı / Demo':'Bağlantı kesildi'):'Kanal bağlı değil';
  $('start').disabled=['running','paused'].includes(state.phase);$('start').firstChild.textContent=state.phase==='ended'?'Yeni oturum ':state.phase==='finished'?'Sonraki tur ':'Turu başlat ';
  $('pause').disabled=!['running','paused'].includes(state.phase)||!state.connected;$('pause').textContent=state.phase==='paused'?'Devam et':'Duraklat';
  $('skip').disabled=!['running','paused'].includes(state.phase);$('correct').disabled=state.phase!=='running';
  $('guess').disabled=state.phase!=='running';$('guess-form').querySelector('button').disabled=state.phase!=='running';
  $('disconnect').disabled=!state.provider;$('disconnect').textContent=state.connected?'Bağlantıyı kes':'Yeniden bağla';
  $('settings-open').disabled=['running','paused'].includes(state.phase);
  document.querySelectorAll('[data-provider]').forEach(button=>{
    const active=button.dataset.provider===state.provider;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    button.disabled=['running','paused'].includes(state.phase);button.querySelector('small').textContent=active?(state.connected?'Demo kanal bağlı':'Yeniden bağlanmalı'):button.dataset.provider==='youtube'?'Canlı yayın seç':'Bağlantı dene';
  });
  $('last-winner').textContent=state.lastCorrect?.name||'İlk bilen sen ol.';
  $('winner-caption').textContent=state.lastCorrect?`+1 puan · ${state.lastCorrect.round}. turda bildi`:'Doğru tahmin geldiğinde burada görünecek.';
  $('participant-count').textContent=state.participants.size+' kişi katıldı';
  $('replay').disabled=!lastInput;
  $('end-session').disabled=state.phase==='ended'||(state.phase==='ready'&&!state.players.size);
  const scores=ranking(state).slice(0,3);$('scoreboard').replaceChildren();
  scores.forEach(entry=>{const li=document.createElement('li');const rank=document.createElement('span');rank.className='rank';rank.textContent=String(entry.rank).padStart(2,'0');const name=document.createElement('span');name.className='score-name';name.textContent=entry.name;name.title=entry.name;const points=document.createElement('span');points.className='points';points.textContent=String(entry.points);li.append(rank,name);if(entry.tied){const badge=document.createElement('small');badge.textContent='Eşit';li.append(badge);}li.append(points);$('scoreboard').append(li);});
  if(!scores.length){const li=document.createElement('li');li.className='empty-score';li.textContent='İlk doğru tahminle yarış başlar.';$('scoreboard').append(li);}
  writeWords('target','taboos',word());publish();
}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('.tab-panel').forEach(panel=>panel.hidden=panel.id!==button.dataset.tab);location.hash=button.dataset.tab;
}));
document.querySelectorAll('[data-provider]').forEach(button=>button.addEventListener('click',()=>{
  if(['running','paused'].includes(state.phase))return;state.chosenProvider=button.dataset.provider;const info=providerInfo[state.chosenProvider];
  $('connect-title').textContent=info.name+' ile bağlan.';$('connect-description').textContent=info.description;$('connect-scopes').textContent=info.scopes;$('broadcast-picker').hidden=state.chosenProvider!=='youtube';$('connect-dialog').showModal();
}));
$('connect-confirm').addEventListener('click',()=>{state.provider=state.chosenProvider;state.connected=true;$('connect-dialog').close();toast('Demo kanal bağlandı. Gerçek OAuth bağlantısı yapılmadı.');render();});
$('start').addEventListener('click',()=>{
  if(!state.connected){toast('Önce bir demo kanal bağla.');return;}if(['running','paused'].includes(state.phase))return;
  beginRound(state);render();
});
$('pause').addEventListener('click',()=>{
  if(!state.connected)return;
  if(state.phase==='running')pause(state);
  else if(state.phase==='paused')resume(state);render();
});
$('skip').addEventListener('click',()=>{
  if(!skipRound(state))return;log('Kelime pas geçildi. Son bilen bilgisi korunuyor.');render();
});
function submitGuess(value){
  lastInput={messageId:crypto.randomUUID(),roundId:state.round,playerId:$('demo-player').value,name:$('demo-name').value,text:value,target:word().target};
  const result=acceptGuess(state,lastInput);
  if(result==='correct'||result==='wrong')log(value,result==='correct',lastInput.name);
  else toast('Tahmin kabul edilmedi. Aktif tur ve oyuncu adı gerekli.');
  render();return result==='correct';
}
$('guess-form').addEventListener('submit',event=>{event.preventDefault();submitGuess($('guess').value);$('guess').value='';});
$('correct').addEventListener('click',()=>submitGuess(word().target));
$('disconnect').addEventListener('click',()=>{
  if(!state.provider)return;state.connected=!state.connected;
  if(!state.connected&&state.phase==='running')pause(state);
  toast(state.connected?'Demo bağlantı geri geldi. Devam etmek senin kontrolünde.':'Sohbet bağlantısı kesildi. Aktif tur otomatik duraklatıldı.');render();
});
const ticker=setInterval(()=>{
  if(!tick(state))return;if(state.phase==='finished')log('Süre doldu. Bu turda puan verilmedi.');render();
},200);
$('settings-open').addEventListener('click',()=>{if(!['running','paused'].includes(state.phase))$('settings-dialog').showModal();});
$('settings-form').addEventListener('submit',event=>{
  event.preventDefault();if(['running','paused'].includes(state.phase))return;
  state.language=$('word-language').value;state.category=$('category').value;state.duration=Number($('duration').value);state.remaining=state.duration;state.index=0;state.phase='ready';state.winner=null;$('settings-dialog').close();render();toast('Kelime paketi güncellendi. Arayüz dili değişmedi.');
});
$('theme-toggle').addEventListener('click',()=>{const dark=document.body.classList.toggle('dark');$('theme-toggle').setAttribute('aria-label',dark?'Paneli açık temaya geçir':'Paneli koyu temaya geçir');});
$('broadcast-theme').addEventListener('change',()=>{state.broadcastTheme=$('broadcast-theme').value;publish();});
$('demo-player').addEventListener('change',()=>{$('demo-name').value={deniz:'Deniz',luna:'Luna',mert:'Mert',newcomer:'YeniOyuncu'}[$('demo-player').value];});
$('replay').addEventListener('click',()=>{if(!lastInput)return;acceptGuess(state,lastInput);render();toast('Aynı mesaj yeniden denendi. Yeni puan yazılmadı.');});
for(const [id,scenario] of [['sample-race','race'],['sample-tie','tie']])$(id).addEventListener('click',()=>{
  seedScenario(state,scenario);lastInput=null;$('demo-player').value='luna';$('demo-name').value='Luna';render();toast('Örnek veriler yüklendi. Gerçek oyuncu veya skor değildir.');
});
$('end-session').addEventListener('click',()=>{endSession(state);render();toast('Demo oturum tamamlandı. Skorlar korunuyor; yeni oturum sıfırdan başlar.');});
collections.forEach((collection,index)=>{
  const button=document.createElement('button');button.className='collection-choice';button.setAttribute('aria-label',collection.name+' kartını seç');button.dataset.collection=String(index);
  const image=document.createElement('span');image.className='mini-art';image.append(art(collection,true));const name=document.createElement('span');name.textContent=collection.name;button.append(image,name);$('collection-grid').append(button);
  button.addEventListener('click',()=>{state.collection=index;state.variant=0;renderLab();});
});
variants.forEach((variant,index)=>{
  const button=document.createElement('button');button.className='swatch';button.dataset.variant=String(index);button.style.setProperty('--swatch',variant.color);
  const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');const name=document.createElement('span');name.textContent=variant.name;button.append(dot,name);$('swatches').append(button);
  button.addEventListener('click',()=>{state.variant=index;renderLab();});
});
function renderLab(){
  setArt($('lab-card'),state.collection,state.back,state.variant);
  const sample=$('long-toggle').checked?{target:'ELEKTROENSEFALOGRAFİ',taboos:['Beyin','Elektrik','Dalga','Hastane','Ölçüm']} : packs.tr.general[0];
  writeWords('lab-target','lab-taboos',sample);
  $('lab-card').classList.toggle('show-safe',$('safe-toggle').checked&&!state.back);
  $('collection-caption').textContent=String(state.collection+1).padStart(2,'0')+' / '+collections[state.collection].name+' · '+variants[state.variant].name;
  document.querySelectorAll('[data-collection]').forEach(button=>{const selected=Number(button.dataset.collection)===state.collection;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  document.querySelectorAll('[data-variant]').forEach(button=>{const selected=Number(button.dataset.variant)===state.variant;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  $('face-toggle').textContent=state.back?'Ön yüzü göster ↻':'Arka yüzü göster ↻';
  const owned=state.owned.has(state.collection);$('ownership').textContent=owned?'Demo envanterinde':'Deneme önizlemesi';$('purchase').disabled=owned;$('purchase').textContent=owned?'Üç renk de demo envanterinde':'Seti satın almayı simüle et →';$('equip').disabled=!owned;
  const selected=state.equipped?.collection===state.collection&&state.equipped?.variant===state.variant;
  $('equip').textContent=selected?'Bu renk kullanımda':'Bu rengi kuşan';$('equip').disabled=!owned||selected;
  $('equip-status').textContent=state.equipped?collections[state.equipped.collection].name+' / '+variants[state.equipped.variant].name+' yayıncı kartında kullanımda.':'Gerçek satın alma ve envanter işlemi yapılmaz.';
}
$('face-toggle').addEventListener('click',()=>{state.back=!state.back;renderLab();});
$('safe-toggle').addEventListener('change',renderLab);$('long-toggle').addEventListener('change',renderLab);
$('purchase').addEventListener('click',()=>{state.owned.add(state.collection);renderLab();toast('Demo set açıldı. Üç renk de kullanılabilir. Ödeme yapılmadı.');});
$('equip').addEventListener('click',()=>{
  if(!state.owned.has(state.collection))return;state.equipped={collection:state.collection,variant:state.variant};setArt($('host-card'),state.collection,false,state.variant);renderLab();publish();toast('Kart önü özel panelde, arka yüzü yayın ekranında uygulandı.');
});
setArt($('host-card'),0,false);render();renderLab();
if(location.hash==='#cards')document.querySelector('[data-tab="cards"]').click();
addEventListener('pagehide',()=>{clearInterval(ticker);channel.close();});
