import { characters } from '../../../../../script.js';
import { groups } from '../../../../group-chats.js';
import { Card } from './Card.js';
import { LandingPage } from './LandingPage.js';
import { waitForFrame } from './wait.js';

const seenSettings = (lp)=>({ ...lp.settings, lazyLoadAvatars:true, loadAvatars:false, showExpression:false });
const realSettings = (lp)=>({ ...lp.settings, lazyLoadAvatars:false, loadAvatars:true });

const makeImg = (memImg)=>{
    const img = document.createElement('img');
    img.classList.add('stlp--avatarImg', 'stlp--lazyAvatarImg');
    img.style.width = `calc(var(--stlp--cardHeight) / ${memImg.naturalHeight} * ${memImg.naturalWidth})`;
    img.style.flex = `0 0 calc(var(--stlp--cardHeight) / ${memImg.naturalHeight} * ${memImg.naturalWidth})`;
    img.style.marginRight = `calc(var(--stlp--cardHeight) / ${memImg.naturalHeight} * ${memImg.naturalWidth} / -2)`;
    img.src = memImg.src;
    return img;
};

const installStyles = ()=>{
    if (document.getElementById('stlp-lazy-card-style')) return;
    const style = document.createElement('style');
    style.id = 'stlp-lazy-card-style';
    style.textContent = `
        .stlp--avatar.stlp--lazyAvatar {
            position: relative;
            display: flex;
            justify-content: center;
            overflow: hidden;
        }
        .stlp--avatar.stlp--lazyAvatar > .stlp--avatarPlaceholder {
            position: absolute;
            inset: 0;
            z-index: 1;
            padding: 0.7em;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            text-wrap: balance;
        }
        .stlp--avatar.stlp--lazyAvatar > .stlp--lazyAvatarImg {
            opacity: 0;
            transition: opacity 420ms ease;
            z-index: 2;
        }
        .stlp--avatar.stlp--lazyAvatar > .stlp--lazyAvatarImg.stlp--loaded {
            opacity: 1;
        }
        .stlp--avatar.stlp--lazyAvatarLoading > .stlp--avatarPlaceholder {
            opacity: 0.45;
        }
        body:not(:has(.stlp--container)) #sheld { z-index: auto !important; }
    `;
    document.head.append(style);
};

const patchCard = ()=>{
    if (Card.prototype.__stlpLazyCardPatched) return;
    Object.defineProperty(Card.prototype, '__stlpLazyCardPatched', { value:true });

    const originalRender = Card.prototype.render;
    const originalGetLastMembers = Card.prototype.getLastMembers;

    Card.prototype.getLastMembers = function(num) {
        const source = this.lastMembers?.length ? this.lastMembers : this.members;
        return (source ?? []).filter(Boolean).slice(0, num);
    };

    Card.prototype.hydrateAvatar = async function(settings = {}) {
        if (!this.domAvatar || this.domAvatar.dataset.stlpLoaded === 'true' || this.domAvatar.dataset.stlpLoading === 'true') return;
        this.domAvatar.dataset.stlpLoading = 'true';
        this.domAvatar.classList.add('stlp--lazyAvatarLoading');
        const placeholder = this.domAvatar.querySelector('.stlp--avatarPlaceholder');
        try {
            const imgs = [];
            if (settings.showExpression) {
                const members = this.getLastMembers(settings.numAvatars);
                await Promise.all(members.map(async(mem)=>{
                    const memImg = await mem.loadExpression(settings.expression, this.chatMetadata?.triggerCards?.costumes?.[mem.name]);
                    imgs.push(makeImg(memImg));
                }));
            } else {
                const memImg = await this.loadAvatar();
                imgs.push(makeImg(memImg));
            }
            if (!this.domAvatar?.isConnected) return;
            imgs.forEach(img=>this.domAvatar.append(img));
            await waitForFrame();
            imgs.forEach(img=>img.classList.add('stlp--loaded'));
            this.domAvatar.dataset.stlpLoaded = 'true';
            setTimeout(()=>placeholder?.remove(), 450);
        } catch (err) {
            console.warn('[STL] lazy avatar failed', this.name, err);
        } finally {
            this.domAvatar?.classList.remove('stlp--lazyAvatarLoading');
            delete this.domAvatar?.dataset.stlpLoading;
        }
    };

    Card.prototype.render = async function(settings) {
        if (!settings.lazyLoadAvatars) return originalRender.call(this, settings);
        const wrap = document.createElement('div');
        this.dom = wrap;
        wrap.classList.add('stlp--cardWrap');
        const item = document.createElement('div');
        item.classList.add('stlp--card');
        if (this.isFavorite) item.classList.add('stlp--favorite');
        item.addEventListener('click', ()=>this.goToChat());

        const name = document.createElement('div');
        this.domName = name;
        name.classList.add('stlp--name');
        name.textContent = this.name;
        item.append(name);

        const ava = document.createElement('div');
        this.domAvatar = ava;
        ava.classList.add('stlp--avatar', 'stlp--lazyAvatar');
        const placeholder = document.createElement('div');
        placeholder.classList.add('stlp--avatarPlaceholder', 'stlp--avatarPlaceholderName');
        placeholder.textContent = this.name || (this.isGroup ? 'Group' : 'Character');
        placeholder.title = this.name;
        ava.append(placeholder);
        item.append(ava);
        wrap.append(item);

        const message = document.createElement('div');
        message.classList.add('stlp--mes', 'mes_text');
        wrap.append(message);
        return wrap;
    };
};

