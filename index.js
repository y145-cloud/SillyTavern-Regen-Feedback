/**
 * 重生成意见 (Regen Feedback)
 *
 * 作用：在「重新生成」时先告诉 AI 上一轮哪里有问题。
 *  - 在最后一条 AI 回复的行动栏加一个 💬 按钮
 *  - 点开弹窗写意见，可插入 QR 助手（Quick Reply v2）里的快速回复
 *  - 用 ST 自带的 quiet_prompt 通道把意见拼到最后一条用户消息后面再重生成
 *
 * 不修改任何核心文件，只做按钮注入 / 面板 / 一次 Generate 调用。
 */

import {
    eventSource,
    event_types,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../../../../script.js';

const SETTINGS_KEY = 'stRegenFeedback';
const INJECT_KEY = 'stRegenFeedback_prompt';
const BTN_CLASS = 'mes_regen_feedback';

const DEFAULTS = {
    enabled: true,
    showButton: true,
    showQuickReplies: true,
    clearAfterSend: true,
    openOnRegenerate: true,
};

const state = {
    settings: { ...DEFAULTS },
    generating: false,
    injected: false,
    regenHookInstalled: false,
    regenBypass: false,
    allowSyntheticIntercept: false,
    toasts: new WeakSet(),
};

/* ------------------------------------------------------------------ */
/* 设置读写                                                            */
/* ------------------------------------------------------------------ */

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                state.settings = { ...DEFAULTS, ...parsed };
            }
        }
    } catch (err) {
        console.warn('[regen-feedback] 读取设置失败', err);
    }
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (err) {
        console.warn('[regen-feedback] 保存设置失败', err);
    }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

// script.js 并不导出 getContext（它挂在 globalThis.SillyTavern 上），
// 所以这里懒取一次，避免模块加载阶段就因缺少导出而整包失效。
function getCtx() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function toast(message) {
    // eslint-disable-next-line no-undef
    if (typeof toastr !== 'undefined' && toastr.info) {
        toastr.info(message, '重生成意见', { timeOut: 2600, preventDuplicates: true });
    } else {
        console.log('[regen-feedback]', message);
    }
}

function lastAiMessageEl() {
    const last = document.querySelector('#chat > .mes.last_mes');
    if (!last) return null;
    if (last.getAttribute('is_user') === 'true') return null;
    if (last.getAttribute('is_system') === 'true') return null;
    return last;
}

/* ------------------------------------------------------------------ */
/* 按钮注入                                                            */
/* ------------------------------------------------------------------ */

function refreshButton() {
    const existing = document.querySelectorAll(`.${BTN_CLASS}`);
    const target = state.settings.enabled && state.settings.showButton ? lastAiMessageEl() : null;
    const host = target?.querySelector('.mes_buttons') || null;

    for (const btn of existing) {
        if (btn.parentElement !== host) btn.remove();
    }
    if (!host) return;
    if (host.querySelector(`.${BTN_CLASS}`)) return;

    const btn = document.createElement('div');
    btn.className = `mes_button ${BTN_CLASS} fa-solid fa-comment-dots`;
    btn.title = '带着意见重新生成（说明上一轮哪里不对）';
    btn.setAttribute('data-mesid', target.getAttribute('mesid') ?? '');
    host.prepend(btn);
}

/* ------------------------------------------------------------------ */
/* 快速回复（与 QR 助手读同一批数据）                                   */
/* ------------------------------------------------------------------ */

function collectQuickReplies() {
    const api = window.quickReplyApi;
    if (!api || !api.settings) return [];
    if (api.settings.isEnabled === false) return [];

    const out = [];
    const seen = new Set();

    const walk = (setList) => {
        if (!Array.isArray(setList)) return;
        for (const setLink of setList) {
            if (!setLink?.isVisible || !setLink.set?.qrList) continue;
            for (const qr of setLink.set.qrList) {
                if (!qr || qr.isHidden || !qr.label) continue;
                const label = String(qr.label).trim();
                if (!label || seen.has(label)) continue;
                const message = typeof qr.message === 'string' ? qr.message : '';
                seen.add(label);
                out.push({ setName: String(setLink.set.name ?? ''), label, message });
            }
        }
    };

    walk(api.settings?.chatConfig?.setList);
    walk(api.settings?.charConfig?.setList);
    walk(api.settings?.config?.setList);
    return out;
}

