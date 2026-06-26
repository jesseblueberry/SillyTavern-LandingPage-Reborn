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

const fitAvatarImage = (img, naturalSource = img)=>{
    const naturalHeight = naturalSource.naturalHeight || 144;
    const naturalWidth = naturalSource.naturalWidth || 96;
    img.style.width = `calc(var(--stlp--cardHeight) / ${naturalHeight} * ${naturalWidth})`;
    img.style.flex = `0 0 calc(var(--stlp--cardHeight) / ${naturalHeight} * ${naturalWidth})`;
    img.style.marginRight = `calc(var(--stlp--cardHeight) / ${naturalHeight} * ${naturalWidth} / -2)`;
};

const makeAvatarThumbnailUrl = (avatar)=>`/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`;
const makeAvatarOriginalUrl = (avatar)=>`/characters/${avatar}`;

const loadDomImage = async(img, sources, { signal = null } = {})=>{
    return new Promise(resolve=>{
        let sourceIndex = 0;
        const cleanup = ()=>{
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
            img.src = sources[sourceIndex];
        };
        const handleLoad = ()=>{
            cleanup();
            fitAvatarImage(img);
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
        img.addEventListener('load', handleLoad);
        img.addEventListener('error', handleError);
        signal?.addEventListener('abort', handleAbort, { once:true });
        trySource();
    });
};

const preloadImage = async(src, { signal = null } = {})=>{
    return new Promise(resolve=>{
        const img = new Image();
        const cleanup = ()=>{
            img.removeEventListener('load', handleLoad);
            img.removeEventListener('error', handleError);
            signal?.removeEventListener('abort', handleAbort);
        };
        const handleLoad = ()=>{
            cleanup();
            resolve(img);
        };
        const handleError = ()=>{
            cleanup();
            resolve(null);
        };
        const handleAbort = ()=>{
            cleanup();
            resolve(null);
        };
        img.addEventListener('load', handleLoad);
        img.addEventListener('error', handleError);
        signal?.addEventListener('abort', handleAbort, { once:true });
        if (signal?.aborted) {
            handleAbort();
            return;
        }
        img.src = src;
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
    /**@type {Boolean}*/ isLoaded = false;
    /**@type {Boolean}*/ isAvatarLoaded = false;
    /**@type {Boolean}*/ isAvatarLoading = false;
    /**@type {Boolean}*/ isAvatarUpgraded = false;
    /**@type {Boolean}*/ isAvatarUpgrading = false;
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

    getCardSources() {
        if (this.isGroup) return [this.avatar];
        const member = this.members.find(Boolean);
        const avatar = member?.avatar ?? this.avatar;
        return [
            makeAvatarThumbnailUrl(avatar),
            makeAvatarOriginalUrl(avatar),
        ];
    }

    getAvatarUpgradeSource() {
        if (this.isGroup) return null;
        const member = this.members.find(Boolean);
        const avatar = member?.avatar ?? this.avatar;
        return makeAvatarOriginalUrl(avatar);
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

    async hydrateAvatar(settings, { signal = null } = {}) {
        if (!this.domAvatar || this.isAvatarLoaded || this.isAvatarLoading) return;
        this.isAvatarLoading = true;
        this.domAvatar.dataset.stlpLoading = 'true';
        this.domAvatar.classList.add('stlp--lazyAvatarLoading');

        const placeholder = this.domAvatar.querySelector('.stlp--avatarPlaceholder');
        const imgs = [];
        try {
            const img = makeAvatarImage('');
            this.domAvatar.append(img);
            imgs.push(img);
            const loaded = await loadDomImage(img, this.getCardSources(), { signal });
            if (loaded) {
                img.classList.add('stlp--loaded');
            } else {
                img.remove();
                imgs.splice(imgs.indexOf(img), 1);
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

    async upgradeAvatarQuality({ signal = null } = {}) {
        if (!this.domAvatar || !this.isAvatarLoaded || this.isAvatarUpgraded || this.isAvatarUpgrading) return;
        const src = this.getAvatarUpgradeSource();
        if (!src) return;
        const currentImg = this.domAvatar.querySelector('.stlp--lazyAvatarImg.stlp--loaded');
        if (!currentImg || currentImg.getAttribute('src') === src) {
            this.isAvatarUpgraded = true;
            return;
        }
        this.isAvatarUpgrading = true;
        try {
            const fullImage = await preloadImage(src, { signal });
            if (!fullImage || signal?.aborted || !this.domAvatar?.isConnected) return;
            fitAvatarImage(currentImg, fullImage);
            currentImg.src = src;
            currentImg.classList.add('stlp--avatarImgUpgraded');
            this.avatarImageData = [{
                src,
                width: currentImg.style.width,
                flex: currentImg.style.flex,
                marginRight: currentImg.style.marginRight,
            }];
            this.isAvatarUpgraded = true;
        } catch (err) {
            if (!signal?.aborted) {
                console.warn('[STL] avatar quality upgrade failed', this.name, err);
            }
        } finally {
            this.isAvatarUpgrading = false;
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
