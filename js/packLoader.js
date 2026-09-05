/**
 * 资源包加载器
 * - 读取 pack.json → 逐个加载作物 JSON → 校验 → 加载/生成贴图
 * - 贴图优先级：PNG 贴图条带 > 程序化像素贴图
 * - 校验失败：跳过该条目并记录错误，不中断加载
 */

const SEASONS = ['spring', 'summer', 'fall', 'winter'];

export class PackLoader {
    constructor(extPath) {
        this.extPath = extPath;
        this.proceduralCount = 0; // 统计使用程序化贴图的作物数
    }

    async fetchJson(url) {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    /** 加载一个资源包，返回 { manifest, crops, errors } */
    async loadPack(packDir = 'base-pack') {
        const manifest = await this.fetchJson(`${this.extPath}/${packDir}/pack.json`);
        const crops = [];
        const errors = [];

        for (const id of manifest.crops ?? []) {
            try {
                const def = await this.fetchJson(`${this.extPath}/${packDir}/crops/${id}.json`);
                def.packId = manifest.id;
                const err = this.validate(def);
                if (err) {
                    errors.push(`${id}: ${err}`);
                    continue;
                }
                def.textureFrames = await this.loadTexture(def);
                crops.push(def);
            } catch (e) {
                errors.push(`${id}: ${e.message}`);
            }
        }
        return { manifest, crops, errors };
    }

    /** 数据校验：返回 null 表示通过，否则返回错误描述 */
    validate(d) {
        if (!d.id || typeof d.id !== 'string') return '缺少 id';
        if (!d.name) return '缺少 name';
        if (!Array.isArray(d.seasons) || !d.seasons.length || d.seasons.some(s => !SEASONS.includes(s))) return 'seasons 无效';
        if (!Number.isInteger(d.growthDays) || d.growthDays < 1) return 'growthDays 需为 ≥1 的整数';
        if (!Number.isInteger(d.stages) || d.stages < 1 || d.stages > 8) return 'stages 需为 1-8';
        if (!['once', 'regrow'].includes(d.harvestType)) return 'harvestType 仅支持 once/regrow';
        if (d.harvestType === 'regrow' && !(Number.isInteger(d.regrowDays) && d.regrowDays >= 1)) return 'regrow 类型需要 regrowDays ≥ 1';
        if (typeof d.seedPrice !== 'number' || typeof d.sellPrice !== 'number') return '价格需为数字';
        return null;
    }

    async loadTexture(def) {
        // 1) 尝试加载本地 PNG 贴图条带
        if (def.texture) {
            try {
                const img = await this.loadImage(`${this.extPath}/${def.texture}`);
                return this.sliceStrip(img, def.stages, def.id);
            } catch {
                this.proceduralCount++;
                console.debug(`[PixelFarm] ${def.id}: 未找到贴图 ${def.texture}，使用程序化贴图`);
            }
        } else {
            this.proceduralCount++;
        }
        // 2) 程序化像素贴图
        return this.generateTexture(def);
    }

    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = url;
        });
    }

    /**
     * PNG 贴图条带切分
     * 规范：竖向条带，宽度 = 单帧宽度，高度 = 帧宽 × stages
     * 从上到下依次为：刚播种 → … → 成熟
     */
    sliceStrip(img, stages, id) {
        const w = img.width;
        const frameH = img.height / stages;
        if (Math.abs(frameH - Math.round(frameH)) > 0.01) {
            throw new Error(`贴图高度 ${img.height} 不能被 ${stages} 整除`);
        }
        if (Math.abs(w - Math.round(frameH)) > 0.01) {
            console.debug(`[PixelFarm] ${id}: 贴图帧不是正方形（${w}×${Math.round(frameH)}），仍按条带切分`);
        }
        const frames = [];
        for (let i = 0; i < stages; i++) {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = Math.round(frameH);
            c.getContext('2d').drawImage(img, 0, i * frameH, w, frameH, 0, 0, w, frameH);
            frames.push(c.toDataURL());
        }
        return frames;
    }

    /**
     * 程序化像素贴图：16×16，植株随阶段长高，成熟期结出果实
     * color = 茎叶色，produceColor = 果实色（均来自 JSON）
     */
    generateTexture(def) {
        const S = 16;
        const stem = def.color ?? '#5dbb46';
        const fruit = def.produceColor ?? '#e8a33d';
        const frames = [];

        for (let s = 0; s < def.stages; s++) {
            const c = document.createElement('canvas');
            c.width = S; c.height = S;
            const g = c.getContext('2d');
            const t = def.stages === 1 ? 1 : s / (def.stages - 1);
            const mature = s === def.stages - 1;

            g.fillStyle = '#8a6a45';
            g.fillRect(6, 14, 4, 1); // 土

            if (s === 0) {
                g.fillStyle = '#c9a06a';
                g.fillRect(7, 12, 2, 2); // 种子
            } else {
                const h = Math.max(2, Math.round(2 + t * 8)); // 植株高度 2→10
                g.fillStyle = stem;
                g.fillRect(7, 15 - h, 2, h);              // 茎
                g.fillRect(5, 15 - h + 1, 1, 1);          // 左叶
                g.fillRect(10, 15 - h + 2, 1, 1);         // 右叶
                if (h >= 6) {
                    g.fillRect(4, 15 - h + 3, 1, 1);
                    g.fillRect(11, 15 - h + 4, 1, 1);
                }
                if (mature) {
                    g.fillStyle = fruit;                  // 果实
                    g.fillRect(6, 15 - h - 2, 4, 3);
                    g.fillRect(5, 15 - h - 1, 6, 1);
                }
            }
            frames.push(c.toDataURL());
        }
        return frames;
    }
}
