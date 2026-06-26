const MIN_ITEMS = 5;
const MIN_MS = 2000;

const fmt = (sec)=>{
    sec = Math.max(1, Math.ceil(sec));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rest = sec % 60;
    return rest ? `${min}m ${rest}s` : `${min}m`;
};

const metric = ()=>({ start:performance.now(), total:0, done:0, samples:[] });
const reset = (m, total = 0)=>{ m.start = performance.now(); m.total = total; m.done = 0; m.samples = []; };
const enough = (m)=>m.done >= MIN_ITEMS && performance.now() - m.start >= MIN_MS;
const count = (m, label)=>`${label} ${Math.min(m.done, m.total || m.done)}/${m.total || m.done || '?'}`;
const serialEta = (m)=>{
    const total = m.total || m.done;
    const left = total - m.done;
    if (left <= 0) return 0;
    if (!enough(m)) return null;
    return (m.samples.reduce((a,b)=>a+b, 0) / m.samples.length) * left / 1000;
};
const parallelEta = (m)=>{
    const total = m.total || m.done;
    const left = total - m.done;
    if (left <= 0) return 0;
    if (!enough(m)) return null;
    return ((performance.now() - m.start) / 1000 / m.done) * left;
};

const state = (lp)=>lp.__stlpEta ??= {
    phase:'waiting',
    data:metric(),
    cards:metric(),
    slow:metric(),
    lastNormalEta:null,
    hadNormalEta:false,
};

const line = (lp)=>{
    if (!lp?.startupLoadingEl) return null;
    if (lp.__stlpEtaLine?.isConnected) return lp.__stlpEtaLine;
    const el = document.createElement('div');
    el.className = 'stlp--startupLoadingEta';
    el.textContent = 'Waiting for SillyTavern startup. Card loading has not started yet.';
    lp.__stlpEtaLine = el;
    lp.startupLoadingEl.querySelector('.stlp--startupLoadingProgress')?.insertAdjacentElement('afterend', el);
    return el;
};

const normalEta = (s)=>s.phase === 'cards' ? serialEta(s.cards) : s.phase === 'data' ? parallelEta(s.data) : null;

const paint = (lp)=>{
    const el = line(lp);
    if (!el) return;
    const s = state(lp);
    if ((lp.startupLoadingProgress ?? 0) >= 100) { el.textContent = 'Ready now.'; return; }
    if (s.phase === 'waiting') {
        el.textContent = lp.startupFastTrackRequested
            ? 'Slow mode queued. Waiting for SillyTavern startup before opening text-only cards.'
            : 'Waiting for SillyTavern startup. Card loading has not started yet.';
        return;
    }
    if (lp.useSlowConnectionMode || lp.startupFastTrackRequested || s.phase === 'slow') {
        const eta = serialEta(s.slow);
        const slowText = eta === null
            ? `Slow mode: measuring real text-card speed (${count(s.slow, 'text cards')}). ETA appears after ${MIN_ITEMS} cards and ${MIN_MS / 1000}s.`
            : `Slow mode remaining: ${fmt(eta)} (${count(s.slow, 'text cards')}).`;
        const normalText = s.hadNormalEta && s.lastNormalEta !== null
            ? `Normal mode had about ${fmt(s.lastNormalEta)} left when interrupted.`
            : 'Normal mode was interrupted before enough data was measured.';
        el.textContent = `${slowText} ${normalText}`;
        return;
    }
    const eta = normalEta(s);
    const m = s.phase === 'cards' ? s.cards : s.data;
    const label = s.phase === 'cards' ? 'thumbnail cards' : 'card data';
    if (eta === null) {
        el.textContent = `Normal mode: measuring real speed (${count(m, label)}). ETA appears after ${MIN_ITEMS} items and ${MIN_MS / 1000}s. Slow mode timing starts after click.`;
    } else {
        s.hadNormalEta = true;
        s.lastNormalEta = eta;
        el.textContent = `Normal remaining: ${fmt(eta)} (${count(m, label)}). Slow mode timing starts after click.`;
    }
};

