'use strict';
// This consumer never imports target words or host data.
const params = new URLSearchParams(location.search);
if (params.get('overlay') === '1') document.body.classList.add('overlay');
const channel = new BroadcastChannel('hushle-preview-' + (params.get('session') || 'demo'));
const $ = id => document.getElementById(id);
const phases = {ready:'HAZIR', running:'TAHMİNLER AÇIK', paused:'DURAKLATILDI', finished:'TUR TAMAMLANDI', ended:'OTURUM BİTTİ'};
const integer = (value, min, max, fallback = min) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
const text = value => typeof value === 'string' ? value.slice(0,40) : '';
const backs = [
  [266,6,249,370],[800,6,252,370],[266,387,249,365],[800,387,252,365],
  [266,759,249,348],[800,759,252,348],[266,1118,249,350],[800,1118,252,350],
];
let lastRevision = -1, scoreSignature = '', artSignature = '', lastEventId, previousLeader;
function renderBack(back) {
  const valid = back && Number.isInteger(back.collection) && back.collection >= 0 && back.collection < backs.length && Number.isInteger(back.variant) && back.variant >= 0 && back.variant < 3;
  const signature = valid ? back.collection + ':' + back.variant : 'default';
  if (signature === artSignature) return;
  artSignature = signature;
  const node = $('visual-back'); node.replaceChildren(); node.classList.toggle('has-art', !!valid);
  if (!valid) {const mark=document.createElement('span');mark.textContent='H';node.append(mark);return;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', backs[back.collection].join(' '));svg.setAttribute('preserveAspectRatio','none');
  const image=document.createElementNS('http://www.w3.org/2000/svg','image');
  image.setAttribute('href','reference-cards.png');image.setAttribute('width','1065');image.setAttribute('height','1477');svg.append(image);node.append(svg);
  node.style.setProperty('--art-filter',['none','hue-rotate(165deg) saturate(.7)','hue-rotate(315deg) saturate(.8)'][back.variant]);
}
function renderScores(scores) {
  const signature = JSON.stringify(scores);
  if (signature === scoreSignature) return;
  scoreSignature = signature;
  const list=$('scores'); list.replaceChildren();
  for(let i=0;i<3;i++) {
    const entry=scores[i], li=document.createElement('li');
    const rank=document.createElement('span');rank.className='rank';rank.textContent=String(entry?.rank || i+1).padStart(2,'0');
    const player=document.createElement('span');player.className='player';
    const name=document.createElement('span');name.className='name';name.textContent=entry?.name || 'Henüz katılan yok';name.title=entry?.name || '';player.append(name);
    if(entry?.tied){const tie=document.createElement('span');tie.className='tie';tie.textContent='Eşit';player.append(tie);}
    const points=document.createElement('b');points.className='points';points.textContent=entry ? String(entry.points) : '—';
    if(!entry)li.className='placeholder';
    li.append(rank,player,points);list.append(li);
  }
  const unique = scores[0] && !scores[0].tied ? scores[0].name : null;
  $('leader-note').textContent=!scores.length?'İlk doğru tahminle yarış başlar.':scores[0].tied?'Liderlik paylaşılıyor.':unique !== previousLeader && previousLeader !== undefined ? unique+' liderliği aldı.' : unique+' yarışı önde götürüyor.';
  if(unique && previousLeader !== undefined && unique !== previousLeader && !matchMedia('(prefers-reduced-motion: reduce)').matches)list.firstElementChild.animate([{background:'var(--subtle)'},{background:'transparent'}],{duration:700});
  previousLeader=unique;
}
channel.onmessage=({data})=>{
  if(!data || data.type!=='public-state' || data.schemaVersion!==2 || !Number.isInteger(data.revision) || data.revision<=lastRevision)return;
  lastRevision=data.revision;
  const phase=Object.hasOwn(phases,data.phase)?data.phase:'ready';
  document.body.dataset.phase=phase;document.body.classList.toggle('dark',data.theme!=='light');
  $('phase').textContent=phases[phase];
  const remaining=integer(data.remaining,0,90),duration=integer(data.duration,1,90,60);
  $('timer').textContent=String(remaining);$('timer-progress').style.width=Math.min(100,remaining/duration*100)+'%';
  $('round').textContent=String(integer(data.round,1,999,1)).padStart(2,'0');
  $('participant-count').textContent=String(integer(data.participants,0,999999));
  $('pack-label').textContent=(data.pack==='EN'?'EN':'TR')+' KELİME PAKETİ';
  const scores=(Array.isArray(data.scores)?data.scores:[]).slice(0,3).filter(entry=>entry&&text(entry.name)).map(entry=>({name:text(entry.name),points:integer(entry.points,0,99999),rank:integer(entry.rank,1,999,1),tied:entry.tied===true}));
  renderScores(scores); renderBack(data.cardBack);
  const copy={
    ready:['Sohbet hazır mı?','Yayıncı turu başlatınca tahminler açılır.'],
    running:['Tahmin et!','Yayıncı anlatıyor. Cevabını sohbete yaz.'],
    paused:['Kısa bir ara.',data.connected?'Yayıncı devam ettiğinde yarış sürecek.':'Sohbet bağlantısı bekleniyor.'],
    finished:['Bir tur daha!','Sonraki kelime için yayıncıyı bekliyoruz.'],
    ended:['Oturum tamamlandı.',scores[0]?(scores[0].tied?'Liderlik paylaşıldı.':scores[0].name+' oturumu önde tamamladı.'):'Yeni oturumda görüşürüz.'],
  }[phase];
  $('headline').textContent=copy[0];$('instruction').textContent=copy[1];
  const last=data.lastCorrect && text(data.lastCorrect.name) ? data.lastCorrect : null;
  $('winner').textContent=last?text(last.name):'İlk bilen sen ol.';
  $('winner').title=last?text(last.name):'';
  $('winner-round').textContent=last?integer(last.round,1,999,1)+'. turda bildi':'';
  $('earned').hidden=!last;
  const eventId=last?text(last.eventId):null;
  if(lastEventId !== undefined && eventId && eventId !== lastEventId && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    $('last-correct').classList.remove('celebrate');void $('last-correct').offsetWidth;$('last-correct').classList.add('celebrate');
  }
  lastEventId=eventId;
};
channel.postMessage({type:'preview-ready'});
addEventListener('pagehide',()=>channel.close());
