const MIN_ITEMS = 5;
const MIN_MS = 2000;
const RECENT = 5;
const fmt = (sec)=>{ sec=Math.max(1, Math.ceil(sec)); if(sec<60)return `${sec}s`; const m=Math.floor(sec/60), s=sec%60; return s?`${m}m ${s}s`:`${m}m`; };
const make = ()=>({ start:performance.now(), total:0, done:0, samples:[], last:null });
const reset = (m,total=0)=>{ m.start=performance.now(); m.total=total; m.done=0; m.samples=[]; m.last=null; };
const avg = (a)=>a.reduce((x,y)=>x+y,0)/a.length;
const ready = (m)=>m.done>=MIN_ITEMS && performance.now()-m.start>=MIN_MS;
const count = (m,n)=>`${n} ${Math.min(m.done, m.total || m.done)}/${m.total || m.done || '?'}`;
const serial = (m)=>{
    const total=m.total||m.done, left=total-m.done;
    if(left<=0)return 0;
    if(!ready(m))return null;
    const all=avg(m.samples)/1000;
    const recent=avg(m.samples.slice(-RECENT))/1000;
    const per=Math.max(all,recent);
    const stalled=(performance.now()-(m.last??m.start))/1000;
    return stalled>per ? stalled+(per*Math.max(0,left-1)) : per*left;
};
const parallel = (m)=>{
    const total=m.total||m.done, left=total-m.done;
    if(left<=0)return 0;
    if(!ready(m))return null;
    const elapsed=(performance.now()-m.start)/1000;
    const stalled=(performance.now()-(m.last??m.start))/1000;
    const recent=avg(m.samples.slice(-RECENT))/1000;
    return Math.max((elapsed/m.done)*left, stalled, recent*left);
};
const st = (lp)=>lp.__stlpEta ??= { phase:'waiting', data:make(), cards:make(), timer:null };
const ensureLine = (lp)=>{
    if(!lp?.startupLoadingEl)return null;
    if(lp.__stlpEtaLine?.isConnected)return lp.__stlpEtaLine;
    const el=document.createElement('div');
    el.className='stlp--startupLoadingEta';
    el.textContent='Waiting for startup. Card loading has not started yet.';
    lp.__stlpEtaLine=el;
    lp.startupLoadingEl.querySelector('.stlp--startupLoadingProgress')?.insertAdjacentElement('afterend',el);
    return el;
};
const eta = (s)=>s.phase==='cards'?serial(s.cards):s.phase==='data'?parallel(s.data):null;
const paint = (lp)=>{
    const el=ensureLine(lp); if(!el)return;
    const s=st(lp);
    if((lp.startupLoadingProgress??0)>=100){ el.textContent='Ready now.'; return; }
    if(lp.useSlowConnectionMode||lp.startupFastTrackRequested||s.phase==='slow'){
        el.textContent=s.phase==='waiting'?'Slow mode queued. Waiting for startup.':'Slow mode enabled. Opening text-only cards.';
        return;
    }
    if(s.phase==='waiting'){
        el.textContent='Waiting for startup. Card loading has not started yet.';
        return;
    }
    const m=s.phase==='cards'?s.cards:s.data;
    const name=s.phase==='cards'?'thumbnail cards':'card data';
    const t=eta(s);
    el.textContent=t===null
        ? `Measuring speed (${count(m,name)}). Estimated time appears after ${MIN_ITEMS} items and ${MIN_MS/1000}s.`
        : `Estimated time: ${fmt(t)} (${count(m,name)}).`;
};
const tick = (lp)=>{ const s=st(lp); if(s.timer!==null)return; s.timer=setInterval(()=>paint(lp),1000); };
const untick = (lp)=>{ const s=st(lp); if(s.timer===null)return; clearInterval(s.timer); s.timer=null; };
const patch = async()=>{
    const [{ LandingPage }, { Card }] = await Promise.all([import('./LandingPage.js'), import('./Card.js')]);
    if(LandingPage.prototype.__stlpEtaAdaptive)return;
    Object.defineProperty(LandingPage.prototype,'__stlpEtaAdaptive',{value:true});
    let loading=null, rendering=null;
    const oldLoadCard=Card.prototype.load;
    Card.prototype.load=async function(...args){
        const lp=loading, m=lp?st(lp).data:null;
        if(m){m.total++; paint(lp);} const started=performance.now();
        try{return await oldLoadCard.apply(this,args);} finally{ if(m){m.done++; m.last=performance.now(); m.samples.push(m.last-started); paint(lp);} }
    };
    const oldRenderCard=Card.prototype.render;
    Card.prototype.render=async function(settings,...args){
        const lp=rendering, s=lp?st(lp):null;
        const m=s && !lp.useSlowConnectionMode && settings?.loadAvatars!==false ? s.cards : null;
        if(m){m.total++; paint(lp);} const started=performance.now();
        try{return await oldRenderCard.apply(this,[settings,...args]);} finally{ if(m){m.done++; m.last=performance.now(); m.samples.push(m.last-started); paint(lp);} }
    };
    const oldLoad=LandingPage.prototype.load;
    LandingPage.prototype.load=async function(...args){
        const s=st(this); s.phase=this.startupFastTrackRequested?'slow':'data'; reset(s.data); reset(s.cards); tick(this); paint(this);
        const prev=loading; loading=this;
        try{return await oldLoad.apply(this,args);} finally{loading=prev; if(s.phase==='data')s.phase=this.useSlowConnectionMode?'slow':'cards'; paint(this);}
    };
    const oldRenderCards=LandingPage.prototype.renderCardsForCategory;
    LandingPage.prototype.renderCardsForCategory=async function(root,category,...args){
        const s=st(this); const cards=category==='search'?this.searchResults.slice(0,this.settings.numCards):(this.cardsByCategory[category]??[]);
        if(this.useSlowConnectionMode)s.phase='slow'; else{reset(s.cards,cards.length); s.phase='cards';}
        paint(this); const prev=rendering; rendering=this;
        try{return await oldRenderCards.apply(this,[root,category,...args]);} finally{rendering=prev; paint(this);}
    };
    const oldSlow=LandingPage.prototype.requestStartupFastTrack;
    LandingPage.prototype.requestStartupFastTrack=function(...args){ const s=st(this); if(s.phase!=='waiting')s.phase='slow'; this.useSlowConnectionMode=true; this.startupFastTrackRequested=true; this.getStartupFastTrackPromise?.(); paint(this); const out=oldSlow.apply(this,args); this.startupFastTrackResolver?.('slow-mode'); this.startupFastTrackResolver=null; paint(this); return out; };
    const oldStartup=LandingPage.prototype.renderStartupLoading;
    LandingPage.prototype.renderStartupLoading=function(...args){ const out=oldStartup.apply(this,args); const s=st(this); if(!['data','cards','slow'].includes(s.phase))s.phase='waiting'; tick(this); paint(this); return out; };
    const oldProgress=LandingPage.prototype.setStartupLoadingProgress;
    LandingPage.prototype.setStartupLoadingProgress=function(...args){ const out=oldProgress.apply(this,args); paint(this); return out; };
    const oldTear=LandingPage.prototype.teardownStartupLoading;
    LandingPage.prototype.teardownStartupLoading=function(...args){ untick(this); return oldTear.apply(this,args); };
    const oldEnd=LandingPage.prototype.endInput;
    LandingPage.prototype.endInput=function(...args){ const out=oldEnd.apply(this,args); if(this.sheld)this.sheld.style.zIndex=''; return out; };
    const oldUn=LandingPage.prototype.unrender;
    LandingPage.prototype.unrender=function(...args){ const out=oldUn.apply(this,args); untick(this); if(this.sheld){this.sheld.style.zIndex=''; this.sheld.style.opacity=''; this.sheld.style.pointerEvents='';} return out; };
    if(!document.getElementById('stlp-eta-fix-style')){ const style=document.createElement('style'); style.id='stlp-eta-fix-style'; style.textContent='.stlp--startupLoadingEta{margin-top:.55rem;max-width:min(760px,88vw);font-size:.88em;line-height:1.35;opacity:.78;text-align:center}body:not(:has(.stlp--container)) #sheld{z-index:auto!important}'; document.head.append(style); }
};
setTimeout(()=>patch().catch(err=>console.warn('[STL] ETA patch failed', err)),0);