function renderQuickReplies() {
    const list = document.getElementById('srf_qr_list');
    const wrap = document.getElementById('srf_qr_wrap');
    if (!list || !wrap) return;

    list.textContent = '';
    if (!state.settings.showQuickReplies) {
        wrap.hidden = true;
        return;
    }

    const replies = collectQuickReplies();
    wrap.hidden = replies.length === 0;
    if (!replies.length) return;

    let currentSet = null;
    for (const item of replies) {
        if (item.setName && item.setName !== currentSet) {
            currentSet = item.setName;
            const group = document.createElement('div');
            group.className = 'srf-qr-group-name';
            group.textContent = currentSet;
            list.appendChild(group);
        }
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'srf-qr-chip';
        chip.textContent = item.label;
        chip.title = item.message ? item.message.slice(0, 300) : item.label;
        chip.addEventListener('click', () => insertAtCursor(item.message || item.label));
        list.appendChild(chip);
    }
}

function insertAtCursor(text) {
    const area = document.getElementById('srf_text');
    if (!area) return;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    const before = area.value.slice(0, start);
    const after = area.value.slice(end);
    const needSpace = before.length > 0 && !/\s$/.test(before);
    const chunk = (needSpace ? ' ' : '') + text;
    area.value = before + chunk + after;
    const caret = (before + chunk).length;
    area.focus();
    area.setSelectionRange(caret, caret);
}

/* ------------------------------------------------------------------ */
/* 面板                                                                */
/* ------------------------------------------------------------------ */

function buildPanel() {
    if (document.getElementById('srf_overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'srf_overlay';
    overlay.className = 'srf-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="srf-backdrop" data-srf-close="1"></div>
        <div class="srf-card" role="dialog" aria-modal="true" aria-labelledby="srf_title">
            <div class="srf-head">
                <div class="srf-title" id="srf_title">重新生成并说明问题</div>
                <button type="button" class="srf-close" data-srf-close="1" title="关闭">✕</button>
            </div>
            <div class="srf-body">
                <div class="srf-hint">说说上一轮哪里不对：太啰嗦、出戏、跳剧情、漏设定、说话方式不对…… 这次会带着它重新生成。</div>
                <textarea id="srf_text" class="srf-text" rows="4" placeholder="例如：上一轮把角色写得太软，而且没接住我提到的「雨夜」；请保持冷硬语气，自然衔接场景。"></textarea>
                <div class="srf-qr-wrap" id="srf_qr_wrap">
                    <div class="srf-qr-head"><span>快速回复</span><span class="srf-qr-note">点一下插入到光标处</span></div>
                    <div class="srf-qr-list" id="srf_qr_list"></div>
                </div>
            </div>
            <div class="srf-foot">
                <label class="srf-opt"><input type="checkbox" id="srf_clear"> 生成后清空</label>
                <div class="srf-actions">
                    <button type="button" class="menu_button srf-btn" data-srf="direct">直接重生成</button>
                    <button type="button" class="menu_button srf-btn srf-primary" data-srf="send">带着意见重新生成</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.srfClose) {
            closePanel();
            return;
        }
        const action = target.dataset.srf;
        if (action) {
            submit(action);
        }
    });

    const clearBox = overlay.querySelector('#srf_clear');
    clearBox.checked = state.settings.clearAfterSend;
    clearBox.addEventListener('change', () => {
        state.settings.clearAfterSend = clearBox.checked;
        saveSettings();
    });

    overlay.querySelector('#srf_text').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit('send');
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePanel();
        }
    });
}

function openPanel() {
    buildPanel();
    const overlay = document.getElementById('srf_overlay');
    if (!overlay) return;
    renderQuickReplies();
    overlay.hidden = false;
    document.body.classList.add('srf-open');
    const area = document.getElementById('srf_text');
    if (area) {
        area.focus();
        const len = area.value.length;
        area.setSelectionRange(len, len);
    }
}

