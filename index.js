/**
 * SillyTavern-PixelFarm
 * 种田闭环：工具 → 播种 → 浇水 → 生长 → 收获 → 买卖
 * 所有作物数据来自 base-pack，贴图支持 PNG / 程序化生成
 */

const MODULE_NAME = 'SillyTavern-PixelFarm';
const EXT_PATH = 'scripts/extensions/third-party/SillyTavern-PixelFarm';
const STORAGE_KEY = 'pixelfarm_save_v2'; // v2：存档结构变更，旧演示存档弃用
const DEBUG_PREFIX = '[PixelFarm]';
const SEASON_KEYS = ['spring', 'summer', 'fall', 'winter'];

// ============================================================
// i18n
// ============================================================

const FALLBACK_STRINGS = {
    'pixelfarm_display_name': '像素农场 Pixel Farm',
    'pixelfarm_settings_enable': '启用插件',
    'pixelfarm_settings_open': '打开农场',
    'pixelfarm_tab_farming': '农田',
    'pixelfarm_tab_fishing': '钓鱼',
    'pixelfarm_tab_mining': '矿洞',
    'pixelfarm_tab_foraging': '采集',
    'pixelfarm_panel_title': '像素农场',
    'pixelfarm_day': '第 {0} 天 · {1} · ☀️ 晴天',
    'pixelfarm_season_spring': '春',
    'pixelfarm_season_summer': '夏',
    'pixelfarm_season_fall': '秋',
    'pixelfarm_season_winter': '冬',
    'pixelfarm_sleep': '睡觉（进入下一天）',
    'pixelfarm_tile_empty': '荒地（用锄头开垦）',
    'pixelfarm_tile_tilled': '耕地',
    'pixelfarm_tile_watered': '已浇水',
    'pixelfarm_crop_progress': '{0}：{1}/{2} 天',
    'pixelfarm_crop_mature': '{0}：成熟了！用收获篮收获',
    'pixelfarm_crop_withered': '枯萎的作物（用锄头清理）',
    'pixelfarm_gold': '💰 {0}g',
    'pixelfarm_tool_hoe': '锄头：开垦荒地 / 清理枯萎',
    'pixelfarm_tool_can': '水壶：浇水（作物需每天浇水才生长）',
    'pixelfarm_tool_seed': '播种当前选中的种子',
    'pixelfarm_tool_harvest': '收获篮：收获成熟作物',
    'pixelfarm_buy_seed': '买 1 包种子',
    'pixelfarm_sell_all': '卖出全部收获',
    'pixelfarm_produce_empty': '背包里还没有收获物',
    'pixelfarm_seed_count': '库存 ×{0}',
    'pixelfarm_no_seed_selected': '当前季节没有可用种子',
    'pixelfarm_msg_not_in_season': '{0} 不能在{1}季播种',
    'pixelfarm_msg_no_seeds': '没有 {0} 种子了，先购买一些',
    'pixelfarm_msg_no_gold': '金币不足',
    'pixelfarm_msg_harvest': '收获 {0} ×1！',
    'pixelfarm_msg_bought': '购买了 {0} 种子 ×1',
    'pixelfarm_msg_sold': '卖出全部收获，获得 {0}g',
    'pixelfarm_msg_withered': '换季了，{0} 不适应新季节，枯萎了…',
    'pixelfarm_placeholder': '「{0}」玩法开发中，敬请期待',
};

let translate = (key) => FALLBACK_STRINGS[key] ?? key;

async function initI18n() {
    try {
        const { t } = await import('../../../../i18n.js');
        translate = (key) => {
            const s = t(key);
            return (s === key && FALLBACK_STRINGS[key]) ? FALLBACK_STRINGS[key] : s;
        };
    } catch {
        console.debug(DEBUG_PREFIX, 'i18n 模块不可用，使用内置中文文案');
    }
}

function T(key, ...args) {
    let s = translate(key);
    args.forEach((a, i) => { s = s.replaceAll(`{${i}}`, String(a)); });
    return s;
}

// ============================================================
// 设置
// ============================================================

const DEFAULT_SETTINGS = { enabled: true };

