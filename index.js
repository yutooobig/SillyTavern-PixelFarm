/**
 * SillyTavern-PixelFarm
 * 简化版星露谷 · 基础骨架（种田/采集/钓鱼/挖矿）
 * 仅包含：扩展设置面板 + 游戏窗口框架 + 存档验证演示
 */

const MODULE_NAME = 'SillyTavern-PixelFarm';
const DEBUG_PREFIX = '[PixelFarm]';
const STORAGE_KEY = 'pixelfarm_save_v1';

// ============================================================
// i18n：优先使用 ST 内置 i18n 模块，不可用时降级到内置文案
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
    'pixelfarm_seasons': '春,夏,秋,冬',
    'pixelfarm_day': '第 {0} 天 · {1}季 · ☀️ 晴天',
    'pixelfarm_sleep': '睡觉（进入下一天）',
    'pixelfarm_tile_empty': '荒地',
    'pixelfarm_tile_tilled': '耕地',
    'pixelfarm_tile_watered': '已浇水',
    'pixelfarm_placeholder': '「{0}」玩法开发中，敬请期待',
};

let translate = (key) => FALLBACK_STRINGS[key] ?? key;

async function initI18n() {
    try {
        const { t } = await import('../../../../i18n.js');
        translate = (key) => {
            const s = t(key);
            // ST 未找到翻译时会原样返回 key，此时回退到内置文案
            return (s === key && FALLBACK_STRINGS[key]) ? FALLBACK_STRINGS[key] : s;
        };
    } catch (e) {
        console.debug(DEBUG_PREFIX, 'i18n 模块不可用，使用内置中文文案');
    }
}

/** 翻译 + {0}{1} 占位符填充 */
function T(key, ...args) {
    let s = translate(key);
    args.forEach((a, i) => { s = s.replaceAll(`{${i}}`, String(a)); });
    return s;
}

// ============================================================
// 设置（存储在 ST 的 extensionSettings 中）
// ============================================================

const DEFAULT_SETTINGS = {
    enabled: true,
};

function getSettings(ctx) {
    const store = ctx.extensionSettings;
    if (store[MODULE_NAME] === undefined) {
        store[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    // 补齐新增字段（版本升级兼容）
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (store[MODULE_NAME][key] === undefined) {
            store[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
        }
    }
    return store[MODULE_NAME];
}

// ============================================================
// 游戏存档（localforage —— ST 内置共享库）
// ============================================================

const TILE_STATES = ['empty', 'tilled', 'watered']; // 点击循环切换

const defaultSave = () => ({
    day: 1,
    tiles: Array(9).fill('empty'),
});

let save = null;

async function loadSave() {
    if (typeof localforage === 'undefined') {
        console.warn(DEBUG_PREFIX, 'localforage 不可用，本次会话不持久化');
        return defaultSave();
    }
    try {
        return (await localforage.getItem(STORAGE_KEY)) ?? defaultSave();
    } catch (e) {
        console.warn(DEBUG_PREFIX, '读取存档失败，使用新存档', e);
        return defaultSave();
    }
}

async function persistSave() {
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.setItem(STORAGE_KEY, save);
        }
    } catch (e) {
        console.warn(DEBUG_PREFIX, '保存失败', e);
    }
}

// ============================================================
// 游戏窗口
// ============================================================

let $overlay = null;

function getSeason(day) {
    const seasons = T('pixelfarm_seasons').split(',');
    return seasons[Math.floor((day - 1) / 28) % seasons.length];
}

