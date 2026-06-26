import { characters } from '../../../../../script.js';
import { findExpression } from '../index.js';

export class Member {
    /**@type {Member[]}*/static list = [];


    static getByName(name) {
        let mem = this.list.find(it=>it.name == name);
        if (!mem) {
            const memData = characters.find(it=>it.name == name);
            if (memData) {
                mem = new Member(memData);
                this.list.push(mem);
            }
        }
        return mem;
    }

    static getByAvatar(avatar) {
        let mem = this.list.find(it=>it.avatar == avatar);
        if (!mem) {
            const memData = characters.find(it=>it.avatar == avatar);
            if (memData) {
                mem = new Member(memData);
                this.list.push(mem);
            }
        }
        return mem;
    }




    /**@type {String}*/ name;
    /**@type {String}*/ avatar;

    /**@type {HTMLImageElement}*/ avatarImg;
    /**@type {HTMLImageElement}*/ expressionImg;




    constructor(props) {
        this.name = props.name;
        this.avatar = props.avatar;
    }


    async loadImage(url, { signal = null, timeoutMs = 4500 } = {}) {
        return new Promise((resolve, reject)=>{
            const img = new Image();
            const cleanup = ()=>{
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abort);
            };
            const abort = ()=>{
                cleanup();
                img.src = '';
                reject(new DOMException('Image load aborted', 'AbortError'));
            };
            const timeout = setTimeout(abort, timeoutMs);
            signal?.addEventListener('abort', abort, { once:true });
            if (signal?.aborted) return abort();
            img.addEventListener('load', ()=>{
                cleanup();
                resolve(img);
            }, { once:true });
            img.addEventListener('error', ()=>{
                cleanup();
                reject(new Error(`Could not load image: ${url}`));
            }, { once:true });
            img.src = url;
        });
    }
    async loadAvatar(options = {}) {
        const img = await this.loadImage(`/characters/${this.avatar}`, options);
        this.avatarImg = img;
        return img;
    }
    async loadExpression(expr, costume = null, options = {}) {
        const url = await findExpression(costume ?? this.name, options);
        const img = await this.loadImage(url ?? `/characters/${this.avatar}`, options);
        this.expressionImg = img;
        return img;
    }
}