function getSettings(ctx) {
    const store = ctx.extensionSettings;
    if (store[MODULE_NAME] === undefined) store[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (store[MODULE_NAME][k] === undefined) store[MODULE_NAME][k] = DEFAULT_SETTINGS[k];
    }
    return store[MODULE_NAME];
}

// ============================================================
// 作物数据（由 PackLoader 加载）
// ============================================================

const cropIndex = new Map(); // id -> 定义（含 textureFrames）

async function loadCropData() {
    const { PackLoader } = await import(`${EXT_PATH}/js/packLoader.js`);
    const loader = new PackLoader(EXT_PATH);
    const { manifest, crops, errors } = await loader.loadPack('base-pack');

    crops.forEach((d) => cropIndex.set(d.id, d));

    console.log(DEBUG_PREFIX,
        `资源包「${manifest.name}」加载完成：${crops.length} 种作物，` +
        `${loader.proceduralCount} 个使用程序化贴图` +
        (errors.length ? `；${errors.length} 个条目被跳过：${errors.join('; ')}` : ''));
}

// ============================================================
// 游戏状态与存档
// ============================================================

const defaultSave = () => ({
    day: 1,
    gold: 500,
    seeds: { parsnip: 15, potato: 5 },
    produce: {},   // 收获物 {cropId: count}
    tiles: Array.from({ length: 9 }, () => ({ soil: 'empty', crop: null })),
    // crop: { id, daysGrown, wateredToday, withered }
});

let save = null;

async function loadSave() {
    if (typeof localforage === 'undefined') return defaultSave();
    try {
        const s = await localforage.getItem(STORAGE_KEY);
        if (!s) return defaultSave();
        // 补齐字段（版本升级容错）
        const base = defaultSave();
        for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
        // 清除数据包中已不存在的种子
        for (const id of Object.keys(s.seeds)) if (!cropIndex.has(id)) delete s.seeds[id];
        return s;
    } catch (e) {
        console.warn(DEBUG_PREFIX, '读取存档失败，使用新存档', e);
        return defaultSave();
    }
}

async function persistSave() {
    try {
        if (typeof localforage !== 'undefined') await localforage.setItem(STORAGE_KEY, save);
    } catch (e) {
        console.warn(DEBUG_PREFIX, '保存失败', e);
    }
}

// ============================================================
// 游戏逻辑
// ============================================================

const seasonKey = (day) => SEASON_KEYS[Math.floor((day - 1) / 28) % 4];
const seasonName = (day) => T(`pixelfarm_season_${seasonKey(day)}`);

let currentTool = 'hoe';   // hoe | can | seed | harvest
let selectedSeed = null;

function stageIndex(crop, def) {
    if (crop.daysGrown >= def.growthDays) return def.stages - 1;
    return Math.min(def.stages - 1, Math.floor((crop.daysGrown / def.growthDays) * (def.stages - 1)));
}

function onTileClick(i) {
    const tile = save.tiles[i];
    const def = tile.crop ? cropIndex.get(tile.crop.id) : null;

    switch (currentTool) {
        case 'hoe':
            if (tile.crop?.withered) { tile.crop = null; tile.soil = 'tilled'; }
            else if (!tile.crop) { tile.soil = tile.soil === 'empty' ? 'tilled' : 'empty'; }
            break;

        case 'can':
            if (tile.soil !== 'empty') {
                tile.soil = 'watered';
                if (tile.crop) tile.crop.wateredToday = true;
            }
            break;

        case 'seed':
            if ((tile.soil === 'tilled' || tile.soil === 'watered') && !tile.crop) {
                const d = cropIndex.get(selectedSeed);
                if (!d) return;
                if (!d.seasons.includes(seasonKey(save.day))) {
                    toastr.warning(T('pixelfarm_msg_not_in_season', d.name, seasonName(save.day)), DEBUG_PREFIX);
                    return;
                }
                if ((save.seeds[selectedSeed] ?? 0) <= 0) {
                    toastr.warning(T('pixelfarm_msg_no_seeds', d.name), DEBUG_PREFIX);
                    return;
                }
                save.seeds[selectedSeed]--;
                tile.crop = { id: selectedSeed, daysGrown: 0, wateredToday: tile.soil === 'watered', withered: false };
            }
            break;

        case 'harvest':
            if (tile.crop && !tile.crop.withered && tile.crop.daysGrown >= def.growthDays) {
                save.produce[tile.crop.id] = (save.produce[tile.crop.id] ?? 0) + 1;
                toastr.success(T('pixelfarm_msg_harvest', def.name), DEBUG_PREFIX);
                if (def.harvestType === 'regrow' && def.regrowDays >= 1) {
                    tile.crop.daysGrown = def.growthDays - def.regrowDays; // 再生作物回到结果期前一天
                } else {
                    tile.crop = null;
                }
            }
            break;
    }
    persistSave();
    renderFarm();
}