function buildPanel() {
    if ($overlay) return;

    $overlay = $(`
    <div id="pixelfarm_overlay" class="pixelfarm-overlay" style="display:none">
        <div class="pixelfarm-window">
            <div class="pixelfarm-header">
                <span class="pixelfarm-title">🌱 ${T('pixelfarm_panel_title')}</span>
                <span id="pixelfarm_date" class="pixelfarm-date"></span>
                <div id="pixelfarm_close" class="menu_button pixelfarm-close" title="Close">
                    <i class="fa-solid fa-xmark"></i>
                </div>
            </div>
            <div class="pixelfarm-tabs">
                <div class="pixelfarm-tab menu_button active" data-tab="farming">🌾 ${T('pixelfarm_tab_farming')}</div>
                <div class="pixelfarm-tab menu_button" data-tab="fishing">🎣 ${T('pixelfarm_tab_fishing')}</div>
                <div class="pixelfarm-tab menu_button" data-tab="mining">⛏️ ${T('pixelfarm_tab_mining')}</div>
                <div class="pixelfarm-tab menu_button" data-tab="foraging">🍄 ${T('pixelfarm_tab_foraging')}</div>
            </div>
            <div class="pixelfarm-body">
                <div class="pixelfarm-view" data-view="farming">
                    <div id="pixelfarm_grid" class="pixelfarm-grid"></div>
                    <div id="pixelfarm_sleep" class="menu_button pixelfarm-sleep">🌙 ${T('pixelfarm_sleep')}</div>
                </div>
                <div class="pixelfarm-view" data-view="fishing" style="display:none">
                    <div class="pixelfarm-placeholder" data-placeholder="fishing"></div>
                </div>
                <div class="pixelfarm-view" data-view="mining" style="display:none">
                    <div class="pixelfarm-placeholder" data-placeholder="mining"></div>
                </div>
                <div class="pixelfarm-view" data-view="foraging" style="display:none">
                    <div class="pixelfarm-placeholder" data-placeholder="foraging"></div>
                </div>
            </div>
        </div>
    </div>`);

    $('body').append($overlay);

    // ---- 事件绑定 ----
    $overlay.find('#pixelfarm_close').on('click', closeGame);
    $overlay.find('.pixelfarm-tab').on('click', function () {
        const tab = $(this).data('tab');
        $overlay.find('.pixelfarm-tab').removeClass('active');
        $(this).addClass('active');
        $overlay.find('.pixelfarm-view').each(function () {
            $(this).toggle($(this).data('view') === tab);
        });
    });

    // 地块点击：荒地 → 耕地 → 已浇水 → 荒地
    $overlay.find('#pixelfarm_grid').on('click', '.pixelfarm-tile', async function () {
        const i = Number($(this).data('index'));
        const cur = save.tiles[i];
        save.tiles[i] = TILE_STATES[(TILE_STATES.indexOf(cur) + 1) % TILE_STATES.length];
        await persistSave();
        renderFarm();
    });

    // 睡觉：进入下一天，浇过水的地块变回耕地
    $overlay.find('#pixelfarm_sleep').on('click', async () => {
        save.day += 1;
        save.tiles = save.tiles.map((t) => (t === 'watered' ? 'tilled' : t));
        await persistSave();
        renderFarm();
        toastr.info(T('pixelfarm_day', save.day, getSeason(save.day)), DEBUG_PREFIX);
    });
}

function renderFarm() {
    // 日期
    $overlay.find('#pixelfarm_date').text(T('pixelfarm_day', save.day, getSeason(save.day)));

    // 地块
    const labelMap = {
        empty: T('pixelfarm_tile_empty'),
        tilled: T('pixelfarm_tile_tilled'),
        watered: T('pixelfarm_tile_watered'),
    };
    const $grid = $overlay.find('#pixelfarm_grid').empty();
    save.tiles.forEach((state, i) => {
        $grid.append(
            $(`<div class="pixelfarm-tile pixelfarm-tile--${state}" data-index="${i}" title="${labelMap[state]}"></div>`)
        );
    });

    // 占位页签文案
    const tabNames = {
        fishing: T('pixelfarm_tab_fishing'),
        mining: T('pixelfarm_tab_mining'),
        foraging: T('pixelfarm_tab_foraging'),
    };
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

function closeGame() {
    $overlay?.fadeOut(200);
}

function toggleGame() {
    if ($overlay?.is(':visible')) closeGame(); else openGame();
}

// ============================================================
// 初始化入口
// ============================================================

async function init() {
    await initI18n();
    const ctx = SillyTavern.getContext();
    const settings = getSettings(ctx);

    // ---- 扩展设置面板（追加到 ST 扩展设置区末尾）----
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

    // ---- 注册斜杠命令 /farm（可选，失败不影响运行）----
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
        console.log(DEBUG_PREFIX, '像素农场已加载 ✅  在聊天框输入 /farm 或在扩展设置中打开');
    } catch (e) {
        console.error(DEBUG_PREFIX, '初始化失败', e);
    }
});