function closePanel() {
    const overlay = document.getElementById('srf_overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('srf-open');
}

function submit(kind) {
    const area = document.getElementById('srf_text');
    const text = (area?.value ?? '').trim();
    closePanel();

    if (kind === 'direct' || !text) {
        triggerRegenerate('');
        return;
    }

    triggerRegenerate(text);
    if (state.settings.clearAfterSend && area) {
        area.value = '';
    }
}

/* ------------------------------------------------------------------ */
/* 触发重生成                                                          */
/* ------------------------------------------------------------------ */

function triggerRegenerate(feedback) {
    if (state.generating) {
        toast('正在生成，等这一轮结束再重生成吧。');
        return;
    }

    // 下面会程序化点一次菜单项，期间把拦截关掉，避免自己拦自己。
    const prev = state.regenBypass;
    state.regenBypass = true;
    try {
        runRegenerate(feedback);
    } finally {
        state.regenBypass = prev;
    }
}

function runRegenerate(feedback) {
    const ctx = getCtx();
    const isGroup = Boolean(ctx?.groupId);
    const regenEl = document.getElementById('option_regenerate');

    const payload = feedback ? `【重生成要求】${feedback}` : '';

    if (!payload) {
        if (regenEl) {
            $(regenEl).trigger('click');
        } else {
            ctx?.generate?.('regenerate');
        }
        return;
    }

    if (isGroup) {
        // 组聊的 regenerateGroup() 不接收 quiet_prompt，改用临时系统提示注入，
        // 并且只走普通重生成，避免同一段意见被送两遍。
        setExtensionPrompt(INJECT_KEY, payload, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        state.injected = true;
        if (regenEl) {
            $(regenEl).trigger('click');
        } else {
            ctx?.generate?.('regenerate');
        }
        return;
    }

    if (regenEl) {
        $(regenEl).trigger('click', [{ additionalPrompt: payload }]);
    } else {
        ctx?.generate?.('regenerate', { quiet_prompt: payload, quietToLoud: true });
    }
}

function clearInjection() {
    if (!state.injected) return;
    state.injected = false;
    try {
        setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    } catch (err) {
        console.warn('[regen-feedback] 清理注入失败', err);
    }
}

/* ------------------------------------------------------------------ */
/* 拦截原生「重新生成」                                                  */
/* ------------------------------------------------------------------ */

// 大多数时候大家不会去消息上找 💬，而是直接点输入栏左下角菜单里的「重新生成」。
// 这里在捕获阶段把这次点击截下来，换成意见面板；面板里的「直接重生成」再程序化
// 触发原来的菜单项，所以老习惯不会丢。
//
// 只拦 isTrusted 的真实点击：酒馆里不少地方自己会 `$('#option_regenerate').trigger('click')`
// （比如 RossAscends 的自动继续），那些合成事件必须原样放行，否则会莫名弹面板。
// 我们自己触发时还会额外置 state.regenBypass，双保险。
function shouldInterceptRegen(event) {
    if (!state.settings.enabled || !state.settings.openOnRegenerate) return false;
    if (!event || state.regenBypass) return false;
    const target = event.target instanceof Element ? event.target.closest('#option_regenerate') : null;
    if (!target) return false;
    // state.allowSyntheticIntercept 只给测试台用，让它能验证整条拦截链路。
    return event.isTrusted === true || state.allowSyntheticIntercept === true;
}

function hideOptionsMenu() {
    try {
        if (typeof $ === 'function') {
            $('#options').hide();
            return;
        }
    } catch (err) {
        console.warn('[regen-feedback] 收起选项菜单失败', err);
    }
    const menu = document.getElementById('options');
    if (menu) menu.style.display = 'none';
}

function onDocumentClickCapture(event) {
    if (!shouldInterceptRegen(event)) return;
    // 把 ST 绑在菜单项上的生成逻辑整段拦掉，改成先问意见。
    event.preventDefault();
    event.stopImmediatePropagation();
    hideOptionsMenu();
    openPanel('regenerate');
}

function installRegenHook() {
    if (state.regenHookInstalled) return;
    state.regenHookInstalled = true;
    document.addEventListener('click', onDocumentClickCapture, true);
}

/* ------------------------------------------------------------------ */
/* 设置面板                                                            */
/* ------------------------------------------------------------------ */

const SETTINGS_ROWS = [
    ['enabled', '启用扩展'],
    ['showButton', '在最后一条回复上显示按钮'],
    ['showQuickReplies', '显示 QR 助手的快速回复'],
    ['clearAfterSend', '生成后清空意见'],
    ['openOnRegenerate', '点「重新生成」时弹出面板'],
];

function buildSettingsUi() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host || document.getElementById('srf_settings')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'srf_settings';
    wrapper.className = 'srf-settings';
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>重生成意见</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="srf-settings-desc">重新生成前先说明上一轮的问题，意见会随重生成一起发给 AI。</div>
                <div class="srf-settings-rows"></div>
                <div class="srf-settings-actions">
                    <button type="button" class="menu_button" id="srf_open_now">打开面板试试</button>
                </div>
            </div>
        </div>`;
    host.appendChild(wrapper);

    const rows = wrapper.querySelector('.srf-settings-rows');
    for (const [key, label] of SETTINGS_ROWS) {
        const row = document.createElement('label');
        row.className = 'srf-settings-row';
        row.innerHTML = `<input type="checkbox" data-key="${key}"><span>${label}</span>`;
        const input = row.querySelector('input');
        input.checked = Boolean(state.settings[key]);
        input.addEventListener('change', () => {
            state.settings[key] = input.checked;
            saveSettings();
            refreshButton();
        });
        rows.appendChild(row);
    }

    wrapper.querySelector('#srf_open_now').addEventListener('click', () => openPanel());
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.classList.contains(BTN_CLASS)) {
            event.preventDefault();
            event.stopPropagation();
            openPanel();
        }
    });

    const safeBind = (eventName, handler) => {
        if (!eventName) return;
        eventSource.on(eventName, handler);
    };

    safeBind(event_types.GENERATION_STARTED, (type) => {
        if (type === 'quiet') return;
        state.generating = true;
    });
    safeBind(event_types.GENERATION_ENDED, () => {
        state.generating = false;
        clearInjection();
        setTimeout(refreshButton, 30);
    });
    safeBind(event_types.GENERATION_STOPPED, () => {
        state.generating = false;
        clearInjection();
        setTimeout(refreshButton, 30);
    });
    safeBind(event_types.GENERATION_FAILED, () => {
        state.generating = false;
        clearInjection();
    });
    safeBind(event_types.CHARACTER_MESSAGE_RENDERED, () => setTimeout(refreshButton, 30));
    safeBind(event_types.USER_MESSAGE_RENDERED, () => setTimeout(refreshButton, 30));
    safeBind(event_types.MESSAGE_SWIPED, () => setTimeout(refreshButton, 30));
    safeBind(event_types.MESSAGE_EDITED, () => setTimeout(refreshButton, 30));
    safeBind(event_types.MESSAGE_DELETED, () => setTimeout(refreshButton, 30));
    safeBind(event_types.CHAT_CHANGED, () => setTimeout(refreshButton, 60));

    // 兜底：DOM 变化/切聊天时按钮可能被整块重建，低频校准
    setInterval(() => {
        if (!state.settings.enabled || !state.settings.showButton) return;
        if (!document.querySelector(`.${BTN_CLASS}`)) refreshButton();
    }, 1500);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function init() {
    loadSettings();
    buildPanel();
    buildSettingsUi();
    bindEvents();
    installRegenHook();
    refreshButton();
    setTimeout(refreshButton, 300);
    setTimeout(refreshButton, 1200);

    // 调试口
    window.stRegenFeedback = {
        settings: state.settings,
        state,
        refreshButton,
        openPanel,
        collectQuickReplies,
        triggerRegenerate,
        shouldInterceptRegen,
        save: saveSettings,
    };
}

init();
