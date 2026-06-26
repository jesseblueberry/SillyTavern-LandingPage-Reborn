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

            const result = originalRequestStartupFastTrack.apply(this, args);

            this.startupFastTrackResolver?.('slow-mode');
            this.startupFastTrackResolver = null;
            return result;
        };

        const originalRenderStartupLoading = proto.renderStartupLoading;
        proto.renderStartupLoading = function(...args) {
            const hadFastTrackRequest = this.useSlowConnectionMode || this.startupFastTrackRequested;
            const result = originalRenderStartupLoading.apply(this, args);

            if (hadFastTrackRequest) {
                this.useSlowConnectionMode = true;
                this.startupFastTrackRequested = true;
                this.getStartupFastTrackPromise?.();
                if (this.startupSlowModeButtonEl) {
                    this.startupSlowModeButtonEl.disabled = true;
                    this.startupSlowModeButtonEl.textContent = 'Slow Connection Mode enabled';
                }
            }

            return result;
        };

        const styleId = 'stlp-runtime-layer-fixes';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = 'body:not(:has(.stlp--container)) #sheld { z-index: auto !important; }';
            document.head.append(style);
        }
    } catch (err) {
        console.warn('[STL] Runtime fixes failed to install', err);
    }
};

setTimeout(()=>{
    patchLandingPageRuntime();
}, 0);