async function onSleep() {
    save.day += 1;
    const newSeason = seasonKey(save.day);
    const oldSeason = seasonKey(save.day - 1);
    let witheredNames = [];

    for (const tile of save.tiles) {
        if (tile.soil === 'watered') tile.soil = 'tilled';
        if (!tile.crop) continue;
        const def = cropIndex.get(tile.crop.id);

        if (newSeason !== oldSeason && !def.seasons.includes(newSeason)) {
            tile.crop.withered = true;
            witheredNames.push(def.name);
        } else if (tile.crop.wateredToday && !tile.crop.withered) {
            tile.crop.daysGrown = Math.min(tile.crop.daysGrown + 1, def.growthDays);
        }
        tile.crop.wateredToday = false;
    }

    await persistSave();
    renderFarm();
    toastr.info(T('pixelfarm_day', save.day, seasonName(save.day)), DEBUG_PREFIX);
    if (witheredNames.length) {
        toastr.warning(T('pixelfarm_msg_withered', [...new Set(witheredNames)].join('、')), DEBUG_PREFIX);
    }
}

function buySeed() {
    const def = cropIndex.get(selectedSeed);
    if (!def) return;
    if (save.gold < def.seedPrice) { toastr.warning(T('pixelfarm_msg_no_gold'), DEBUG_PREFIX); return; }
    save.gold -= def.seedPrice;
    save.seeds[def.id] = (save.seeds[def.id] ?? 0) + 1;
    toastr.info(T('pixelfarm_msg_bought', def.name), DEBUG_PREFIX);
    persistSave();
    renderFarm();
}

function sellAll() {
    let total = 0;
    for (const [id, count] of Object.entries(save.produce)) {
        const def = cropIndex.get(id);
        if (def) total += def.sellPrice * count;
    }
    if (total > 0) {
        save.gold += total;
        save.produce = {};
        toastr.success(T('pixelfarm_msg_sold', total), DEBUG_PREFIX);
    }
    persistSave();
    renderFarm();
}

// ============================================================
// UI
// ============================================================

let $overlay = null;

