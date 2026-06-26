const formatDuration = (seconds)=>{
    if (!Number.isFinite(seconds) || seconds < 0) return 'measuring…';
    seconds = Math.max(1, Math.ceil(seconds));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
};

const makeMetric = ()=>({
    startedAt: performance.now(),
    total: 0,
    started: 0,
    finished: 0,
    samples: [],
});

const resetMetric = (metric, total = 0)=>{
    metric.startedAt = performance.now();
    metric.total = total;
    metric.started = 0;
    metric.finished = 0;
    metric.samples = [];
};

const estimateParallel = (metric)=>{
    const total = metric.total || metric.started;
    const remaining = Math.max(0, total - metric.finished);
    if (!total || !remaining) return 0;
    if (!metric.finished) return null;
    const elapsed = (performance.now() - metric.startedAt) / 1000;
    return elapsed / metric.finished * remaining;
};

const estimateSerial = (metric)=>{
    const total = metric.total || metric.started;
    const remaining = Math.max(0, total - metric.finished);
    if (!total || !remaining) return 0;
    if (!metric.samples.length) return null;
    const avgMs = metric.samples.reduce((sum, val)=>sum + val, 0) / metric.samples.length;
    return avgMs * remaining / 1000;
};

const ensureMetrics = (landingPage)=>{
    if (!landingPage.__stlpMeasuredEta) {
        landingPage.__stlpMeasuredEta = {
            phase: 'starting',
            normalData: makeMetric(),
            normalCards: makeMetric(),
            slowCards: makeMetric(),
            lastNormalEta: null,
            lastSlowEta: null,
        };
    }
    return landingPage.__stlpMeasuredEta;
};

const metricLabel = (metric, label)=>{
    const total = metric.total || metric.started;
    if (!total) return label;
    return `${label} ${Math.min(metric.finished, total)}/${total}`;
};

const normalEta = (metrics)=>{
    if (metrics.phase === 'data') return estimateParallel(metrics.normalData);
    if (metrics.phase === 'cards') return estimateSerial(metrics.normalCards);
    return estimateParallel(metrics.normalData) ?? estimateSerial(metrics.normalCards);
};

const slowEta = (metrics)=>{
    if (metrics.phase !== 'slow-cards') return null;
    return estimateSerial(metrics.slowCards);
};

const ensureEtaLine = (landingPage)=>{
    if (!landingPage?.startupLoadingEl) return;
    if (landingPage.startupEtaEl?.isConnected) return;
    const line = document.createElement('div');
    line.classList.add('stlp--startupLoadingEta');
    line.textContent = 'Measuring startup…';
    landingPage.startupEtaEl = line;
    const progress = landingPage.startupLoadingEl.querySelector('.stlp--startupLoadingProgress');
    progress?.insertAdjacentElement('afterend', line);
};

const updateEtaLine = (landingPage)=>{
    ensureEtaLine(landingPage);
    const line = landingPage?.startupEtaEl;
    if (!line) return;
    const metrics = ensureMetrics(landingPage);

    if (Number(landingPage.startupLoadingProgress ?? 0) >= 100) {
        line.textContent = 'Ready now.';
        return;
    }

    const nEta = normalEta(metrics);
    const sEta = slowEta(metrics);
    if (nEta !== null) metrics.lastNormalEta = nEta;
    if (sEta !== null) metrics.lastSlowEta = sEta;

    if (landingPage.useSlowConnectionMode || landingPage.startupFastTrackRequested) {
        const slowText = sEta === null
            ? 'Slow mode remaining: measuring text-card render…'
            : `Slow mode remaining: ${formatDuration(sEta)} (${metricLabel(metrics.slowCards, 'text cards')}).`;
        const normalText = metrics.lastNormalEta === null
            ? 'Normal mode remaining before switch: still measuring.'
            : `Normal mode would have had about ${formatDuration(metrics.lastNormalEta)} left.`;
        line.textContent = `${slowText} ${normalText}`;
        return;
    }

    const phaseMetric = metrics.phase === 'data' ? metrics.normalData : metrics.normalCards;
    const phaseLabel = metrics.phase === 'data' ? 'card data' : 'thumbnail cards';
    const normalText = nEta === null
        ? `Normal remaining: measuring ${metricLabel(phaseMetric, phaseLabel)}…`
        : `Normal remaining: ${formatDuration(nEta)} (${metricLabel(phaseMetric, phaseLabel)}).`;
    const slowText = metrics.lastSlowEta === null
        ? 'Slow mode if clicked: timing starts after click.'
        : `Slow mode if clicked: about ${formatDuration(metrics.lastSlowEta)} from measured text-card speed.`;
    line.textContent = `${normalText} ${slowText}`;
};

