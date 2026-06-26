import { characters, getRequestHeaders, messageFormatting, selectCharacterById, setActiveCharacter, setActiveGroup, setCharacterId, substituteParams } from '../../../../../script.js';
import { groups, openGroupById } from '../../../../group-chats.js';
import { applyTagsOnCharacterSelect } from '../../../../tags.js';
import { Member } from './Member.js';
import { waitForFrame } from './wait.js';

const makeAvatarImage = (src)=>{
    const img = document.createElement('img');
    img.classList.add('stlp--avatarImg', 'stlp--lazyAvatarImg');
    if (src) img.src = src;
    return img;
};

const fitAvatarImage = (img)=>{
    const naturalHeight = img.naturalHeight || 144;
    const naturalWidth = img.naturalWidth || 96;
    img.style.width = `calc(var(--stlp--cardHeight) / ${naturalHeight} * ${naturalWidth})`;
    img.style.flex = `0 0 calc(var(--stlp--cardHeight) / ${naturalHeight} * ${naturalWidth})`;
    img.style.marginRight = `calc(var(--stlp--cardHeight) / ${naturalHeight} * ${naturalWidth} / -2)`;
};

const loadDomImage = async(img, sources, { signal = null, onProgress = null } = {})=>{
    return new Promise(resolve=>{
        let sourceIndex = 0;
        let progress = 8;
        const cleanup = ()=>{
            clearInterval(timer);
            img.removeEventListener('load', handleLoad);
            img.removeEventListener('error', handleError);
            signal?.removeEventListener('abort', handleAbort);
        };
        const trySource = ()=>{
            if (signal?.aborted || sourceIndex >= sources.length) {
                cleanup();
                resolve(false);
                return;
            }
            progress = Math.max(progress, sourceIndex === 0 ? 8 : 45);
            onProgress?.(progress);
            img.src = sources[sourceIndex];
        };
        const handleLoad = ()=>{
            cleanup();
            fitAvatarImage(img);
            onProgress?.(100);
            resolve(true);
        };
        const handleError = ()=>{
            sourceIndex++;
            trySource();
        };
        const handleAbort = ()=>{
            cleanup();
            resolve(false);
        };
        const timer = setInterval(()=>{
            progress = Math.min(92, progress + 3);
            onProgress?.(progress);
        }, 180);
        img.addEventListener('load', handleLoad);
        img.addEventListener('error', handleError);
        signal?.addEventListener('abort', handleAbort, { once:true });
        trySource();
    });
};

export class Card {
    /**@type {String}*/ name;
    /**@type {Member[]}*/ members;
    /**@type {Boolean}*/ isGroup;
    /**@type {String}*/ avatar;
    /**@type {Number}*/ lastChatDate;
    /**@type {String}*/ lastChatId;
    /**@type {Boolean}*/ isFavorite;

    /**@type {Function}*/ openChat;
    /**@type {String}*/ chatEndpoint;
    /**@type {Object}*/ getChatBody;

    /**@type {Member[]}*/ lastMembers;
    /**@type {Object}*/ lastMessage;
    /**@type {Object}*/ chatMetadata;
    /**@type {HTMLImageElement}*/ avatarImg;

    /**@type {Boolean}*/ isLoaded = false;
    /**@type {Boolean}*/ isAvatarLoaded = false;
    /**@type {Boolean}*/ isAvatarLoading = false;
    /**@type {Array<{src:string,width:string,flex:string,marginRight:string}>}*/ avatarImageData = [];

    /**@type {HTMLElement}*/ dom;
    /**@type {HTMLElement}*/ domName;
    /**@type {HTMLElement}*/ domAvatar;

    /**@type {Function}*/ onOpenChat;




    constructor(char) {
        if (char.members) {
            this.isGroup = true;
            this.avatar = char.avatar_url;
            this.members = char.members.map(m=>Member.getByAvatar(m));
            this.openChat = ()=>{
                openGroupById(char.id);
                setActiveCharacter(null);
                setActiveGroup(char.id);
            };
            this.chatEndpoint = '/api/chats/group';
            this.getChatBody = {
                id: char.chat_id,
            };
        } else {
            this.isGroup = false;
            this.avatar = char.avatar;
            this.members = [Member.getByAvatar(char.avatar)];
            this.openChat = ()=>{
                const id = String(characters.findIndex(it=>it == char));
                selectCharacterById(id);
                const tagWorkaround = document.createElement('div');
                tagWorkaround.setAttribute('chid', id);
                applyTagsOnCharacterSelect.call(tagWorkaround);
                setActiveCharacter(this.avatar);
                setActiveGroup(null);
            };
            this.chatEndpoint = '/api/chats';
            this.getChatBody = {
                ch_name: char.name,
                file_name: char.chat,
                avatar_url: char.avatar,
            };
        }
        this.name = char.name;
        this.lastChatDate = char.date_last_chat;
        this.lastChatId = char.chat;
        this.isFavorite = char.fav;
    }