function buildPanel() {
    if ($overlay) return;
    $overlay = $(`
    <div id="pixelfarm_overlay" class="pixelfarm-overlay" style="display:none">
        <div class="pixelfarm-window">
            <div class="pixelfarm-header">
                <span class="pixelfarm-title">🌱 ${T('pixelfarm_panel_title')}</span>
                <span id="pixelfarm_date" class="pixelfarm-date"></span>
                <span id="pixelfarm_gold" class="pixelfarm-gold"></span>
                <div id="pixelfarm_close" class="menu_button pixelfarm-close"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <div class="pixelfarm-tabs">
                <div class="pixelfarm-tab menu_button active" data-tab="farming">🌾 ${T('pixelfarm_tab_farming')}</div>
                <div class="pixelfarm-tab menu_button" data-tab="fishing">🎣 ${T('pixelfarm_tab_fishing')}</div>
                <div class="pixelfarm-tab menu_button" data-tab="mining">⛏️ ${T('pixelfarm_tab_mining')}</div>
                <div class="pixelfarm-tab menu_button" data-tab="foraging">🍄 ${T('pixelfarm_tab_foraging')}</div>
            </div>
            <div class="pixelfarm-body">
                <div class="pixelfarm-view" data-view="farming">
                    <div class="pixelfarm-toolbar">
                        <div class="pixelfarm-tool menu_button active" data-tool="hoe" title="${T('pixelfarm_tool_hoe')}">⛏️</div>
                        <div class="pixelfarm-tool menu_button" data-tool="can" title="${T('pixelfarm_tool_can')}">💧</div>
                        <div class="pixelfarm-tool menu_button" data-tool="seed" title="${T('pixelfarm_tool_seed')}">🌱</div>
                        <select id="pixelfarm_seed_select" class="text_pole pixelfarm-seed-select"></select>
                        <span id="pixelfarm_seed_count" class="pixelfarm-seed-count"></span>
                        <div class="pixelfarm-tool menu_button" data-tool="harvest" title="${T('pixelfarm_tool_harvest')}">🧺</div>
                    </div>
                    <div id="pixelfarm_grid" class="pixelfarm-grid"></div>
                    <div class="pixelfarm-shop">
                        <div id="pixelfarm_buy" class="menu_button">🛒 ${T('pixelfarm_buy_seed')}</div>
                        <div id="pixelfarm_sell_all" class="menu_button">💰 ${T('pixelfarm_sell_all')}</div>
                    </div>
                    <div id="pixelfarm_produce" class="pixelfarm-produce"></div>
                    <div id="pixelfarm_sleep" class="menu_button pixelfarm-sleep">🌙 ${T('pixelfarm_sleep')}</div>
                </div>
                <div class="pixelfarm-view" data-view="fishing" style="display:none"><div class="pixelfarm-placeholder" data-placeholder="fishing"></div></div>
                <div class="pixelfarm-view" data-view="mining" style="display:none"><div class="pixelfarm-placeholder" data-placeholder="mining"></div></div>
                <div class="pixelfarm-view" data-view="foraging" style="display:none"><div class="pixelfarm-placeholder" data-placeholder="foraging"></div></div>
            </div>
        </div>
    </div>`);

    $('body').append($overlay);

    $overlay.find('#pixelfarm_close').on('click', closeGame);
    $overlay.find('.pixelfarm-tab').on('click', function () {
        const tab = $(this).data('tab');
        $overlay.find('.pixelfarm-tab').removeClass('active');
        $(this).addClass('active');
        $overlay.find('.pixelfarm-view').each(function () { $(this).toggle($(this).data('view') === tab); });
    });

    $overlay.find('.pixelfarm-tool').on('click', function () {
        currentTool = $(this).data('tool');
        $overlay.find('.pixelfarm-tool').removeClass('active');
        $(this).addClass('active');
    });

    $overlay.find('#pixelfarm_seed_select').on('change', function () { selectedSeed = this.value; renderFarm(); });
    $overlay.find('#pixelfarm_grid').on('click', '.pixelfarm-tile', function () { onTileClick(Number($(this).data('index'))); });
    $overlay.find('#pixelfarm_sleep').on('click', onSleep);
    $overlay.find('#pixelfarm_buy').on('click', buySeed);
    $overlay.find('#pixelfarm_sell_all').on('click', sellAll);
}

function tileHtml(tile, i) {
    const soilLabels = {
        empty: T('pixelfarm_tile_empty'),
        tilled: T('pixelfarm_tile_tilled'),
        watered: T('pixelfarm_tile_watered'),
    };
    let title = soilLabels[tile.soil];
    let plant = '';

    if (tile.crop) {
        const def = cropIndex.get(tile.crop.id);
        if (tile.crop.withered) {
            title = T('pixelfarm_crop_withered');
            plant = '<div class="pixelfarm-plant pixelfarm-plant--withered">🥀</div>';
        } else {
            const mature = tile.crop.daysGrown >= def.growthDays;
            title = mature ? T('pixelfarm_crop_mature', def.name)
                           : T('pixelfarm_crop_progress', def.name, tile.crop.daysGrown, def.growthDays);
            const frame = def.textureFrames[stageIndex(tile.crop, def)];
            plant = `<div class="pixelfarm-plant ${mature ? 'pixelfarm-plant--mature' : ''}" style="background-image:url('${frame}')"></div>`;
        }
    }
    return `<div class="pixelfarm-tile pixelfarm-soil--${tile.soil}" data-index="${i}" title="${title}">${plant}</div>`;
}