const patchLandingPageRuntime = async()=>{
    const [{ LandingPage }, { Card }] = await Promise.all([
        import('./LandingPage.js'),
        import('./Card.js'),
    ]);
    const proto = LandingPage?.prototype;
    const cardProto = Card?.prototype;
    if (!proto || !cardProto || proto.__stlpMeasuredEtaPatched) return;
    Object.defineProperty(proto, '__stlpMeasuredEtaPatched', { value:true });

    let activeDataPage = null;
    let activeRenderPage = null;

    const originalCardLoad = cardProto.load;
    cardProto.load = async function(...args) {
        const page = activeDataPage;
        const metric = page ? ensureMetrics(page).normalData : null;
        if (metric) {
            metric.started += 1;
            metric.total = Math.max(metric.total, metric.started);
            updateEtaLine(page);
        }
        const startedAt = performance.now();
        try {
            return await originalCardLoad.apply(this, args);
        } finally {
            if (metric) {
                metric.finished += 1;
                metric.samples.push(performance.now() - startedAt);
                updateEtaLine(page);
            }
        }
    };

    const originalCardRender = cardProto.render;
    cardProto.render = async function(settings, ...args) {
        const page = activeRenderPage;
        const metrics = page ? ensureMetrics(page) : null;
        const metric = metrics ? ((settings?.loadAvatars === false || page.useSlowConnectionMode) ? metrics.slowCards : metrics.normalCards) : null;
        if (metric) {
            metric.started += 1;
            metric.total = Math.max(metric.total, metric.started);
            updateEtaLine(page);
        }
        const startedAt = performance.now();
        try {
            return await originalCardRender.apply(this, [settings, ...args]);
        } finally {
            if (metric) {
                metric.finished += 1;
                metric.samples.push(performance.now() - startedAt);
                updateEtaLine(page);
            }
        }
    };

    const originalLoad = proto.load;
    proto.load = async function(...args) {
        const metrics = ensureMetrics(this);
        metrics.phase = 'data';
        resetMetric(metrics.normalData);
        resetMetric(metrics.normalCards);
        resetMetric(metrics.slowCards);
        updateEtaLine(this);
        const previous = activeDataPage;
        activeDataPage = this;
        try {
            return await originalLoad.apply(this, args);
        } finally {
            activeDataPage = previous;
            if (metrics.phase === 'data') metrics.phase = this.useSlowConnectionMode ? 'slow-cards' : 'cards';
            updateEtaLine(this);
        }
    };

    const originalRenderCardsForCategory = proto.renderCardsForCategory;
    proto.renderCardsForCategory = async function(root, category, ...args) {
        const metrics = ensureMetrics(this);
        const cards = category === 'search'
            ? this.searchResults.slice(0, this.settings.numCards)
            : (this.cardsByCategory[category] ?? []);
        const metric = this.useSlowConnectionMode ? metrics.slowCards : metrics.normalCards;
        resetMetric(metric, cards.length);
        metrics.phase = this.useSlowConnectionMode ? 'slow-cards' : 'cards';
        updateEtaLine(this);
        const previous = activeRenderPage;
        activeRenderPage = this;
        try {
            return await originalRenderCardsForCategory.apply(this, [root, category, ...args]);
        } finally {
            activeRenderPage = previous;
            updateEtaLine(this);
        }
    };

    const originalRequestStartupFastTrack = proto.requestStartupFastTrack;
    proto.requestStartupFastTrack = function(...args) {
        const metrics = ensureMetrics(this);
        metrics.phase = 'slow-cards';
        this.useSlowConnectionMode = true;
        this.startupFastTrackRequested = true;
        this.getStartupFastTrackPromise?.();
        updateEtaLine(this);
        const result = originalRequestStartupFastTrack.apply(this, args);
        this.startupFastTrackResolver?.('slow-mode');
        this.startupFastTrackResolver = null;
        updateEtaLine(this);
        return result;
    };

    const restoreSheldLayer = (page)=>{
        if (!page?.sheld) return;
        page.sheld.style.zIndex = '';
        if (!page.dom) {
            page.sheld.style.opacity = '';
            page.sheld.style.pointerEvents = '';
        }
    };

    const originalEndInput = proto.endInput;
    proto.endInput = function(...args) {
        const result = originalEndInput.apply(this, args);
        restoreSheldLayer(this);
        return result;
    };

    const originalUnrender = proto.unrender;
    proto.unrender = function(...args) {
        const result = originalUnrender.apply(this, args);
        restoreSheldLayer(this);
        return result;
    };

    const originalRenderStartupLoading = proto.renderStartupLoading;
    proto.renderStartupLoading = function(...args) {
        const keepSlow = this.useSlowConnectionMode || this.startupFastTrackRequested;
        const result = originalRenderStartupLoading.apply(this, args);
        if (keepSlow) {
            this.useSlowConnectionMode = true;
            this.startupFastTrackRequested = true;
            this.getStartupFastTrackPromise?.();
            if (this.startupSlowModeButtonEl) {
                this.startupSlowModeButtonEl.disabled = true;
                this.startupSlowModeButtonEl.textContent = 'Slow Connection Mode enabled';
            }
        }
        updateEtaLine(this);
        return result;
    };

    const originalSetStartupLoadingProgress = proto.setStartupLoadingProgress;
    proto.setStartupLoadingProgress = function(...args) {
        const result = originalSetStartupLoadingProgress.apply(this, args);
        updateEtaLine(this);
        return result;
    };

    const style = document.createElement('style');
    style.textContent = `
        body:not(:has(.stlp--container)) #sheld { z-index: auto !important; }
        .stlp--startupLoadingEta {
            margin-top: 0.55rem;
            max-width: min(720px, 88vw);
            font-size: 0.88em;
            line-height: 1.35;
            opacity: 0.78;
            text-align: center;
        }
    `;
    document.head.append(style);
};

setTimeout(()=>{
    patchLandingPageRuntime().catch(err=>console.warn('[STL] ETA patch failed', err));
}, 0);
