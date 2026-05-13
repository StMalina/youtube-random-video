// ==UserScript==
// @name         YouTube Random Video Button
// @namespace    https://stmalina.ru/youtube-random-video
// @version      1.0.4
// @description  Добавляет в табы канала YouTube кнопку запуска случайного видео этого канала
// @description:en  Adds a "Random video" tab on YouTube channel pages
// @author       StMalina
// @copyright    2026, StMalina (https://stmalina.ru)
// @homepage     https://stmalina.ru
// @homepageURL  https://github.com/StMalina/youtube-random-video
// @supportURL   https://github.com/StMalina/youtube-random-video/issues
// @updateURL    https://raw.githubusercontent.com/StMalina/youtube-random-video/main/youtube-random-video.user.js
// @downloadURL  https://raw.githubusercontent.com/StMalina/youtube-random-video/main/youtube-random-video.user.js
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/*
 * YouTube Random Video Button
 * Copyright (c) 2026 StMalina <https://stmalina.ru>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

(function () {
    'use strict';

    const TAB_ID = 'rv-random-tab';
    const CACHE_TTL_MS = 10 * 60 * 1000;
    const CACHE_PREFIX = 'rv:cache:';
    const MAX_TAB_WAIT_TRIES = 40;
    const TAB_WAIT_INTERVAL_MS = 250;
    const CHANNEL_URL_RE = /^\/(channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+|@[^/]+)(\/.*)?$/;

    let busy = false;

    // ---------- helpers ----------

    function isChannelUrl() {
        return CHANNEL_URL_RE.test(location.pathname);
    }

    function getChannelId() {
        try {
            const fromInitial = window.ytInitialData
                && window.ytInitialData.metadata
                && window.ytInitialData.metadata.channelMetadataRenderer
                && window.ytInitialData.metadata.channelMetadataRenderer.externalId;
            if (fromInitial && /^UC/.test(fromInitial)) return fromInitial;
        } catch (_) { /* ignore */ }

        const metaIdent = document.querySelector('meta[itemprop="identifier"]');
        if (metaIdent && /^UC/.test(metaIdent.content)) return metaIdent.content;

        const metaChannel = document.querySelector('meta[itemprop="channelId"]');
        if (metaChannel && /^UC/.test(metaChannel.content)) return metaChannel.content;

        const link = document.querySelector('link[rel="canonical"]');
        if (link) {
            const m = link.href.match(/channel\/(UC[\w-]+)/);
            if (m) return m[1];
        }
        return null;
    }

    function uploadsPlaylistId(channelId) {
        return 'UU' + channelId.slice(2);
    }

    function getYtcfg(key) {
        if (window.ytcfg && typeof window.ytcfg.get === 'function') {
            try { return window.ytcfg.get(key); } catch (_) { /* ignore */ }
        }
        return null;
    }

    // ---------- innertube ----------

    async function browse(body) {
        const apiKey = getYtcfg('INNERTUBE_API_KEY');
        if (!apiKey) throw new Error('INNERTUBE_API_KEY не найден');
        const url = '/youtubei/v1/browse?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false';
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    function extractVideosFromPlaylistResponse(json) {
        const ids = [];
        let continuation = null;

        const initialItems = json
            && json.contents
            && json.contents.twoColumnBrowseResultsRenderer
            && json.contents.twoColumnBrowseResultsRenderer.tabs
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0]
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0]
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0]
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer
            && json.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;

        const continuationItems = json
            && json.onResponseReceivedActions
            && json.onResponseReceivedActions[0]
            && json.onResponseReceivedActions[0].appendContinuationItemsAction
            && json.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;

        const items = initialItems || continuationItems || [];

        for (const it of items) {
            if (it.playlistVideoRenderer && it.playlistVideoRenderer.videoId) {
                ids.push(it.playlistVideoRenderer.videoId);
            } else if (
                it.continuationItemRenderer
                && it.continuationItemRenderer.continuationEndpoint
                && it.continuationItemRenderer.continuationEndpoint.continuationCommand
            ) {
                continuation = it.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
            }
        }
        return { ids, continuation };
    }

    function extractVideoIdFromContent(content) {
        if (!content) return null;
        if (content.videoRenderer && content.videoRenderer.videoId) return content.videoRenderer.videoId;
        if (content.gridVideoRenderer && content.gridVideoRenderer.videoId) return content.gridVideoRenderer.videoId;
        if (content.reelItemRenderer && content.reelItemRenderer.videoId) return content.reelItemRenderer.videoId;
        if (content.compactVideoRenderer && content.compactVideoRenderer.videoId) return content.compactVideoRenderer.videoId;
        if (content.shortsLockupViewModel) {
            const ep = content.shortsLockupViewModel.onTap
                && content.shortsLockupViewModel.onTap.innertubeCommand;
            const reel = ep && (ep.reelWatchEndpoint || ep.watchEndpoint);
            if (reel && reel.videoId) return reel.videoId;
            const entityId = content.shortsLockupViewModel.entityId;
            if (entityId && /^shorts-shelf-item-/.test(entityId)) {
                const m = entityId.match(/^shorts-shelf-item-(.+)$/);
                if (m) return m[1];
            }
        }
        if (content.lockupViewModel) {
            const lvm = content.lockupViewModel;
            if (lvm.contentId
                && (lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO'
                    || lvm.contentType === 'LOCKUP_CONTENT_TYPE_SHORT'
                    || !lvm.contentType)) {
                return lvm.contentId;
            }
        }
        return null;
    }

    function extractVideosFromChannelVideosTab(json) {
        const ids = [];
        let continuation = null;

        const tabs = json
            && json.contents
            && json.contents.twoColumnBrowseResultsRenderer
            && json.contents.twoColumnBrowseResultsRenderer.tabs;

        let gridItems = null;
        if (tabs) {
            for (const t of tabs) {
                const r = t && t.tabRenderer;
                if (!r) continue;
                const grid = r.content
                    && r.content.richGridRenderer
                    && r.content.richGridRenderer.contents;
                if (grid && grid.length) { gridItems = grid; break; }
            }
        }

        const continuationItems = json
            && json.onResponseReceivedActions
            && json.onResponseReceivedActions[0]
            && json.onResponseReceivedActions[0].appendContinuationItemsAction
            && json.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;

        const items = gridItems || continuationItems || [];

        for (const it of items) {
            if (it.richItemRenderer && it.richItemRenderer.content) {
                const id = extractVideoIdFromContent(it.richItemRenderer.content);
                if (id) { ids.push(id); continue; }
            }
            if (it.richSectionRenderer
                && it.richSectionRenderer.content
                && it.richSectionRenderer.content.richShelfRenderer
                && Array.isArray(it.richSectionRenderer.content.richShelfRenderer.contents)) {
                for (const sub of it.richSectionRenderer.content.richShelfRenderer.contents) {
                    if (sub.richItemRenderer && sub.richItemRenderer.content) {
                        const id = extractVideoIdFromContent(sub.richItemRenderer.content);
                        if (id) ids.push(id);
                    }
                }
                continue;
            }
            if (
                it.continuationItemRenderer
                && it.continuationItemRenderer.continuationEndpoint
                && it.continuationItemRenderer.continuationEndpoint.continuationCommand
            ) {
                continuation = it.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
            }
        }
        return { ids, continuation };
    }

    async function fetchAllUploads(playlistId, onProgress) {
        const context = getYtcfg('INNERTUBE_CONTEXT');
        if (!context) throw new Error('INNERTUBE_CONTEXT не найден');

        const ids = [];
        let json = await browse({ context, browseId: playlistId });
        let parsed = extractVideosFromPlaylistResponse(json);
        ids.push(...parsed.ids);
        onProgress && onProgress(ids.length);

        while (parsed.continuation) {
            json = await browse({ context, continuation: parsed.continuation });
            parsed = extractVideosFromPlaylistResponse(json);
            ids.push(...parsed.ids);
            onProgress && onProgress(ids.length);
        }
        return ids;
    }

    async function fetchAllChannelVideosFallback(channelId, onProgress) {
        const context = getYtcfg('INNERTUBE_CONTEXT');
        if (!context) throw new Error('INNERTUBE_CONTEXT не найден');

        const ids = [];
        // params для таба Videos канала
        let json = await browse({ context, browseId: channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' });
        let parsed = extractVideosFromChannelVideosTab(json);
        ids.push(...parsed.ids);
        onProgress && onProgress(ids.length);

        while (parsed.continuation) {
            json = await browse({ context, continuation: parsed.continuation });
            parsed = extractVideosFromChannelVideosTab(json);
            ids.push(...parsed.ids);
            onProgress && onProgress(ids.length);
        }
        return ids;
    }

    // ---------- cache ----------

    function readCache(channelId) {
        try {
            const raw = sessionStorage.getItem(CACHE_PREFIX + channelId);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !Array.isArray(obj.ids) || !obj.ts) return null;
            if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
            return obj.ids;
        } catch (_) {
            return null;
        }
    }

    function writeCache(channelId, ids) {
        try {
            sessionStorage.setItem(
                CACHE_PREFIX + channelId,
                JSON.stringify({ ts: Date.now(), ids })
            );
        } catch (_) { /* quota — игнор */ }
    }

    // ---------- UI ----------

    function findSearchTab() {
        const expandable = document.querySelector('yt-tab-shape ytd-expandable-tab-renderer');
        if (expandable) return expandable.closest('yt-tab-shape');
        const lastTab = document.querySelector('yt-tab-shape.ytTabShapeLastTab');
        if (lastTab) return lastTab;
        return null;
    }

    function findTabBar() {
        // Предпочтительно: вставить перед кнопкой поиска
        const searchTab = findSearchTab();
        if (searchTab && searchTab.parentNode) {
            return { kind: 'new', container: searchTab.parentNode, before: searchTab };
        }
        // Fallback на контейнер табов
        const groupShape = document.querySelector('yt-page-header-renderer yt-tab-group-shape, yt-tab-group-shape');
        if (groupShape) {
            const tabsContainer = groupShape.querySelector('.yt-tab-group-shape-wiz__tabs')
                || groupShape.querySelector('[role="tablist"]')
                || groupShape;
            return { kind: 'new', container: tabsContainer, before: null };
        }
        // Старый layout (tp-yt-paper-tabs)
        const paperTabs = document.querySelector('ytd-c4-tabbed-header-renderer tp-yt-paper-tabs#tabs');
        if (paperTabs) {
            return { kind: 'old', container: paperTabs, before: null };
        }
        return null;
    }

    function buildNewTabElement(label) {
        const host = document.createElement('yt-tab-shape');
        host.id = TAB_ID;
        host.className = 'ytTabShapeHost';
        host.setAttribute('role', 'tab');
        host.setAttribute('aria-selected', 'false');
        host.tabIndex = 0;
        host.style.cursor = 'pointer';
        host.style.display = 'inline-flex';
        host.style.alignItems = 'center';

        const inner = document.createElement('div');
        inner.className = 'yt-tab-shape-wiz__tab';
        Object.assign(inner.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0 12px',
            height: '100%',
            fontFamily: "'Roboto','Arial',sans-serif",
            fontSize: '14px',
            fontWeight: '500',
            color: 'var(--yt-spec-text-primary)',
            userSelect: 'none',
            whiteSpace: 'nowrap',
        });

        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🎲';

        const text = document.createElement('span');
        text.className = 'rv-label';
        text.textContent = label;

        inner.appendChild(icon);
        inner.appendChild(text);
        host.appendChild(inner);
        return host;
    }

    function buildOldTabElement(label) {
        const tab = document.createElement('paper-tab');
        tab.id = TAB_ID;
        tab.setAttribute('role', 'tab');
        tab.style.cursor = 'pointer';
        tab.style.fontFamily = "'Roboto',sans-serif";
        tab.style.fontSize = '14px';
        tab.style.fontWeight = '500';
        tab.style.textTransform = 'uppercase';
        tab.style.letterSpacing = '.5px';

        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🎲';

        const text = document.createElement('span');
        text.className = 'rv-label';
        text.textContent = label;

        tab.appendChild(icon);
        tab.appendChild(document.createTextNode(' '));
        tab.appendChild(text);
        return tab;
    }

    function setBusyLabel(text) {
        const node = document.querySelector('#' + TAB_ID + ' .rv-label');
        if (node) node.textContent = text;
    }

    function resetLabel() {
        setBusyLabel('Случайное');
    }

    async function onTabClick() {
        if (busy) return;
        const channelId = getChannelId();
        if (!channelId) {
            alert('Не удалось определить ID канала.');
            return;
        }

        busy = true;
        setBusyLabel('Загрузка…');

        try {
            let ids = readCache(channelId);
            if (!ids) {
                const playlistId = uploadsPlaylistId(channelId);
                try {
                    ids = await fetchAllUploads(playlistId, n => setBusyLabel('Загрузка ' + n + '…'));
                } catch (e) {
                    console.warn('[RandomVideo] uploads playlist failed, fallback:', e);
                    ids = [];
                }
                if (!ids || ids.length === 0) {
                    ids = await fetchAllChannelVideosFallback(channelId, n => setBusyLabel('Загрузка ' + n + '…'));
                }
                if (ids.length > 0) writeCache(channelId, ids);
            }

            if (!ids || ids.length === 0) {
                alert('На канале не найдено видео.');
                return;
            }

            const pick = ids[Math.floor(Math.random() * ids.length)];
            const url = 'https://www.youtube.com/watch?v=' + pick + '&list=' + uploadsPlaylistId(channelId);
            location.href = url;
        } catch (e) {
            console.error('[RandomVideo]', e);
            alert('Ошибка загрузки видео: ' + (e && e.message ? e.message : e));
        } finally {
            busy = false;
            resetLabel();
        }
    }

    function injectTab() {
        if (!isChannelUrl()) return false;
        if (document.getElementById(TAB_ID)) return true;

        const bar = findTabBar();
        if (!bar) return false;

        const el = bar.kind === 'new'
            ? buildNewTabElement('Случайное')
            : buildOldTabElement('Случайное');
        el.addEventListener('click', onTabClick);
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTabClick();
            }
        });
        if (bar.before && bar.before.parentNode === bar.container) {
            bar.container.insertBefore(el, bar.before);
        } else {
            bar.container.appendChild(el);
        }
        return true;
    }

    function tryInjectWithRetries() {
        if (!isChannelUrl()) return;
        let tries = 0;
        const iv = setInterval(() => {
            tries++;
            if (injectTab() || tries >= MAX_TAB_WAIT_TRIES) clearInterval(iv);
        }, TAB_WAIT_INTERVAL_MS);
    }

    function onNavigate() {
        // На каждом переходе пробуем заново — старая кнопка может быть удалена вместе с шапкой
        tryInjectWithRetries();
    }

    window.addEventListener('yt-navigate-finish', onNavigate);
    // Случай прямого открытия URL канала
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onNavigate);
    } else {
        onNavigate();
    }
})();