    getCharByName(name) {
        return characters.find(it=>it.name == name);
    }
    getCharByAvatar(avatar) {
        return characters.find(it=>it.avatar == avatar);
    }


    async reload() {
        this.isLoaded = false;
        await this.load();
    }
    async load({ signal } = {}) {
        if (this.isLoaded) return;
        let response;
        try {
            response = await fetch(`${this.chatEndpoint}/get`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(this.getChatBody),
                cache: 'no-cache',
                signal,
            });
        } catch (err) {
            if (signal?.aborted) return this;
            throw err;
        }
        if (response.ok) {
            let mesList = await response.json() ?? [];
            if (signal?.aborted) return this;
            if (!Array.isArray(mesList)) mesList = [];
            this.updateLastMembers(mesList);
            this.lastMessage = mesList.slice(-1)[0];
            this.chatMetadata = this.isGroup ? groups.find(it=>it.name == this.name).chat_metadata : mesList[0]?.['chat_metadata'] ?? {};
            this.isLoaded = true;
        }
        return this;
    }

    async loadAvatar() {
        return new Promise((resolve, reject)=>{
            const img = new Image();
            this.avatarImg = img;
            img.addEventListener('load', ()=>resolve(img));
            img.addEventListener('error', ()=>reject());
            img.src = this.isGroup ? this.avatar : `/characters/${this.avatar}`;
        });
    }

    updateLastMembers(mesList) {
        if (this.isGroup) {
            const chars = mesList
                .slice(1)
                .filter(it=>!it.is_user && !it.is_system)
                .map(it=>Member.getByName(it.name))
                .filter(it=>it)
                .toReversed()
                .slice(0,25)
            ;
            const members = [];
            for (const c of chars) {
                if (!members.includes(c)) {
                    members.push(c);
                }
            }
            while (members.length < this.members.length) {
                const mems = this.members.filter(it=>!members.includes(it));
                members.push(mems[Math.floor(Math.random() * mems.length)]);
            }
            this.lastMembers = members;
        } else {
            this.lastMembers = this.members.slice();
        }
    }

    getLastMembers(num) {
        const source = this.lastMembers?.length ? this.lastMembers : this.members;
        return (source ?? []).filter(Boolean).slice(0, num);
    }

    setAvatarProgress(value) {
        if (!this.domAvatar) return;
        this.domAvatar.style.setProperty('--stlp--avatarLoadProgress', `${Math.max(0, Math.min(100, value))}%`);
    }

    getMemberSources(mem, settings) {
        const avatarUrl = `/characters/${mem.avatar}`;
        if (!settings.showExpression) return [avatarUrl];
        const costume = this.chatMetadata?.triggerCards?.costumes?.[mem.name] ?? mem.name;
        const expressionUrls = (settings.extensions ?? ['png']).map(ext=>`/characters/${costume}/${settings.expression}.${ext}`);
        return [...expressionUrls, avatarUrl];
    }

    getCardSources(settings) {
        if (this.isGroup) return [this.avatar];
        const member = this.members.find(Boolean);
        return member ? this.getMemberSources(member, settings) : [`/characters/${this.avatar}`];
    }

    restoreHydratedAvatar() {
        if (!this.domAvatar || !this.avatarImageData.length) return;
        this.domAvatar.dataset.stlpLoaded = 'true';
        this.domAvatar.querySelector('.stlp--avatarPlaceholder')?.remove();
        this.domAvatar.querySelector('.stlp--avatarProgress')?.remove();
        this.avatarImageData.forEach(data=>{
            const img = document.createElement('img');
            img.classList.add('stlp--avatarImg', 'stlp--lazyAvatarImg', 'stlp--loaded');
            img.style.width = data.width;
            img.style.flex = data.flex;
            img.style.marginRight = data.marginRight;
            img.src = data.src;
            this.domAvatar.append(img);
        });
    }

    async hydrateAvatar(settings, { signal = null, onProgress = null } = {}) {
        if (!this.domAvatar || this.isAvatarLoaded || this.isAvatarLoading) return;
        this.isAvatarLoading = true;
        this.domAvatar.dataset.stlpLoading = 'true';
        this.domAvatar.classList.add('stlp--lazyAvatarLoading');
        this.setAvatarProgress(5);
        onProgress?.(5);

        const placeholder = this.domAvatar.querySelector('.stlp--avatarPlaceholder');
        const imgs = [];
        try {
            if (this.isGroup && settings.showExpression) {
                const members = this.getLastMembers(settings.numAvatars);
                const total = Math.max(members.length, 1);
                for (let i = 0; i < members.length; i++) {
                    if (signal?.aborted) return;
                    const mem = members[i];
                    const img = makeAvatarImage('');
                    this.domAvatar.append(img);
                    imgs.push(img);
                    const loaded = await loadDomImage(img, this.getMemberSources(mem, settings), {
                        signal,
                        onProgress: progress=>{
                            const cardProgress = Math.round(((i + (progress / 100)) / total) * 90);
                            this.setAvatarProgress(cardProgress);
                            onProgress?.(cardProgress);
                        },
                    });
                    if (loaded) {
                        img.classList.add('stlp--loaded');
                    } else {
                        img.remove();
                        imgs.splice(imgs.indexOf(img), 1);
                    }
                    const progress = Math.round(((i + 1) / total) * 90);
                    this.setAvatarProgress(progress);
                    onProgress?.(progress);
                }
            } else {
                const img = makeAvatarImage('');
                this.domAvatar.append(img);
                imgs.push(img);
                const loaded = await loadDomImage(img, this.getCardSources(settings), {
                    signal,
                    onProgress: progress=>{
                        this.setAvatarProgress(progress);
                        onProgress?.(progress);
                    },
                });
                if (loaded) {
                    img.classList.add('stlp--loaded');
                } else {
                    img.remove();
                    imgs.splice(imgs.indexOf(img), 1);
                }
            }

            if (!imgs.length || !this.domAvatar?.isConnected || signal?.aborted) return;
            await waitForFrame();
            imgs.forEach(img=>img.classList.add('stlp--loaded'));
            this.avatarImageData = imgs.map(img=>({
                src: img.src,
                width: img.style.width,
                flex: img.style.flex,
                marginRight: img.style.marginRight,
            }));
            this.isAvatarLoaded = true;
            this.domAvatar.dataset.stlpLoaded = 'true';
            this.setAvatarProgress(100);
            onProgress?.(100);
            setTimeout(()=>placeholder?.remove(), 450);
        } catch (err) {
            if (!signal?.aborted) {
                console.warn('[STL] lazy avatar failed', this.name, err);
            }
        } finally {
            this.isAvatarLoading = false;
            this.domAvatar?.classList.remove('stlp--lazyAvatarLoading');
            delete this.domAvatar?.dataset.stlpLoading;
        }
    }


    async goToChat() {
        if (this.onOpenChat) this.onOpenChat();
        /**@type {HTMLElement} */
        // @ts-ignore
        const clone = this.dom.cloneNode(true);
        Array.from(clone.querySelectorAll('.stlp--mes')).forEach(it=>it.remove());
        const rect = this.dom.getBoundingClientRect();
        const avaRect = this.domAvatar.getBoundingClientRect();
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${avaRect.width}px`;
        clone.style.height = `${avaRect.height + this.domName.offsetHeight}px`;
        clone.classList.add('stlp--clone');
        clone.classList.add('stlp--pulse');
        this.dom.parentElement?.append(clone);
        await waitForFrame();
        const fact = Math.min(window.innerWidth / avaRect.width, window.innerHeight / (rect.height - this.domName.offsetHeight));
        clone.style.scale = `${fact}`;
        const offsetLeft = (window.innerWidth / 2) - (avaRect.width * fact / 2) - rect.left;
        const offsetTop = rect.top + this.domName.offsetHeight * fact;
        clone.style.translate = `${offsetLeft}px -${offsetTop}px`;
        this.openChat();
    }


    async render(settings) {
        const wrap = document.createElement('div'); {
            this.dom = wrap;
            wrap.classList.add('stlp--cardWrap');
            const item = document.createElement('div'); {
                item.classList.add('stlp--card');
                if (this.isFavorite) {
                    item.classList.add('stlp--favorite');
                }
                item.addEventListener('click', ()=>this.goToChat());
                item.addEventListener('wheel', async(evt)=>{
                    message.scrollTop += evt.deltaY;
                });
                const name = document.createElement('div'); {
                    this.domName = name;
                    name.classList.add('stlp--name');
                    name.textContent = this.name;
                    item.append(name);
                }
                const ava = document.createElement('div'); {
                    this.domAvatar = ava;
                    ava.classList.add('stlp--avatar', 'stlp--lazyAvatar');
                    ava.style.setProperty('--stlp--avatarLoadProgress', '0%');
                    const placeholder = document.createElement('div'); {
                        placeholder.classList.add('stlp--avatarPlaceholder', 'stlp--avatarPlaceholderName');
                        placeholder.textContent = this.name || (this.isGroup ? 'Group' : 'Character');
                        placeholder.title = this.name;
                        ava.append(placeholder);
                    }
                    const progress = document.createElement('div'); {
                        progress.classList.add('stlp--avatarProgress');
                        ava.append(progress);
                    }
                    if (this.isAvatarLoaded) {
                        this.restoreHydratedAvatar();
                    }
                    item.append(ava);
                }
                wrap.append(item);
            }
            const message = document.createElement('div'); {
                message.classList.add('stlp--mes');
                message.classList.add('mes_text');
                if (this.lastMessage) {
                    let messageText = substituteParams(this.lastMessage.mes ?? '');
                    // setCharacterId(-1);
                    messageText = messageFormatting(
                        messageText,
                        this.lastMessage.name,
                        false,
                        this.lastMessage.is_user,
                        null,
                    );
                    // setCharacterId(undefined);
                    message.innerHTML = messageText;
                }
                wrap.append(message);
            }
        }
        return wrap;
    }
}
