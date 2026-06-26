export const waitForFrame = async()=>new Promise(resolve=>requestAnimationFrame(resolve));

const patchLandingPageRuntime = async()=>{
    try {
        const { LandingPage } = await import('./LandingPage.js');
        const proto = LandingPage?.prototype;
        if (!proto || proto.__stlpRuntimeFixesPatched) return;

        Object.defineProperty(proto, '__stlpRuntimeFixesPatched', {
            value: true,
            configurable: false,
        });

        const formatDuration = (seconds)=>{
            if (!Number.isFinite(seconds) || seconds < 0) return 'calculating…';
            seconds = Math.max(1, Math.round(seconds));
            if (seconds < 60) return `${seconds}s`;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        };

        const getProgressEtaSeconds = (instance)=>{
            const startedAt = instance.__stlpStartupEtaStartedAt;
            const progress = Number(instance.startupLoadingProgress ?? 0);
            if (!startedAt || progress <= 8 || progress >= 100) return null;
            const elapsedSeconds = (performance.now() - startedAt) / 1000;
            return elapsedSeconds * ((100 - progress) / progress);
        };

        const getThumbnailEtaSeconds = (instance)=>{
            const stats = instance.__stlpThumbnailEta;
            if (!stats || !stats.total || !stats.index || stats.index >= stats.total) return null;
            const elapsedSeconds = (performance.now() - stats.startedAt) / 1000;
            if (elapsedSeconds <= 0) return null;
            const completed = Math.max(1, stats.index);
            return (elapsedSeconds / completed) * (stats.total - completed);
        };

        const updateStartupEta = (instance)=>{
            const etaEl = instance?.startupEtaEl;
            if (!etaEl) return;

            if (Number(instance.startupLoadingProgress ?? 0) >= 100) {
                etaEl.textContent = 'Ready now.';
                return;
            }

            const progressEta = getProgressEtaSeconds(instance);
            const thumbnailEta = getThumbnailEtaSeconds(instance);
            const normalEta = thumbnailEta ?? progressEta;

            if (instance.useSlowConnectionMode || instance.startupFastTrackRequested) {
                const slowEta = progressEta === null ? 3 : Math.min(progressEta, 12);
                etaEl.textContent = `Slow mode: about ${formatDuration(slowEta)} remaining. Normal mode would be about ${formatDuration(normalEta ?? 45)}.`;
            } else {
                const slowModeEta = Math.min(progressEta ?? normalEta ?? 12, 12);
                etaEl.textContent = `Estimated remaining: ${formatDuration(normalEta ?? progressEta)}. Slow mode would be about ${formatDuration(slowModeEta)}.`;
            }
        };

        const ensureStartupEta = (instance)=>{
            if (!instance?.startupLoadingEl) return;
            if (instance.startupEtaEl?.isConnected) return;

            const eta = document.createElement('div');
            instance.startupEtaEl = eta;
            eta.classList.add('stlp--startupLoadingEta');
            eta.textContent = 'Estimated remaining: calculating…';

            const progress = instance.startupLoadingEl.querySelector('.stlp--startupLoadingProgress');
            progress?.insertAdjacentElement('afterend', eta);
            updateStartupEta(instance);
        };

        const restoreSheldLayer = (instance)=>{
            if (!instance?.sheld) return;
            instance.sheld.style.zIndex = '';
            if (!instance.dom) {
                instance.sheld.style.opacity = '';
                instance.sheld.style.pointerEvents = '';
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

        const originalRequestStartupFastTrack = proto.requestStartupFastTrack;
        proto.requestStartupFastTrack = function(...args) {
            this.useSlowConnectionMode = true;
            this.startupFastTrackRequested = true;
            this.getStartupFastTrackPromise?.();
            ensureStartupEta(this);

            const result = originalRequestStartupFastTrack.apply(this, args);

            this.startupFastTrackResolver?.('slow-mode');
            this.startupFastTrackResolver = null;
            updateStartupEta(this);
            return result;
        };

        const originalRenderStartupLoading = proto.renderStartupLoading;
        proto.renderStartupLoading = function(...args) {
            const hadFastTrackRequest = this.useSlowConnectionMode || this.startupFastTrackRequested;
            const result = originalRenderStartupLoading.apply(this, args);

            this.__stlpStartupEtaStartedAt = performance.now();
            this.__stlpThumbnailEta = null;
            ensureStartupEta(this);

            if (hadFastTrackRequest) {
                this.useSlowConnectionMode = true;
                this.startupFastTrackRequested = true;
                this.getStartupFastTrackPromise?.();
                if (this.startupSlowModeButtonEl) {
                    this.startupSlowModeButtonEl.disabled = true;
                    this.startupSlowModeButtonEl.textContent = 'Slow Connection Mode enabled';
                }
            }

            updateStartupEta(this);
            return result;
        };

        const originalSetStartupLoadingProgress = proto.setStartupLoadingProgress;
        proto.setStartupLoadingProgress = function(...args) {
            const result = originalSetStartupLoadingProgress.apply(this, args);
            ensureStartupEta(this);
            updateStartupEta(this);
            return result;
        };

        const originalSetStartupLoadingDetail = proto.setStartupLoadingDetail;
        proto.setStartupLoadingDetail = function(detail, ...args) {
            const match = String(detail ?? '').match(/Loading thumbnails\s+(\d+)\/(\d+)/i);
            if (match) {
                const index = Number(match[1]);
                const total = Number(match[2]);
                const existing = this.__stlpThumbnailEta;
                this.__stlpThumbnailEta = {
                    startedAt: existing?.total === total ? existing.startedAt : performance.now(),
                    index,
                    total,
                };
            }

            const result = originalSetStartupLoadingDetail.apply(this, [detail, ...args]);
            ensureStartupEta(this);
            updateStartupEta(this);
            return result;
        };

        const originalTeardownStartupLoading = proto.teardownStartupLoading;
        proto.teardownStartupLoading = function(...args) {
            const result = originalTeardownStartupLoading.apply(this, args);
            this.startupEtaEl = null;
            this.__stlpThumbnailEta = null;
            return result;
        };

        const styleId = 'stlp-runtime-layer-fixes';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                body:not(:has(.stlp--container)) #sheld { z-index: auto !important; }
                .stlp--startupLoadingEta {
                    margin-top: 0.55rem;
                    font-size: 0.9em;
                    opacity: 0.78;
                    text-align: center;
                }
            `;
            document.head.append(style);
        }
    } catch (err) {
        console.warn('[STL] Runtime fixes failed to install', err);
    }
};

setTimeout(()=>{
    patchLandingPageRuntime();
}, 0);