const patch = async()=>{
    const [{ LandingPage }, { Card }] = await Promise.all([import('./LandingPage.js'), import('./Card.js')]);
    if (LandingPage.prototype.__stlpEtaFixed) return;
    Object.defineProperty(LandingPage.prototype, '__stlpEtaFixed', { value:true });

    let loadingPage = null;
    let renderingPage = null;

    const oldCardLoad = Card.prototype.load;
    Card.prototype.load = async function(...args) {
        const lp = loadingPage;
        const m = lp ? state(lp).data : null;
        if (m) { m.total += 1; paint(lp); }
        const started = performance.now();
        try { return await oldCardLoad.apply(this, args); }
        finally { if (m) { m.done += 1; m.samples.push(performance.now() - started); paint(lp); } }
    };

    const oldCardRender = Card.prototype.render;
    Card.prototype.render = async function(settings, ...args) {
        const lp = renderingPage;
        const s = lp ? state(lp) : null;
        const m = s ? ((lp.useSlowConnectionMode || settings?.loadAvatars === false) ? s.slow : s.cards) : null;
        if (m) { m.total += 1; paint(lp); }
        const started = performance.now();
        try { return await oldCardRender.apply(this, [settings, ...args]); }
        finally { if (m) { m.done += 1; m.samples.push(performance.now() - started); paint(lp); } }
    };

    const oldLoad = LandingPage.prototype.load;
    LandingPage.prototype.load = async function(...args) {
        const s = state(this);
        s.phase = this.startupFastTrackRequested ? 'slow' : 'data';
        reset(s.data); reset(s.cards); reset(s.slow);
        paint(this);
        const prev = loadingPage;
        loadingPage = this;
        try { return await oldLoad.apply(this, args); }
        finally { loadingPage = prev; if (s.phase === 'data') s.phase = this.useSlowConnectionMode ? 'slow' : 'cards'; paint(this); }
    };

    const oldRenderCards = LandingPage.prototype.renderCardsForCategory;
    LandingPage.prototype.renderCardsForCategory = async function(root, category, ...args) {
        const s = state(this);
        const cards = category === 'search' ? this.searchResults.slice(0, this.settings.numCards) : (this.cardsByCategory[category] ?? []);
        const m = this.useSlowConnectionMode ? s.slow : s.cards;
        reset(m, cards.length);
        s.phase = this.useSlowConnectionMode ? 'slow' : 'cards';
        paint(this);
        const prev = renderingPage;
        renderingPage = this;
        try { return await oldRenderCards.apply(this, [root, category, ...args]); }
        finally { renderingPage = prev; paint(this); }
    };

    const oldSlow = LandingPage.prototype.requestStartupFastTrack;
    LandingPage.prototype.requestStartupFastTrack = function(...args) {
        const s = state(this);
        const eta = normalEta(s);
        s.hadNormalEta = eta !== null;
        s.lastNormalEta = eta;
        if (s.phase !== 'waiting') s.phase = 'slow';
        this.useSlowConnectionMode = true;
        this.startupFastTrackRequested = true;
        this.getStartupFastTrackPromise?.();
        paint(this);
        const out = oldSlow.apply(this, args);
        this.startupFastTrackResolver?.('slow-mode');
        this.startupFastTrackResolver = null;
        paint(this);
        return out;
    };

    const oldStartup = LandingPage.prototype.renderStartupLoading;
    LandingPage.prototype.renderStartupLoading = function(...args) {
        const out = oldStartup.apply(this, args);
        const s = state(this);
        if (!['data','cards','slow'].includes(s.phase)) s.phase = 'waiting';
        paint(this);
        return out;
    };

    const oldProgress = LandingPage.prototype.setStartupLoadingProgress;
    LandingPage.prototype.setStartupLoadingProgress = function(...args) { const out = oldProgress.apply(this, args); paint(this); return out; };

    const oldEndInput = LandingPage.prototype.endInput;
    LandingPage.prototype.endInput = function(...args) { const out = oldEndInput.apply(this, args); if (this.sheld) this.sheld.style.zIndex = ''; return out; };

    const oldUnrender = LandingPage.prototype.unrender;
    LandingPage.prototype.unrender = function(...args) {
        const out = oldUnrender.apply(this, args);
        if (this.sheld) { this.sheld.style.zIndex = ''; this.sheld.style.opacity = ''; this.sheld.style.pointerEvents = ''; }
        return out;
    };

    if (!document.getElementById('stlp-eta-fix-style')) {
        const style = document.createElement('style');
        style.id = 'stlp-eta-fix-style';
        style.textContent = '.stlp--startupLoadingEta{margin-top:.55rem;max-width:min(760px,88vw);font-size:.88em;line-height:1.35;opacity:.78;text-align:center}body:not(:has(.stlp--container)) #sheld{z-index:auto!important}';
        document.head.append(style);
    }
};

setTimeout(()=>patch().catch(err=>console.warn('[STL] ETA patch failed', err)), 0);
