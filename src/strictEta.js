const fmt = (sec)=>{
    sec = Math.ceil(sec);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
};

const metric = ()=>({ start: performance.now(), total: 0, done: 0, times: [] });
const enough = (m)=>m.done >= 5 && (performance.now() - m.start) >= 2000;
const label = (m, name)=>`${name} ${m.done}/${m.total || m.done}`;
const eta = (m)=>{
    const total = m.total || m.done;
    const left = total - m.done;
    if (left <= 0) return 0;
    if (!enough(m)) return null;
    const avg = m.times.reduce((a,b)=>a+b, 0) / m.times.length;
    return avg * left / 1000;
};

const stateFor = (lp)=>lp.__strictEta ??= {
    phase: 'normal-data',
    normalData: metric(),
    normalCards: metric(),
    slowCards: metric(),
    normalWasMeasured: false,
    lastNormalEta: null,
};

const addLine = (lp)=>{
    if (!lp?.startupLoadingEl) return null;
    if (lp.__strictEtaLine?.isConnected) return lp.__strictEtaLine;
    const line = document.createElement('div');
    line.className = 'stlp--startupLoadingEta';
    line.textContent = 'Measuring startup…';
    lp.__strictEtaLine = line;
    lp.startupLoadingEl.querySelector('.stlp--startupLoadingProgress')?.insertAdjacentElement('afterend', line);
    return line;
};

const paint = (lp)=>{
    const line = addLine(lp);
    if (!line) return;
    const s = stateFor(lp);
    if ((lp.startupLoadingProgress ?? 0) >= 100) {
        line.textContent = 'Ready now.';
        return;
    }
    if (lp.useSlowConnectionMode || lp.startupFastTrackRequested) {
        const t = eta(s.slowCards);
        const slow = t === null
            ? `Slow mode: measuring real card speed (${label(s.slowCards, 'text cards')}). ETA appears after at least 5 cards and 2 seconds.`
            : `Slow mode remaining: ${fmt(t)} (${label(s.slowCards, 'text cards')}).`;
        const normal = s.normalWasMeasured && s.lastNormalEta !== null
            ? `Normal mode had about ${fmt(s.lastNormalEta)} left when interrupted.`
            : 'Normal mode was interrupted before enough data was measured.';
        line.textContent = `${slow} ${normal}`;
        return;
    }
    const m = s.phase === 'normal-cards' ? s.normalCards : s.normalData;
    const name = s.phase === 'normal-cards' ? 'thumbnail cards' : 'card data';
    const t = eta(m);
    if (t !== null) {
        s.normalWasMeasured = true;
        s.lastNormalEta = t;
        line.textContent = `Normal remaining: ${fmt(t)} (${label(m, name)}). Slow mode timing starts after click.`;
    } else {
        line.textContent = `Normal mode: measuring real speed (${label(m, name)}). ETA appears after at least 5 items and 2 seconds. Slow mode timing starts after click.`;
    }
};

const patch = async()=>{
    const [{ LandingPage }, { Card }] = await Promise.all([import('./LandingPage.js'), import('./Card.js')]);
    if (LandingPage.prototype.__strictEtaPatched) return;
    Object.defineProperty(LandingPage.prototype, '__strictEtaPatched', { value: true });
    let loadLp = null;
    let renderLp = null;

    const oldLoad = Card.prototype.load;
    Card.prototype.load = async function(...args) {
        const lp = loadLp;
        const m = lp ? stateFor(lp).normalData : null;
        if (m) { m.total++; paint(lp); }
        const started = performance.now();
        try { return await oldLoad.apply(this, args); }
        finally { if (m) { m.done++; m.times.push(performance.now() - started); paint(lp); } }
    };

    const oldRender = Card.prototype.render;
    Card.prototype.render = async function(settings, ...args) {
        const lp = renderLp;
        const st = lp ? stateFor(lp) : null;
        const m = st ? ((lp.useSlowConnectionMode || settings?.loadAvatars === false) ? st.slowCards : st.normalCards) : null;
        if (m) { m.total++; paint(lp); }
        const started = performance.now();
        try { return await oldRender.apply(this, [settings, ...args]); }
        finally { if (m) { m.done++; m.times.push(performance.now() - started); paint(lp); } }
    };

    const oldLpLoad = LandingPage.prototype.load;
    LandingPage.prototype.load = async function(...args) {
        const st = stateFor(this);
        st.phase = 'normal-data';
        st.normalData = metric();
        st.normalCards = metric();
        st.slowCards = metric();
        paint(this);
        const prev = loadLp;
        loadLp = this;
        try { return await oldLpLoad.apply(this, args); }
        finally { loadLp = prev; st.phase = this.useSlowConnectionMode ? 'slow-cards' : 'normal-cards'; paint(this); }
    };

    const oldRenderCards = LandingPage.prototype.renderCardsForCategory;
    LandingPage.prototype.renderCardsForCategory = async function(root, category, ...args) {
        const st = stateFor(this);
        const cards = category === 'search' ? this.searchResults.slice(0, this.settings.numCards) : (this.cardsByCategory[category] ?? []);
        const m = this.useSlowConnectionMode ? st.slowCards : st.normalCards;
        m.start = performance.now(); m.total = cards.length; m.done = 0; m.times = [];
        st.phase = this.useSlowConnectionMode ? 'slow-cards' : 'normal-cards';
        paint(this);
        const prev = renderLp;
        renderLp = this;
        try { return await oldRenderCards.apply(this, [root, category, ...args]); }
        finally { renderLp = prev; paint(this); }
    };

    const oldSlow = LandingPage.prototype.requestStartupFastTrack;
    LandingPage.prototype.requestStartupFastTrack = function(...args) {
        const st = stateFor(this);
        const n = eta(st.phase === 'normal-cards' ? st.normalCards : st.normalData);
        st.normalWasMeasured = n !== null;
        st.lastNormalEta = n;
        st.phase = 'slow-cards';
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

    const oldProgress = LandingPage.prototype.setStartupLoadingProgress;
    LandingPage.prototype.setStartupLoadingProgress = function(...args) {
        const out = oldProgress.apply(this, args);
        paint(this);
        return out;
    };

    const css = document.createElement('style');
    css.textContent = '.stlp--startupLoadingEta{margin-top:.55rem;max-width:min(760px,88vw);font-size:.88em;line-height:1.35;opacity:.78;text-align:center} body:not(:has(.stlp--container)) #sheld{z-index:auto!important}';
    document.head.append(css);
};

setTimeout(()=>patch().catch(err=>console.warn('[STL] strict ETA failed', err)), 0);