const patchLandingPage = ()=>{
    if (LandingPage.prototype.__stlpLazyLandingPatched) return;
    Object.defineProperty(LandingPage.prototype, '__stlpLazyLandingPatched', { value:true });

    LandingPage.prototype.load = async function() {
        this.setStartupLoadingProgress(12, 'Gathering cards…');
        this.setStartupLoadingDetail('Building text-first cards. Images will lazy-load as they appear.');
        const compRecent = (a,b)=>{
            if (this.settings.showFavorites) {
                if (a.char.fav && !b.char.fav) return -1;
                if (!a.char.fav && b.char.fav) return 1;
            }
            return (b.char.date_last_chat ?? 0) - (a.char.date_last_chat ?? 0);
        };
        if (this.settings.numCards > 0) {
            const entries = [...characters, ...groups]
                .filter(it=>!this.settings.onlyFavorites || it.fav)
                .map(char=>{
                    const card = new Card(char);
                    card.onOpenChat = ()=>this.dom.classList.add('stlp--busy');
                    return { char, card };
                });
            const byRecent = entries.toSorted(compRecent);
            const byFavorites = byRecent.filter(it=>it.card.isFavorite);
            this.cardEntries = new Map(entries.map(it=>[it.card, it]));
            this.cardsByCategory = {
                favorites: byFavorites.map(it=>it.card).slice(0, this.settings.numCards),
                recents: byRecent.map(it=>it.card).slice(0, this.settings.numCards),
                search: byRecent.map(it=>it.card),
            };
            this.availableTags = this.getAvailableTags(this.cardsByCategory.search);
            this.updateSearchResults();
            this.cards = this.activeCategory === 'search'
                ? this.searchResults.slice(0, this.settings.numCards)
                : (this.cardsByCategory[this.activeCategory] ?? []);
            this.setStartupLoadingProgress(82, 'Dealing your hand…');
            this.setStartupLoadingDetail('Cards are ready. Loading images only when they are seen.');
        } else {
            this.cards = [];
            this.cardEntries = new Map();
            this.searchResults = [];
            this.availableTags = [];
            this.cardsByCategory = { favorites:[], recents:[], search:[] };
        }
    };

    LandingPage.prototype.resetLazyAvatarLoader = function() {
        this.lazyAvatarObserver?.disconnect();
        this.lazyAvatarObserver = null;
        this.lazyAvatarQueue = [];
        this.lazyAvatarLoading = false;
    };

    LandingPage.prototype.enqueueLazyAvatar = function(card, index) {
        if (!card?.dom?.isConnected || card.domAvatar?.dataset.stlpLoaded === 'true') return;
        if (this.lazyAvatarQueue?.some(item=>item.card === card)) return;
        this.lazyAvatarQueue ??= [];
        this.lazyAvatarQueue.push({ card, index, seenAt:performance.now() });
        this.processLazyAvatarQueue();
    };

    LandingPage.prototype.processLazyAvatarQueue = async function() {
        if (this.lazyAvatarLoading) return;
        this.lazyAvatarLoading = true;
        this.lazyAvatarQueue ??= [];
        while (this.lazyAvatarQueue.length) {
            this.lazyAvatarQueue.sort((a,b)=>a.seenAt - b.seenAt || a.index - b.index);
            const { card } = this.lazyAvatarQueue.shift();
            if (!card.dom?.isConnected || card.domAvatar?.dataset.stlpLoaded === 'true') continue;
            await card.hydrateAvatar(realSettings(this));
            await waitForFrame();
        }
        this.lazyAvatarLoading = false;
    };

    LandingPage.prototype.observeLazyAvatar = function(root, card, index) {
        if (!this.lazyAvatarObserver && 'IntersectionObserver' in window) {
            this.lazyAvatarObserver = new IntersectionObserver(entries=>{
                entries
                    .filter(entry=>entry.isIntersecting)
                    .sort((a,b)=>Number(a.target.dataset.stlpIndex ?? 0) - Number(b.target.dataset.stlpIndex ?? 0))
                    .forEach(entry=>{
                        this.lazyAvatarObserver?.unobserve(entry.target);
                        this.enqueueLazyAvatar(entry.target.__stlpCard, Number(entry.target.dataset.stlpIndex ?? 0));
                    });
            }, { root, rootMargin:'500px 300px', threshold:0.01 });
        }
        card.dom.dataset.stlpIndex = String(index);
        card.dom.__stlpCard = card;
        if (this.lazyAvatarObserver) {
            this.lazyAvatarObserver.observe(card.dom);
        } else {
            this.enqueueLazyAvatar(card, index);
        }
    };

    LandingPage.prototype.renderCardsForCategory = async function(root, category) {
        this.resetLazyAvatarLoader();
        root.setAttribute('data-category', category);
        root.innerHTML = '';
        this.cards = category === 'search'
            ? this.searchResults.slice(0, this.settings.numCards)
            : (this.cardsByCategory[category] ?? []);
        const els = [];
        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            const el = await card.render(seenSettings(this));
            els.push(el);
        }
        els.forEach((el, index)=>{
            root.append(el);
            this.observeLazyAvatar(root, this.cards[index], index);
        });
    };

    const originalRenderStartupLoading = LandingPage.prototype.renderStartupLoading;
    LandingPage.prototype.renderStartupLoading = function(...args) {
        const out = originalRenderStartupLoading.apply(this, args);
        this.startupSlowModeButtonEl?.remove();
        this.startupSlowModeButtonEl = null;
        this.setStartupLoadingDetail('Preparing text-first cards. Images lazy-load after the page opens.');
        return out;
    };

    const originalUnrender = LandingPage.prototype.unrender;
    LandingPage.prototype.unrender = function(...args) {
        this.resetLazyAvatarLoader?.();
        const out = originalUnrender.apply(this, args);
        if (this.sheld) {
            this.sheld.style.zIndex = '';
            this.sheld.style.opacity = '';
            this.sheld.style.pointerEvents = '';
        }
        return out;
    };

    const originalEndInput = LandingPage.prototype.endInput;
    LandingPage.prototype.endInput = function(...args) {
        const out = originalEndInput.apply(this, args);
        if (this.sheld) this.sheld.style.zIndex = '';
        return out;
    };
};

installStyles();
patchCard();
patchLandingPage();