function renderFarm() {
    $overlay.find('#pixelfarm_date').text(T('pixelfarm_day', save.day, seasonName(save.day)));
    $overlay.find('#pixelfarm_gold').text(T('pixelfarm_gold', save.gold));

    // 种子下拉：仅显示当前季节可种的作物
    const curSeason = seasonKey(save.day);
    const plantable = [...cropIndex.values()].filter((d) => d.seasons.includes(curSeason));
    const $sel = $overlay.find('#pixelfarm_seed_select').empty();
    if (!plantable.length) {
        $sel.append(`<option value="">${T('pixelfarm_no_seed_selected')}</option>`);
        selectedSeed = null;
    } else {
        plantable.forEach((d) => {
            $sel.append(`<option value="${d.id}">${d.name}（${d.seedPrice}g）</option>`);
        });
        if (!selectedSeed || !plantable.some((d) => d.id === selectedSeed)) selectedSeed = plantable[0].id;
        $sel.val(selectedSeed);
    }
    $overlay.find('#pixelfarm_seed_count')
        .text(selectedSeed ? T('pixelfarm_seed_count', save.seeds[selectedSeed] ?? 0) : '');

    // 地块
    const $grid = $overlay.find('#pixelfarm_grid').empty();
    save.tiles.forEach((tile, i) => $grid.append($(tileHtml(tile, i))));

    // 收获物背包
    const entries = Object.entries(save.produce).filter(([, n]) => n > 0);
    $overlay.find('#pixelfarm_produce').html(
        entries.length
            ? '🎒 ' + entries.map(([id, n]) => `${cropIndex.get(id)?.name ?? id}×${n}`).join(' · ')
            : '🎒 ' + T('pixelfarm_produce_empty')
    );

    // 占位页签
    const tabNames = { fishing: T('pixelfarm_tab_fishing'), mining: T('pixelfarm_tab_mining'), foraging: T('pixelfarm_tab_foraging') };
    $overlay.find('.pixelfarm-placeholder').each(function () {
        $(this).text(T('pixelfarm_placeholder', tabNames[$(this).data('placeholder')]));
    });
}

async function openGame() {
    buildPanel();
    if (!save) save = await loadSave();
    renderFarm();
    $overlay.fadeIn(200);
}

function closeGame() { $overlay?.fadeOut(200); }
function toggleGame() { ($overlay?.is(':visible')) ? closeGame() : openGame(); }

// ============================================================
// 初始化
// ============================================================

async function init() {
    await initI18n();
    await loadCropData(); // ⭐ 游戏数据先于存档加载

    const ctx = SillyTavern.getContext();
    const settings = getSettings(ctx);

    const settingsHtml = `
    <div class="pixelfarm-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🌱 ${T('pixelfarm_display_name')}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="pixelfarm_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                    <span>${T('pixelfarm_settings_enable')}</span>
                </label>
                <div class="pixelfarm-settings-actions">
                    <div id="pixelfarm_open" class="menu_button">
                        <i class="fa-solid fa-seedling"></i>
                        <span>${T('pixelfarm_settings_open')}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings').append(settingsHtml);

    $('#pixelfarm_enabled').on('change', function () {
        settings.enabled = $(this).prop('checked');
        ctx.saveSettingsDebounced();
    });
    $('#pixelfarm_open').on('click', openGame);

    try {
        const { SlashCommandParser, SlashCommand } = ctx;
        if (SlashCommandParser && SlashCommand) {
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: 'farm',
                aliases: ['pixelfarm'],
                help: '打开 / 关闭像素农场面板',
                callback: () => { toggleGame(); return ''; },
            }));
        }
    } catch (e) {
        console.warn(DEBUG_PREFIX, '斜杠命令注册失败（不影响其他功能）', e);
    }
}

jQuery(async () => {
    try {
        await init();
        console.log(DEBUG_PREFIX, `像素农场已加载 ✅ 作物 ${cropIndex.size} 种 | /farm 或扩展设置打开`);
    } catch (e) {
        console.error(DEBUG_PREFIX, '初始化失败', e);
    }
});
