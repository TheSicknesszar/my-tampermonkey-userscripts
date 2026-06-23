// ==UserScript==
// @name         Arena.ai Lightbox Image Download
// @namespace    http://tampermonkey.net/
// @version      6.1.0
// @description  Arena.ai Image Lightbox with original/edited detection, EXIF metadata, zoom, touch + Batch download with progress overlay - Enhanced & Secure
// @author       TheSicknesszar
// @match        https://arena.ai/*
// @match        https://chat.lmsys.org/*
// @match        https://lmarena.ai/*
// @match        https://www.lmarena.ai/*
// @icon         https://arena.ai/favicon.ico
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_openInTab
// @connect      self
// @connect      *.arena.ai
// @connect      *.lmsys.org
// @connect      *.lmarena.ai
// @connect      *.cloudflarestream.com
// @connect      *.gstatic.com
// @connect      *.googleusercontent.com
// @run-at       document-idle
// @updateURL    https://github.com/TheSicknesszar/my-tampermonkey-userscripts#
// @downloadURL  https://github.com/TheSicknesszar/my-tampermonkey-userscripts#
// ==/UserScript==

(function() {
'use strict';

// ================== CONFIGURATION ==================
const DEFAULT_CONFIG = {
    // Image Detection
    MIN_IMG_WIDTH: 50,
    PRELOAD_NEIGHBORS: 2,
    TOUCH_SWIPE_THRESHOLD: 50,
    LOADING_TIMEOUT: 10000,
    DEBOUNCE_DELAY: 250,
    ZOOM_STEP: 0.2,
    MAX_ZOOM: 4,
    MIN_ZOOM: 0.1,

    // Batch Download Settings
    BATCH_DELAY_MS: 600,
    DOWNLOAD_PREFIX: '',
    MAX_FILENAME_LENGTH: 150,
    RETRY_COUNT: 2,
    RETRY_DELAY_MS: 1000,

    // Image Selectors
    IMAGE_SELECTORS: [
        'img[src*="blob:"]', 'img[src*="data:image"]', 'img[src*="storage"]',
        'img[src*="cdn"]', 'img[src*="upload"]', 'img[src*="image"]',
        '.image-container img', '.chat-image img', '.message-content img',
        '.response-image img', '[data-testid*="image"] img',
        '[class*="image"] img', '[class*="Image"] img', 'figure img',
        '.markdown img', '.prose img', 'img'
    ],

    // Exclude Selectors
    EXCLUDE_SELECTORS: [
        '.avatar', '.icon', '.logo', '.emoji',
        '[class*="avatar"]', '[class*="icon"]', '[class*="logo"]',
        '[class*="emoji"]', 'nav img', 'header img', 'footer img'
    ],

    // Original/Edited Detection
    EXIF_CHECK_ENABLED: true,
    FILENAME_PATTERNS: {
        ORIGINAL: [
            /original/i, /source/i, /input/i, /reference/i, /base/i, /initial/i,
            /^img_/i, /^photo_/i, /^DSC_/i, /^IMG_\d+/i, /^PXL_/i, /before/i, /raw/i
        ],
        EDITED: [
            /edited/i, /modified/i, /enhanced/i, /output/i, /result/i, /final/i,
            /processed/i, /_edit/i, /edit_/i, /_processed/i, /_enhanced/i,
            /_ai_/i, /_generated/i, /_styled/i, /_stablediffusion/i, /_midjourney/i,
            /_dalle/i, /_ai_generated/i, /_generated_by/i, /_by_ai/i, /_ai_art/i,
            /_neural/i, /_ml_/i, /_gan_/i, /_photoshop/i, /_ps_/i, /_retouched/i,
            /_filtered/i, /_style_transfer/i, /after/i, /v\d+/i
        ]
    },
    USER_PATTERNS: { ORIGINAL: [], EDITED: [] }
};

// Load user config with persistence
const CONFIG = loadConfig();

function loadConfig() {
    const saved = GM_getValue('lma_userConfig', {});
    return { ...DEFAULT_CONFIG, ...saved };
}

function saveConfig(partialConfig) {
    GM_setValue('lma_userConfig', { ...DEFAULT_CONFIG, ...partialConfig });
}

// ================== STATE ==================
let state = {
    allImages: [],
    currentIndex: 0,
    isOpen: false,
    isLoading: false,
    observer: null,
    preloadedImages: new Map(), // src -> blobUrl
    imageMetadata: new Map(), // imgElement -> metadata
    exifCache: new Map(), // urlHash -> metadata
    touchStartX: 0,
    touchStartY: 0,
    metadataPanelVisible: false,
    zoomState: { scale: 1, rotation: 0, panX: 0, panY: 0 },
    lastFocusedElement: null,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    initialized: false,
    retryCount: 0,
    // Batch Download State
    batchCancelled: false,
    batchInProgress: false,
    batchSelectionMode: false,
    selectedBatchIndices: new Set()
};

// ================== DOM ELEMENTS ==================
const elements = {};

// ================== UTILITY FUNCTIONS ==================
function log(message, type = 'info') {
    const prefix = '[LMA Lightbox]';
    switch(type) {
        case 'error': console.error(prefix, message); break;
        case 'warn': console.warn(prefix, message); break;
        default: console.log(prefix, message);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ XSS Protection: Sanitize HTML output
function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ✅ Simple hash for URL caching (not cryptographic, just for dedup)
async function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

function sanitizeFilename(str) {
    return str
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, CONFIG.MAX_FILENAME_LENGTH);
}

function getPageEntityName() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og?.content) return sanitizeFilename(og.content.split(' - ')[0].trim());
    if (document.title) {
        const t = document.title.replace(/\s*[–—-]\s*(IMDb|Official Site|Photos|Gallery).*$/i, '').trim();
        if (t) return sanitizeFilename(t);
    }
    return 'arena_images';
}

function getThumbnailUrl(url) {
    if (!url) return url;
    // Avoid modifying data/blob URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return url.replace(/\?.*$/, '') + '?w=100&h=100&fit=crop';
}

// ✅ Blob URL Management - Prevent Memory Leaks
function createBlobUrl(blob) {
    return URL.createObjectURL(blob);
}

function revokeBlobUrl(url) {
    if (url && url.startsWith('blob:')) {
        try { URL.revokeObjectURL(url); } catch(e) { /* ignore */ }
    }
}

function cleanupAllBlobUrls() {
    for (const [src, blobUrl] of state.preloadedImages) {
        revokeBlobUrl(blobUrl);
    }
    state.preloadedImages.clear();
}

// ================== CSS STYLES (with CSS Variables & Fallbacks) ==================
const css = `
:root {
    --lma-bg-overlay: rgba(10, 10, 10, 0.97);
    --lma-bg-panel: rgba(0, 0, 0, 0.9);
    --lma-bg-card: #1a1a2e;
    --lma-bg-thumb: #0d0d1a;
    --lma-text-primary: #fff;
    --lma-text-secondary: #aaa;
    --lma-text-muted: #888;
    --lma-border: rgba(255,255,255,0.15);
    --lma-primary: #4CAF50;
    --lma-primary-dim: rgba(76, 175, 80, 0.15);
    --lma-warning: #FF9800;
    --lma-warning-dim: rgba(255, 152, 0, 0.15);
    --lma-error: #F44336;
    --lma-error-dim: rgba(244, 67, 54, 0.15);
    --lma-accent: #2196F3;
    --lma-accent-dim: rgba(33, 150, 243, 0.15);
    --lma-gold: #f5c518;
    --lma-zindex-base: 100000;
    --lma-zindex-overlay: 100002;
    --lma-transition-fast: 0.2s ease;
    --lma-transition-normal: 0.3s ease;
}

/* === LIGHTBOX CORE === */
#lma-lightbox {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: var(--lma-bg-overlay); z-index: var(--lma-zindex-base);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: opacity var(--lma-transition-normal);
    backdrop-filter: blur(8px); font-family: -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow: hidden;
}
@supports not (backdrop-filter: blur(8px)) {
    #lma-lightbox { background: rgba(10, 10, 10, 0.97); }
}
#lma-lightbox.active { opacity: 1; pointer-events: auto; }

.lma-image-container {
    position: relative; max-width: 90%; max-height: 80vh;
    cursor: grab; user-select: none;
}
.lma-image-container.dragging { cursor: grabbing; }

#lma-main-img {
    max-width: 100%; max-height: 80vh; object-fit: contain;
    box-shadow: 0 0 40px rgba(0,0,0,0.6); border-radius: 6px;
    opacity: 1; transition: opacity var(--lma-transition-normal), transform var(--lma-transition-normal);
    transform-origin: center center;
}
#lma-main-img.loading { opacity: 0.3; }

/* === NAVIGATION BUTTONS === */
.lma-nav-btn {
    position: absolute; top: 50%; transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.08); color: #eee;
    border: 1px solid var(--lma-border); padding: 0; font-size: 26px;
    cursor: pointer; border-radius: 50%; width: 64px; height: 64px;
    display: flex; align-items: center; justify-content: center;
    transition: all var(--lma-transition-fast); user-select: none; z-index: 100;
}
.lma-nav-btn:hover, .lma-nav-btn:focus {
    background: rgba(255, 255, 255, 0.2); color: white;
    border-color: white; transform: translateY(-50%) scale(1.05);
    outline: 2px solid rgba(255,255,255,0.3);
}
.lma-nav-btn:active { transform: translateY(-50%) scale(0.95); }
.lma-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: translateY(-50%); }
#lma-prev { left: 30px; }
#lma-next { right: 30px; }

/* === TOOLBAR === */
.lma-toolbar {
    position: absolute; top: 25px; display: flex; gap: 15px; z-index: 100;
}
.lma-toolbar-left { left: 35px; }
.lma-toolbar-right { right: 35px; }

.lma-tool-btn {
    background: rgba(0, 0, 0, 0.6); color: var(--lma-text-primary);
    border: 1px solid var(--lma-border); border-radius: 10px;
    cursor: pointer; padding: 12px 18px; font-size: 14px; font-weight: 600;
    display: flex; align-items: center; gap: 8px; transition: all var(--lma-transition-fast);
}
.lma-tool-btn:hover, .lma-tool-btn:focus {
    background: white; color: black; outline: 2px solid rgba(255,255,255,0.5);
}
.lma-tool-btn svg { width: 18px; height: 18px; fill: currentColor; }
#lma-close { font-size: 28px; padding: 8px 18px; line-height: 1; }
.lma-tool-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* === ZOOM CONTROLS === */
.lma-zoom-controls {
    position: absolute; bottom: 120px; right: 35px;
    display: flex; gap: 10px; z-index: 100;
}
.lma-zoom-btn {
    background: rgba(0, 0, 0, 0.6); color: var(--lma-text-primary);
    border: 1px solid var(--lma-border); border-radius: 50%;
    width: 44px; height: 44px; display: flex; align-items: center;
    justify-content: center; cursor: pointer; font-size: 20px; transition: all var(--lma-transition-fast);
}
.lma-zoom-btn:hover { background: rgba(255, 255, 255, 0.2); transform: scale(1.1); }
.lma-zoom-btn:active { transform: scale(0.95); }

/* === INFO AREA === */
.lma-info-area {
    position: absolute; bottom: 35px; display: flex;
    flex-direction: column; align-items: center; gap: 10px;
    width: 100%; pointer-events: none;
}
#lma-filename {
    color: var(--lma-text-primary); font-size: 16px; background: rgba(0, 0, 0, 0.75);
    padding: 10px 20px; border-radius: 8px; max-width: 80%;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    pointer-events: auto; border: 1px solid var(--lma-border);
}
#lma-counter {
    color: var(--lma-text-secondary); font-size: 14px; background: rgba(0,0,0,0.7);
    padding: 6px 14px; border-radius: 20px;
}

/* === METADATA PANEL === */
#lma-metadata-panel {
    position: absolute; top: 85px; left: 35px;
    background: var(--lma-bg-panel); border: 1px solid var(--lma-border);
    border-radius: 12px; padding: 20px; color: var(--lma-text-primary); font-size: 13px;
    max-width: 320px; max-height: 70vh; overflow-y: auto; z-index: 99;
    display: none; backdrop-filter: blur(10px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    animation: lma-slide-in 0.2s ease-out;
}
@supports not (backdrop-filter: blur(10px)) {
    #lma-metadata-panel { background: rgba(0, 0, 0, 0.95); }
}
@keyframes lma-slide-in {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
#lma-metadata-panel.active { display: block; }

.lma-metadata-title {
    font-weight: bold; margin-bottom: 15px; color: var(--lma-primary);
    font-size: 15px; display: flex; align-items: center; gap: 8px;
}
.lma-metadata-section {
    margin-bottom: 15px; padding-bottom: 15px;
    border-bottom: 1px solid var(--lma-border);
}
.lma-metadata-section:last-child {
    border-bottom: none; margin-bottom: 0; padding-bottom: 0;
}
.lma-metadata-section-title {
    font-size: 12px; color: var(--lma-text-secondary); margin-bottom: 8px;
    text-transform: uppercase; letter-spacing: 1px;
}
.lma-metadata-item {
    margin-bottom: 8px; display: flex; justify-content: space-between;
    align-items: flex-start;
}
.lma-metadata-label { color: #ccc; min-width: 120px; font-size: 12px; }
.lma-metadata-value {
    color: var(--lma-text-primary); font-family: 'SF Mono', Monaco, Consolas, monospace;
    text-align: right; max-width: 180px; overflow: hidden;
    text-overflow: ellipsis; font-size: 12px; line-height: 1.4;
}

/* === TYPE INDICATORS === */
.lma-type-indicator-metadata {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 12px; font-size: 11px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    margin-left: 8px; border: 2px solid currentColor;
}
.lma-type-indicator-metadata.original {
    background: var(--lma-primary-dim); color: var(--lma-primary); border-color: var(--lma-primary);
}
.lma-type-indicator-metadata.edited {
    background: var(--lma-accent-dim); color: var(--lma-accent); border-color: var(--lma-accent);
}
.lma-type-indicator-metadata.unknown {
    background: rgba(158, 158, 158, 0.15); color: #9E9E9E; border-color: #9E9E9E;
}

/* === CONFIDENCE METER === */
.lma-confidence-meter {
    width: 100%; height: 6px; background: rgba(255,255,255,0.1);
    border-radius: 3px; margin-top: 5px; overflow: hidden;
}
.lma-confidence-fill { height: 100%; border-radius: 3px; transition: width var(--lma-transition-normal); }
.lma-confidence-fill.high { background: linear-gradient(90deg, var(--lma-primary), #8BC34A); }
.lma-confidence-fill.medium { background: linear-gradient(90deg, var(--lma-warning), #FFC107); }
.lma-confidence-fill.low { background: linear-gradient(90deg, var(--lma-error), var(--lma-warning)); }

/* === LOADING SPINNER === */
.lma-loading {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%); width: 50px; height: 50px;
    border: 3px solid rgba(255,255,255,0.3); border-radius: 50%;
    border-top-color: white; animation: lma-spin 1s linear infinite;
    z-index: 10; display: none;
}
.lma-loading.active { display: block; }
@keyframes lma-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }

/* === HELP MODAL === */
#lma-help-modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.95); color: var(--lma-text-primary); padding: 30px;
    border-radius: 12px; z-index: calc(var(--lma-zindex-base) + 1); max-width: 450px; width: 90%;
    border: 1px solid var(--lma-border);
    box-shadow: 0 20px 60px rgba(0,0,0,0.5); display: none;
    max-height: 80vh; overflow-y: auto;
}
#lma-help-modal.active { display: block; animation: lma-fade-in 0.2s ease-out; }
@keyframes lma-fade-in {
    from { opacity: 0; transform: translate(-50%, -45%); }
    to { opacity: 1; transform: translate(-50%, -50%); }
}
.lma-help-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 25px; padding-bottom: 15px;
    border-bottom: 1px solid var(--lma-border);
}
.lma-help-title { font-size: 20px; font-weight: 600; color: var(--lma-primary); }
.lma-help-close {
    background: none; border: none; color: var(--lma-text-primary); font-size: 28px;
    cursor: pointer; padding: 0; width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center; border-radius: 50%;
}
.lma-help-close:hover { background: rgba(255,255,255,0.1); }
.lma-help-section { margin-bottom: 20px; }
.lma-help-section-title {
    font-size: 14px; color: var(--lma-text-secondary); margin-bottom: 10px;
    text-transform: uppercase; letter-spacing: 1px;
}
.lma-help-shortcuts { display: grid; grid-template-columns: 1fr; gap: 8px; }
.lma-help-item {
    display: flex; justify-content: space-between; padding: 8px 0;
    border-bottom: 1px solid var(--lma-border);
}
.lma-help-key {
    font-family: 'SF Mono', Monaco, Consolas, monospace;
    background: rgba(255,255,255,0.1); padding: 4px 8px;
    border-radius: 4px;
}

/* === BATCH DOWNLOAD OVERLAY (IMDb Style) === */
@keyframes lma-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }
@keyframes lma-pop { 0% { transform: scale(1) } 50% { transform: scale(1.12) } 100% { transform: scale(1) } }
@keyframes lma-glow { 0% { box-shadow: 0 0 10px rgba(39,174,96,0.8) } 100% { box-shadow: none } }

#lma-batch-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.85);
    z-index: var(--lma-zindex-overlay); display: flex; align-items: center;
    justify-content: center; font-family: system-ui, sans-serif;
}

.lma-batch-card {
    background: var(--lma-bg-card); color: #eee; padding: 24px 28px;
    border-radius: 14px; width: 560px; max-width: 92vw;
    box-shadow: 0 12px 40px rgba(0,0,0,0.6); max-height: 88vh;
    display: flex; flex-direction: column;
}

.lma-batch-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px; flex-shrink: 0;
}
.lma-batch-header h3 { margin: 0; color: var(--lma-gold); }
.lma-batch-folder {
    font-size: 11px; color: var(--lma-text-muted); background: #111;
    padding: 3px 10px; border-radius: 6px;
}

#lma-batch-status {
    margin-bottom: 8px; flex-shrink: 0; font-size: 14px;
}

.lma-batch-bar-container {
    background: #333; border-radius: 8px; overflow: hidden;
    height: 22px; margin-bottom: 6px; flex-shrink: 0;
}
#lma-batch-bar {
    height: 100%; width: 0%; border-radius: 8px;
    background: linear-gradient(90deg, var(--lma-gold), #e6b800);
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: #000;
    transition: width var(--lma-transition-normal);
}

#lma-batch-file {
    font-size: 11px; color: var(--lma-text-muted); word-break: break-all;
    min-height: 16px; margin-bottom: 10px; flex-shrink: 0;
}

#lma-batch-grid {
    display: flex; flex-wrap: wrap; gap: 5px; overflow-y: auto;
    margin-bottom: 14px; padding: 8px; border-radius: 8px;
    background: var(--lma-bg-thumb); min-height: 80px; max-height: 45vh;
    align-content: flex-start;
}

.lma-batch-thumb {
    position: relative; width: 68px; height: 68px;
    border-radius: 6px; overflow: hidden; border: 2px solid #333;
    opacity: 0.35; transition: all var(--lma-transition-normal); flex-shrink: 0; background: #222;
    cursor: pointer;
}
.lma-batch-thumb img {
    width: 100%; height: 100%; object-fit: cover; display: block;
}
.lma-batch-thumb-badge {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: rgba(0,0,0,0.75); text-align: center;
    font-size: 9px; padding: 2px 0; color: #777; font-weight: 600;
    transition: all var(--lma-transition-fast);
}
.lma-batch-thumb.active {
    opacity: 1; border-color: var(--lma-gold);
    box-shadow: 0 0 10px rgba(245,197,24,0.4);
}
.lma-batch-thumb.active .lma-batch-thumb-badge {
    background: rgba(245,197,24,0.85); color: #000;
}
.lma-batch-thumb.done {
    opacity: 1; border-color: #27ae60; animation: lma-glow 0.6s ease;
}
.lma-batch-thumb.done .lma-batch-thumb-badge {
    background: rgba(39,174,96,0.85); color: #fff;
}
.lma-batch-thumb.fail { opacity: 0.55; border-color: var(--lma-error); }
.lma-batch-thumb.fail .lma-batch-thumb-badge {
    background: rgba(231,76,60,0.85); color: #fff;
}
.lma-batch-thumb.selected {
    border-color: var(--lma-accent);
    box-shadow: 0 0 0 2px var(--lma-accent-dim);
}
.lma-batch-thumb.selected .lma-batch-thumb-badge {
    background: var(--lma-accent); color: #fff;
}

.lma-batch-footer {
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0;
}
.lma-batch-stats { font-size: 13px; color: var(--lma-text-muted); }
.lma-batch-stats span { font-weight: 700; }
#lma-batch-ok { color: #27ae60; }
#lma-batch-fail { color: var(--lma-error); }

#lma-batch-cancel {
    background: var(--lma-error); color: #fff; border: none;
    padding: 8px 22px; border-radius: 8px; cursor: pointer;
    font-size: 14px; font-weight: 600; transition: background var(--lma-transition-fast);
}
#lma-batch-cancel:hover { background: #c0392b; }

/* === BATCH BUTTON IN LIGHTBOX === */
#lma-batch-btn {
    background: linear-gradient(135deg, #3498db, #2980b9);
    border: 1px solid var(--lma-border);
}
#lma-batch-btn:hover {
    background: linear-gradient(135deg, #5dade2, #3498db);
}

.lma-live-dot {
    display: inline-block; width: 8px; height: 8px;
    background: #2ecc71; border-radius: 50%;
    animation: lma-pulse 1.5s infinite; margin-left: 6px;
    vertical-align: middle;
}
.lma-count-pop { animation: lma-pop 0.3s ease; }

/* === BATCH SELECTION TOGGLE === */
#lma-batch-select-toggle {
    background: rgba(33, 150, 243, 0.2);
    border-color: var(--lma-accent);
    color: var(--lma-accent);
}
#lma-batch-select-toggle.active {
    background: var(--lma-accent);
    color: white;
}

/* === RESPONSIVE === */
@media (max-width: 768px) {
    .lma-nav-btn { width: 52px; height: 52px; font-size: 22px; }
    #lma-prev { left: 15px; } #lma-next { right: 15px; }
    .lma-toolbar-left { left: 15px; top: 15px; }
    .lma-toolbar-right { right: 15px; top: 15px; }
    .lma-tool-btn { padding: 10px 14px; font-size: 13px; }
    .lma-zoom-controls { bottom: 100px; right: 15px; }
    .lma-zoom-btn { width: 38px; height: 38px; font-size: 18px; }
    #lma-filename { font-size: 14px; padding: 8px 16px; }
    #lma-counter { font-size: 13px; padding: 5px 12px; }
    #lma-metadata-panel { top: 70px; left: 15px; max-width: 280px; padding: 15px; }
    .lma-batch-card { width: 95vw; padding: 18px; }
    .lma-batch-thumb { width: 56px; height: 56px; }
}
@media (max-width: 480px) {
    .lma-nav-btn { width: 44px; height: 44px; font-size: 20px; }
    .lma-tool-btn { padding: 8px 12px; font-size: 12px; }
    #lma-metadata-panel { max-width: 250px; padding: 12px; }
    .lma-zoom-controls { flex-direction: column; bottom: 150px; }
    #lma-batch-grid { max-height: 30vh; }
}
`;

GM_addStyle(css);

// ================== IMAGE COLLECTION ==================
function isValidTargetImage(img) {
    if (!img.src) return false;
    if (img.offsetWidth < CONFIG.MIN_IMG_WIDTH && img.offsetHeight < CONFIG.MIN_IMG_WIDTH) return false;
    for (let exclude of CONFIG.EXCLUDE_SELECTORS) {
        if (img.closest(exclude)) return false;
    }
    return true;
}

function getAllImages() {
    log('Scanning for images...');
    const candidates = new Set();

    CONFIG.IMAGE_SELECTORS.forEach(selector => {
        document.querySelectorAll(selector).forEach(img => {
            if (isValidTargetImage(img)) {
                candidates.add(img);
            }
        });
    });

    const images = Array.from(candidates);
    log(`Found ${images.length} images`);
    return images;
}

// ================== EXIF PARSER ==================
const ExifParser = {
    parse(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const dv = new DataView(e.target.result);
                    const tags = this.readEXIF(dv);
                    resolve(tags);
                } catch (err) { reject(err); }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });
    },

    readEXIF(dv) {
        if (dv.getUint16(0) !== 0xFFD8) return {};
        let offset = 2;
        const length = dv.byteLength;
        while (offset < length) {
            const marker = dv.getUint16(offset);
            offset += 2;
            if (marker === 0xFFE1) {
                const segmentLength = dv.getUint16(offset);
                offset += 2;
                if (dv.getUint32(offset) === 0x45786966) {
                    offset += 6;
                    return this.parseTIFF(dv, offset);
                } else { offset += segmentLength - 2; }
            } else if (marker >= 0xFFC0 && marker <= 0xFFDA) {
                const segLength = dv.getUint16(offset);
                offset += segLength;
            } else if (marker === 0xFFD9) break;
        }
        return {};
    },

    parseTIFF(dv, offset) {
        const littleEndian = dv.getUint16(offset) === 0x4949;
        offset += 2;
        if (dv.getUint16(offset, littleEndian) !== 0x002A) return {};
        offset += 2;
        const ifdOffset = dv.getUint32(offset, littleEndian);
        offset = offset + ifdOffset - 8;
        const tags = {};
        const numEntries = dv.getUint16(offset, littleEndian);
        offset += 2;
        for (let i = 0; i < numEntries; i++) {
            const tag = dv.getUint16(offset, littleEndian);
            const type = dv.getUint16(offset + 2, littleEndian);
            const count = dv.getUint32(offset + 4, littleEndian);
            const valueOffset = dv.getUint32(offset + 8, littleEndian);
            offset += 12;
            const dataOffset = offset + valueOffset - 12;
            let value;
            if (type === 2) {
                if (count <= 4) {
                    value = String.fromCharCode(
                        valueOffset & 0xFF, (valueOffset >> 8) & 0xFF,
                        (valueOffset >> 16) & 0xFF, (valueOffset >> 24) & 0xFF
                    ).replace(/\0/g, '');
                } else {
                    let str = '';
                    for (let j = 0; j < count - 1; j++) {
                        const charCode = dv.getUint8(dataOffset + j);
                        if (charCode === 0) break;
                        str += String.fromCharCode(charCode);
                    }
                    value = str;
                }
            } else if (type === 3) { value = dv.getUint16(dataOffset, littleEndian); }
            else if (type === 4) { value = dv.getUint32(dataOffset, littleEndian); }
            else continue;
            const tagNames = {
                0x010E: 'ImageDescription', 0x010F: 'Make', 0x0110: 'Model',
                0x0132: 'ModifyDate', 0x8298: 'Copyright', 0x9003: 'DateTimeOriginal',
                0x9004: 'DateTimeDigitized', 0x9201: 'ShutterSpeed', 0x9202: 'Aperture',
                0x9204: 'ExposureBias', 0x9207: 'MeteringMode', 0x9209: 'Flash',
                0x920A: 'FocalLength', 0xA002: 'PixelXDimension', 0xA003: 'PixelYDimension'
            };
            const tagName = tagNames[tag] || '0x' + tag.toString(16);
            tags[tagName] = value;
        }
        return tags;
    }
};

// ================== IMAGE TYPE DETECTION ==================
function detectImageType(imgElement, metadata) {
    let score = { original: 0, edited: 0, reasons: [] };
    const src = imgElement.src || '';
    const alt = imgElement.alt || '';
    const filename = src.split('/').pop().split('?')[0];

    for (let pattern of CONFIG.FILENAME_PATTERNS.ORIGINAL) {
        if (pattern.test(filename) || pattern.test(alt)) {
            score.original += 30;
            score.reasons.push('Filename matches original: ' + pattern);
        }
    }
    for (let pattern of CONFIG.FILENAME_PATTERNS.EDITED) {
        if (pattern.test(filename) || pattern.test(alt)) {
            score.edited += 30;
            score.reasons.push('Filename matches edited: ' + pattern);
        }
    }
    for (let pattern of CONFIG.USER_PATTERNS.ORIGINAL) {
        if (pattern.test(filename) || pattern.test(alt)) {
            score.original += 20;
            score.reasons.push('User pattern matches original: ' + pattern);
        }
    }
    for (let pattern of CONFIG.USER_PATTERNS.EDITED) {
        if (pattern.test(filename) || pattern.test(alt)) {
            score.edited += 20;
            score.reasons.push('User pattern matches edited: ' + pattern);
        }
    }

    if (metadata && Object.keys(metadata).length > 0) {
        if (metadata.Make || metadata.Model) {
            score.original += 25;
            score.reasons.push('EXIF contains camera make/model');
        }
        if (metadata.Software && /photoshop|lightroom|editor/i.test(metadata.Software)) {
            score.edited += 35;
            score.reasons.push('EXIF software indicates editing: ' + metadata.Software);
        }
        if (metadata.DateTimeOriginal && metadata.ModifyDate &&
            metadata.DateTimeOriginal !== metadata.ModifyDate) {
            score.edited += 15;
            score.reasons.push('ModifyDate differs from DateTimeOriginal');
        }
    } else {
        score.edited += 5;
        score.reasons.push('No EXIF metadata found (may be generated)');
    }

    const total = score.original + score.edited;
    if (total === 0) return { type: 'unknown', confidence: 0, reasons: ['No patterns matched'] };

    const confidence = Math.max(score.original, score.edited) / total * 100;
    const type = score.original > score.edited ? 'original' :
                 (score.edited > score.original ? 'edited' : 'unknown');

    return { type, confidence: Math.round(confidence), reasons: score.reasons };
}

// ================== METADATA FETCHING (with caching) ==================
async function fetchMetadata(imgElement) {
    const src = imgElement.src;
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) {
        return { note: 'Cannot fetch EXIF for data/blob URLs' };
    }

    // ✅ Check cache first
    const urlHash = await simpleHash(src);
    if (state.exifCache.has(urlHash)) {
        return state.exifCache.get(urlHash);
    }

    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            method: 'GET', url: src, responseType: 'blob',
            onload: function(resp) {
                if (resp.status >= 200 && resp.status < 300) {
                    ExifParser.parse(resp.response)
                        .then(tags => {
                            state.exifCache.set(urlHash, tags); // ✅ Cache result
                            resolve(tags);
                        })
                        .catch(err => {
                            const result = { error: 'EXIF parse failed', details: err.message };
                            state.exifCache.set(urlHash, result);
                            resolve(result);
                        });
                } else {
                    const result = { error: 'HTTP ' + resp.status };
                    state.exifCache.set(urlHash, result);
                    resolve(result);
                }
            },
            onerror: function(err) {
                const result = { error: 'Network error' };
                state.exifCache.set(urlHash, result);
                resolve(result);
            }
        });
    });
}

// ================== LIGHTBOX DOM CREATION (with ARIA) ==================
function createLightbox() {
    if (document.getElementById('lma-lightbox')) return;

    const html = `
<div id="lma-lightbox" role="dialog" aria-modal="true" aria-label="Image lightbox">
    <div class="lma-loading" id="lma-loading" aria-live="polite"></div>
    <div class="lma-image-container" id="lma-image-container" tabindex="0">
        <img id="lma-main-img" src="" alt="Lightbox image" role="img" aria-live="polite">
    </div>
    <button class="lma-nav-btn" id="lma-prev" title="Previous (←)" aria-label="Previous image">‹</button>
    <button class="lma-nav-btn" id="lma-next" title="Next (→)" aria-label="Next image">›</button>

    <div class="lma-toolbar lma-toolbar-left">
        <button class="lma-tool-btn" id="lma-close" title="Close (ESC)" aria-label="Close lightbox">✕</button>
        <button class="lma-tool-btn" id="lma-metadata-toggle" title="Toggle Metadata Panel (M)" aria-label="Toggle metadata">
            <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
            Metadata
        </button>
        <button class="lma-tool-btn" id="lma-download" title="Download Image (D)" aria-label="Download current image">
            <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Download
        </button>
        <button class="lma-tool-btn" id="lma-batch-btn" title="Batch Download All" aria-label="Batch download all images">
            <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2.06 11L15 15.28 12.06 17l.78-3.33-2.59-2.24 3.41-.29L15 8l1.34 3.14 3.41.29-2.59 2.24.78 3.33z"/></svg>
            Batch <span id="lma-batch-count">0</span><span class="lma-live-dot"></span>
        </button>
        <button class="lma-tool-btn" id="lma-batch-select-toggle" title="Toggle Selection Mode" aria-label="Toggle batch selection mode">
            <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            Select
        </button>
        <button class="lma-tool-btn" id="lma-help-btn" title="Help (H)" aria-label="Show keyboard shortcuts">?</button>
    </div>

    <div class="lma-toolbar lma-toolbar-right">
        <button class="lma-tool-btn" id="lma-rotate-left" title="Rotate Left (R)" aria-label="Rotate left">↺</button>
        <button class="lma-tool-btn" id="lma-rotate-right" title="Rotate Right (R with Shift)" aria-label="Rotate right">↻</button>
        <button class="lma-tool-btn" id="lma-reset-zoom" title="Reset Zoom (0)" aria-label="Reset zoom and pan">⤬</button>
    </div>

    <div class="lma-zoom-controls">
        <button class="lma-zoom-btn" id="lma-zoom-out" title="Zoom Out (Ctrl -)" aria-label="Zoom out">−</button>
        <button class="lma-zoom-btn" id="lma-zoom-in" title="Zoom In (Ctrl +)" aria-label="Zoom in">+</button>
    </div>

    <div class="lma-info-area">
        <div id="lma-filename" aria-live="polite"></div>
        <div id="lma-counter" aria-live="polite"></div>
    </div>

    <div id="lma-metadata-panel" role="region" aria-label="Image metadata panel">
        <div class="lma-metadata-title">
            Image Metadata
            <span class="lma-type-indicator-metadata" id="lma-metadata-type">Unknown</span>
        </div>
        <div class="lma-metadata-section">
            <div class="lma-metadata-section-title">Detection Confidence</div>
            <div class="lma-metadata-item">
                <span class="lma-metadata-label">Type:</span>
                <span class="lma-metadata-value" id="lma-detection-type">Unknown</span>
            </div>
            <div class="lma-metadata-item">
                <span class="lma-metadata-label">Confidence:</span>
                <span class="lma-metadata-value" id="lma-detection-confidence">0%</span>
            </div>
            <div class="lma-confidence-meter" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                <div class="lma-confidence-fill" id="lma-confidence-fill" style="width:0%"></div>
            </div>
            <div class="lma-metadata-item">
                <span class="lma-metadata-label">Reasons:</span>
                <span class="lma-metadata-value" id="lma-detection-reasons"></span>
            </div>
        </div>
        <div class="lma-metadata-section">
            <div class="lma-metadata-section-title">EXIF / Technical</div>
            <div id="lma-metadata-content">Loading...</div>
        </div>
    </div>

    <div id="lma-help-modal" role="dialog" aria-label="Keyboard shortcuts help">
        <div class="lma-help-header">
            <span class="lma-help-title">Keyboard Shortcuts</span>
            <button class="lma-help-close" id="lma-help-close" aria-label="Close help">✕</button>
        </div>
        <div class="lma-help-section">
            <div class="lma-help-section-title">Navigation</div>
            <div class="lma-help-shortcuts">
                <div class="lma-help-item"><span class="lma-help-key">← / →</span> Previous/Next image</div>
                <div class="lma-help-item"><span class="lma-help-key">ESC</span> Close lightbox</div>
                <div class="lma-help-item"><span class="lma-help-key">Home / End</span> First/Last image</div>
            </div>
        </div>
        <div class="lma-help-section">
            <div class="lma-help-section-title">Zoom & Pan</div>
            <div class="lma-help-shortcuts">
                <div class="lma-help-item"><span class="lma-help-key">Ctrl + / -</span> Zoom in/out</div>
                <div class="lma-help-item"><span class="lma-help-key">0</span> Reset zoom</div>
                <div class="lma-help-item"><span class="lma-help-key">Drag</span> Pan when zoomed</div>
            </div>
        </div>
        <div class="lma-help-section">
            <div class="lma-help-section-title">Tools</div>
            <div class="lma-help-shortcuts">
                <div class="lma-help-item"><span class="lma-help-key">M</span> Toggle metadata panel</div>
                <div class="lma-help-item"><span class="lma-help-key">D</span> Download image</div>
                <div class="lma-help-item"><span class="lma-help-key">B</span> Batch download all</div>
                <div class="lma-help-item"><span class="lma-help-key">S</span> Toggle selection mode</div>
                <div class="lma-help-item"><span class="lma-help-key">R</span> Rotate left</div>
                <div class="lma-help-item"><span class="lma-help-key">Shift+R</span> Rotate right</div>
                <div class="lma-help-item"><span class="lma-help-key">H</span> Show this help</div>
            </div>
        </div>
    </div>
</div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    // Lightbox Elements
    elements.lightbox = document.getElementById('lma-lightbox');
    elements.mainImg = document.getElementById('lma-main-img');
    elements.loading = document.getElementById('lma-loading');
    elements.prevBtn = document.getElementById('lma-prev');
    elements.nextBtn = document.getElementById('lma-next');
    elements.closeBtn = document.getElementById('lma-close');
    elements.filenameEl = document.getElementById('lma-filename');
    elements.counterEl = document.getElementById('lma-counter');
    elements.metadataPanel = document.getElementById('lma-metadata-panel');
    elements.metadataToggle = document.getElementById('lma-metadata-toggle');
    elements.downloadBtn = document.getElementById('lma-download');
    elements.batchBtn = document.getElementById('lma-batch-btn');
    elements.batchCount = document.getElementById('lma-batch-count');
    elements.batchSelectToggle = document.getElementById('lma-batch-select-toggle');
    elements.rotateLeft = document.getElementById('lma-rotate-left');
    elements.rotateRight = document.getElementById('lma-rotate-right');
    elements.resetZoom = document.getElementById('lma-reset-zoom');
    elements.zoomIn = document.getElementById('lma-zoom-in');
    elements.zoomOut = document.getElementById('lma-zoom-out');
    elements.helpBtn = document.getElementById('lma-help-btn');
    elements.helpModal = document.getElementById('lma-help-modal');
    elements.helpClose = document.getElementById('lma-help-close');
    elements.imageContainer = document.getElementById('lma-image-container');

    // Metadata Panel Elements
    elements.metaType = document.getElementById('lma-metadata-type');
    elements.detectionType = document.getElementById('lma-detection-type');
    elements.detectionConfidence = document.getElementById('lma-detection-confidence');
    elements.confidenceFill = document.getElementById('lma-confidence-fill');
    elements.detectionReasons = document.getElementById('lma-detection-reasons');
    elements.metadataContent = document.getElementById('lma-metadata-content');
}

// ✅ Focus Trap for Accessibility
function trapFocus(element) {
    const focusable = element.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeydown = (e) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey && document.activeElement === first) {
            last.focus(); e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
            first.focus(); e.preventDefault();
        }
    };

    element.addEventListener('keydown', handleKeydown);
    return () => element.removeEventListener('keydown', handleKeydown);
}

// ================== LIGHTBOX ACTIONS ==================
function openLightbox(index) {
    if (!state.allImages.length) { log('No images to show', 'warn'); return; }
    state.lastFocusedElement = document.activeElement;
    state.isOpen = true;
    elements.lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';

    // ✅ Set up focus trap
    state.focusTrapCleanup = trapFocus(elements.lightbox);

    navigateTo(index);
    elements.mainImg.focus();
    updateBatchCount();
}

function closeLightbox() {
    state.isOpen = false;
    elements.lightbox.classList.remove('active');
    document.body.style.overflow = '';

    // ✅ Clean up focus trap
    if (state.focusTrapCleanup) {
        state.focusTrapCleanup();
        state.focusTrapCleanup = null;
    }

    // ✅ Revoke all blob URLs to prevent memory leaks
    cleanupAllBlobUrls();

    resetZoomAndPan();
    if (state.lastFocusedElement) {
        state.lastFocusedElement.focus();
        state.lastFocusedElement = null;
    }
    state.metadataPanelVisible = false;
    elements.metadataPanel.classList.remove('active');
    elements.helpModal.classList.remove('active');
}

function navigateTo(index) {
    if (!state.allImages.length) return;
    if (index < 0) index = 0;
    if (index >= state.allImages.length) index = state.allImages.length - 1;
    state.currentIndex = index;
    updateNavigationButtons();
    loadImageAtIndex(index);
    preloadNeighbors(index);
}

function updateNavigationButtons() {
    elements.prevBtn.disabled = state.currentIndex === 0;
    elements.nextBtn.disabled = state.currentIndex === state.allImages.length - 1;
}

function updateBatchCount() {
    if (elements.batchCount) {
        elements.batchCount.textContent = state.allImages.length;
    }
}

// ✅ Lazy Preloading Strategy
function preloadSingleImage(img) {
    if (!img) return;
    const src = img.src;
    if (!src || state.preloadedImages.has(src)) return;

    GM_xmlhttpRequest({
        method: 'GET', url: src, responseType: 'blob',
        onload: (resp) => {
            if (resp.status >= 200 && resp.status < 300) {
                const blob = resp.response;
                const blobUrl = createBlobUrl(blob);
                state.preloadedImages.set(src, blobUrl);
            }
        }
    });
}

function preloadNeighbors(index) {
    // Preload only 1 neighbor immediately for performance
    const nextIndex = index + 1;
    if (nextIndex < state.allImages.length) {
        preloadSingleImage(state.allImages[nextIndex]);
    }

    // Preload second neighbor after delay (if still viewing same image)
    setTimeout(() => {
        if (state.isOpen && state.currentIndex === index) {
            const nextNext = index + 2;
            if (nextNext < state.allImages.length) {
                preloadSingleImage(state.allImages[nextNext]);
            }
        }
    }, 500);
}

function loadImageAtIndex(index) {
    const img = state.allImages[index];
    if (!img) return;
    state.isLoading = true;
    elements.loading.classList.add('active');
    elements.mainImg.classList.add('loading');
    resetZoomAndPan();

    const src = img.src;
    const filename = src.split('/').pop().split('?')[0] || 'image';
    elements.filenameEl.textContent = filename;
    elements.counterEl.textContent = (index + 1) + ' / ' + state.allImages.length;

    if (state.preloadedImages.has(src)) {
        const blobUrl = state.preloadedImages.get(src);
        setImageSrc(blobUrl, filename);
        // Fetch metadata for preloaded image
        fetchAndDisplayMetadata(img);
    } else {
        GM_xmlhttpRequest({
            method: 'GET', url: src, responseType: 'blob',
            onload: (resp) => {
                if (resp.status >= 200 && resp.status < 300) {
                    const blob = resp.response;
                    const blobUrl = createBlobUrl(blob);
                    state.preloadedImages.set(src, blobUrl);
                    setImageSrc(blobUrl, filename);
                    fetchAndDisplayMetadata(img, blob);
                } else {
                    setImageSrc(src, filename);
                    log('Failed to fetch image: ' + resp.status, 'error');
                }
            },
            onerror: (err) => {
                setImageSrc(src, filename);
                log('Network error fetching image', 'error');
            }
        });
    }
}

function setImageSrc(src, filename) {
    elements.mainImg.onload = () => {
        state.isLoading = false;
        elements.loading.classList.remove('active');
        elements.mainImg.classList.remove('loading');
    };
    elements.mainImg.onerror = () => {
        state.isLoading = false;
        elements.loading.classList.remove('active');
        elements.mainImg.classList.remove('loading');
        elements.mainImg.src = '';
        log('Image failed to load', 'error');
    };
    elements.mainImg.src = src;
    elements.downloadBtn.onclick = () => downloadImage(src, filename);
}

function downloadImage(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function fetchAndDisplayMetadata(imgElement, blob = null) {
    if (!CONFIG.EXIF_CHECK_ENABLED) return;

    let metadata = {};
    try {
        if (blob) {
            metadata = await ExifParser.parse(blob);
        } else {
            metadata = await fetchMetadata(imgElement);
        }
    } catch (e) {
        metadata = { error: 'EXIF parsing failed: ' + e.message };
    }

    state.imageMetadata.set(imgElement, metadata);

    if (state.isOpen && state.allImages[state.currentIndex] === imgElement) {
        updateMetadataPanel(imgElement, metadata);
    }
}

function updateMetadataPanel(imgElement, metadata) {
    const detection = detectImageType(imgElement, metadata);

    // Update type indicator
    elements.metaType.className = 'lma-type-indicator-metadata ' + detection.type;
    elements.metaType.textContent = detection.type.charAt(0).toUpperCase() + detection.type.slice(1);

    // Update detection info
    elements.detectionType.textContent = detection.type;
    elements.detectionConfidence.textContent = detection.confidence + '%';
    elements.confidenceFill.style.width = detection.confidence + '%';
    elements.confidenceFill.className = 'lma-confidence-fill ' +
        (detection.confidence >= 70 ? 'high' : detection.confidence >= 40 ? 'medium' : 'low');

    // ✅ Update ARIA value for progress bar
    elements.confidenceFill.parentElement.setAttribute('aria-valuenow', detection.confidence);

    // ✅ Sanitize reasons output
    elements.detectionReasons.textContent = detection.reasons.map(escapeHtml).join('; ') || 'None';

    // ✅ Sanitize and render metadata content
    let html = '';
    if (metadata.error) {
        html = '<div class="lma-metadata-item"><span class="lma-metadata-label">Error:</span>' +
               '<span class="lma-metadata-value">' + escapeHtml(metadata.error) + '</span></div>';
    } else if (Object.keys(metadata).length === 0) {
        html = '<div class="lma-metadata-item">No EXIF data found</div>';
    } else {
        for (let [key, value] of Object.entries(metadata)) {
            if (key === 'error') continue;
            html += '<div class="lma-metadata-item"><span class="lma-metadata-label">' +
                    escapeHtml(key) + ':</span><span class="lma-metadata-value">' +
                    escapeHtml(String(value)) + '</span></div>';
        }
    }
    elements.metadataContent.innerHTML = html;
}

function toggleMetadataPanel() {
    state.metadataPanelVisible = !state.metadataPanelVisible;
    if (state.metadataPanelVisible) {
        elements.metadataPanel.classList.add('active');
        const currentImg = state.allImages[state.currentIndex];
        const metadata = state.imageMetadata.get(currentImg) || {};
        updateMetadataPanel(currentImg, metadata);
    } else {
        elements.metadataPanel.classList.remove('active');
    }
}

// ================== ZOOM AND PAN ==================
function resetZoomAndPan() {
    state.zoomState.scale = 1;
    state.zoomState.rotation = 0;
    state.zoomState.panX = 0;
    state.zoomState.panY = 0;
    applyTransform();
}

function applyTransform() {
    const { scale, rotation, panX, panY } = state.zoomState;
    elements.mainImg.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) ' +
                                        'rotate(' + rotation + 'deg) scale(' + scale + ')';
}

function zoomIn() {
    state.zoomState.scale = Math.min(state.zoomState.scale + CONFIG.ZOOM_STEP, CONFIG.MAX_ZOOM);
    applyTransform();
}

function zoomOut() {
    state.zoomState.scale = Math.max(state.zoomState.scale - CONFIG.ZOOM_STEP, CONFIG.MIN_ZOOM);
    applyTransform();
}

function rotate(clockwise = true) {
    state.zoomState.rotation += clockwise ? 90 : -90;
    applyTransform();
}

// ================== BATCH DOWNLOAD (IMDb Style) ==================

// ✅ Fallback download strategy
function downloadWithFallback(url, filename) {
    return new Promise((resolve, reject) => {
        // Try GM_download first
        GM_download({
            url, name: filename,
            onload: () => resolve('gm_download'),
            onerror: (err) => {
                log('GM_download failed, trying fallback...', 'warn');
                // Fallback to anchor download
                fetch(url)
                    .then(r => {
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.blob();
                    })
                    .then(blob => {
                        const a = document.createElement('a');
                        const blobUrl = createBlobUrl(blob);
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        revokeBlobUrl(blobUrl);
                        resolve('fallback');
                    })
                    .catch(reject);
            }
        });
    });
}

function downloadWithPromise(url, name) {
    return new Promise((resolve, reject) => {
        let retryLeft = CONFIG.RETRY_COUNT;
        const attempt = () => {
            const timer = setTimeout(() => {
                if (retryLeft > 0) {
                    retryLeft--;
                    log('Retry ' + (CONFIG.RETRY_COUNT - retryLeft) + ' for: ' + name, 'warn');
                    setTimeout(attempt, CONFIG.RETRY_DELAY_MS);
                    return;
                }
                reject(new Error('timeout'));
            }, 15000);

            GM_download({
                url, name,
                onload() { clearTimeout(timer); resolve('ok'); },
                onerror(e) {
                    clearTimeout(timer);
                    if (retryLeft > 0) {
                        retryLeft--;
                        log('Retry ' + (CONFIG.RETRY_COUNT - retryLeft) + ' for: ' + name, 'warn');
                        setTimeout(attempt, CONFIG.RETRY_DELAY_MS);
                    } else {
                        reject(e);
                    }
                }
            });
        };
        attempt();
    });
}

function makeBatchFilename(folderName, entityName, index, totalDigits, imgIndex) {
    const idx = String(index).padStart(totalDigits, '0');
    const img = state.allImages[imgIndex];
    const srcName = img ? img.src.split('/').pop().split('?')[0] : 'img';
    const stub = sanitizeFilename(srcName).substring(0, 30);
    return CONFIG.DOWNLOAD_PREFIX + folderName + '/' + entityName + '_' + idx + '_' + stub + '.jpg';
}

function showBatchProgress(total, images, folderName) {
    removeBatchProgress();

    const ov = document.createElement('div');
    ov.id = 'lma-batch-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Batch download progress');

    let thumbsHTML = '';
    for (let i = 0; i < images.length; i++) {
        const thumbUrl = getThumbnailUrl(images[i].src);
        const isSelected = state.batchSelectionMode && state.selectedBatchIndices.has(i);
        thumbsHTML += '<div id="lma-bp-thumb-' + i + '" class="lma-batch-thumb' +
                     (isSelected ? ' selected' : '') + '" data-index="' + i + '">' +
                      '<img src="' + thumbUrl + '" onerror="this.style.display=\'none\'" alt="Thumbnail ' + (i+1) + '" />' +
                      '<div class="lma-batch-thumb-badge" id="lma-bp-badge-' + i + '">' + (i + 1) + '</div>' +
                      '</div>';
    }

    ov.innerHTML = '<div class="lma-batch-card">' +
        '<div class="lma-batch-header">' +
            '<h3>📦 Batch Download</h3>' +
            '<span class="lma-batch-folder">📁 ' + escapeHtml(folderName) + '/</span>' +
        '</div>' +
        '<div id="lma-batch-status" aria-live="polite">Preparing…</div>' +
        '<div class="lma-batch-bar-container">' +
            '<div id="lma-batch-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>' +
        '</div>' +
        '<div id="lma-batch-file" aria-live="polite"></div>' +
        '<div id="lma-batch-grid" role="list">' + thumbsHTML + '</div>' +
        '<div class="lma-batch-footer">' +
            '<div class="lma-batch-stats">' +
                '✅ <span id="lma-batch-ok">0</span> &nbsp;&nbsp; ' +
                '❌ <span id="lma-batch-fail">0</span> &nbsp;&nbsp; ' +
                '📊 <span style="color:var(--lma-text-muted);">' + total + '</span> total' +
            '</div>' +
            '<button id="lma-batch-cancel">Cancel</button>' +
        '</div>' +
    '</div>';

    document.body.appendChild(ov);

    // Add click handler for selection mode
    if (state.batchSelectionMode) {
        document.querySelectorAll('.lma-batch-thumb').forEach(thumb => {
            thumb.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                toggleBatchSelection(idx);
            });
        });
    }

    document.getElementById('lma-batch-cancel').onclick = () => { state.batchCancelled = true; };
}

function toggleBatchSelection(index) {
    if (state.selectedBatchIndices.has(index)) {
        state.selectedBatchIndices.delete(index);
    } else {
        state.selectedBatchIndices.add(index);
    }
    updateThumbSelectionUI(index);
}

function updateThumbSelectionUI(index) {
    const thumb = document.getElementById('lma-bp-thumb-' + index);
    if (!thumb) return;

    if (state.selectedBatchIndices.has(index)) {
        thumb.classList.add('selected');
    } else {
        thumb.classList.remove('selected');
    }
}

function updateThumbStatus(index, status) {
    const thumb = document.getElementById('lma-bp-thumb-' + index);
    const badge = document.getElementById('lma-bp-badge-' + index);
    if (!thumb) return;

    thumb.className = 'lma-batch-thumb ' + status;
    if (badge) {
        switch (status) {
            case 'active': badge.textContent = '⬇'; break;
            case 'done': badge.textContent = '✓'; break;
            case 'fail': badge.textContent = '✗'; break;
        }
    }

    if (status === 'active') {
        const grid = document.getElementById('lma-batch-grid');
        if (grid) {
            const tR = thumb.getBoundingClientRect();
            const gR = grid.getBoundingClientRect();
            if (tR.bottom > gR.bottom - 5) {
                grid.scrollBy({ top: (tR.bottom - gR.bottom) + 20, behavior: 'smooth' });
            } else if (tR.top < gR.top + 5) {
                grid.scrollBy({ top: (tR.top - gR.top) - 20, behavior: 'smooth' });
            }
        }
    }
}

function updateBatchProgress(cur, total, fname) {
    const pct = Math.round(cur / total * 100);
    const bar = document.getElementById('lma-batch-bar');
    if (bar) {
        bar.style.width = pct + '%';
        bar.textContent = pct + '%';
        bar.setAttribute('aria-valuenow', pct);
    }
    const st = document.getElementById('lma-batch-status');
    if (st) st.textContent = 'Downloading ' + cur + ' of ' + total + '…';
    const fl = document.getElementById('lma-batch-file');
    if (fl) fl.textContent = fname;
}

function updateBatchStats(ok, fail) {
    const okEl = document.getElementById('lma-batch-ok');
    const failEl = document.getElementById('lma-batch-fail');
    if (okEl) okEl.textContent = ok;
    if (failEl) failEl.textContent = fail;
}

function finishBatchProgress(ok, fail, cancelled, folderName) {
    const st = document.getElementById('lma-batch-status');
    if (st) {
        st.innerHTML = cancelled
            ? '⚠️ Cancelled – ' + ok + ' downloaded, ' + fail + ' failed.'
            : '✅ Done! ' + ok + ' downloaded' + (fail ? ', ' + fail + ' failed' : '') + '.' +
              '<br><span style="font-size:12px;color:var(--lma-text-muted);">Saved to: Downloads/' + escapeHtml(folderName) + '/</span>';
    }
    const fl = document.getElementById('lma-batch-file');
    if (fl) fl.textContent = '';
    const btn = document.getElementById('lma-batch-cancel');
    if (btn) {
        btn.textContent = 'Close';
        btn.style.background = '#27ae60';
        btn.onclick = removeBatchProgress;
    }
}

function removeBatchProgress() {
    document.getElementById('lma-batch-overlay')?.remove();
}

// ✅ Modular batch download functions
function validateBatchPreconditions() {
    refreshImageList();
    const images = state.allImages;
    if (!images.length) {
        GM_notification({ text: 'No images found on this page', title: 'Batch Download' });
        return false;
    }
    return true;
}

function prepareBatchMetadata() {
    const entity = getPageEntityName();
    const folderName = entity;
    const images = state.batchSelectionMode && state.selectedBatchIndices.size > 0
        ? Array.from(state.selectedBatchIndices).map(i => state.allImages[i])
        : state.allImages;
    return { entity, folderName, images };
}

function confirmBatchDownload(count, folderName) {
    return confirm('Found ' + count + ' image(s).\n\nDownload all to:\n  Downloads/' + folderName + '/');
}

async function executeBatchDownload(images, folderName, entity) {
    const digits = String(images.length).length;
    let ok = 0, fail = 0;

    for (let i = 0; i < images.length; i++) {
        if (state.batchCancelled) break;

        const img = images[i];
        const originalIndex = state.allImages.indexOf(img);
        const fname = makeBatchFilename(folderName, entity, i + 1, digits, originalIndex);

        updateBatchProgress(i + 1, images.length, fname);
        updateThumbStatus(originalIndex, 'active');

        try {
            // ✅ Use fallback strategy
            await downloadWithFallback(img.src, fname);
            ok++;
            updateThumbStatus(originalIndex, 'done');
        } catch (e) {
            fail++;
            updateThumbStatus(originalIndex, 'fail');
            log('Failed: ' + fname + ' - ' + e.message, 'error');
        }

        updateBatchStats(ok, fail);
        if (i < images.length - 1 && !state.batchCancelled) {
            await delay(CONFIG.BATCH_DELAY_MS);
        }
    }

    return { ok, fail };
}

function showBatchResults(results, cancelled, folderName) {
    finishBatchProgress(results.ok, results.fail, cancelled, folderName);
}

async function batchDownload() {
    if (state.batchInProgress) return;

    if (!validateBatchPreconditions()) return;

    const { entity, folderName, images } = prepareBatchMetadata();

    if (!confirmBatchDownload(images.length, folderName)) {
        return;
    }

    state.batchInProgress = true;
    state.batchCancelled = false;

    showBatchProgress(images.length, images, folderName);

    try {
        const results = await executeBatchDownload(images, folderName, entity);
        showBatchResults(results, state.batchCancelled, folderName);
    } catch (error) {
        log('Batch download error: ' + error.message, 'error');
        GM_notification({
            text: 'Batch download failed: ' + error.message,
            title: 'Error',
            type: 'error'
        });
    } finally {
        state.batchInProgress = false;
    }
}

// ================== EVENT LISTENERS ==================
function attachEvents() {
    elements.prevBtn.addEventListener('click', () => navigateTo(state.currentIndex - 1));
    elements.nextBtn.addEventListener('click', () => navigateTo(state.currentIndex + 1));
    elements.closeBtn.addEventListener('click', closeLightbox);
    elements.metadataToggle.addEventListener('click', toggleMetadataPanel);
    elements.downloadBtn.addEventListener('click', () => {
        const currentImg = state.allImages[state.currentIndex];
        if (currentImg) {
            const filename = currentImg.src.split('/').pop().split('?')[0] || 'image';
            downloadImage(elements.mainImg.src, filename);
        }
    });
    elements.batchBtn.addEventListener('click', () => {
        closeLightbox();
        batchDownload();
    });

    // ✅ Batch selection toggle
    elements.batchSelectToggle.addEventListener('click', () => {
        state.batchSelectionMode = !state.batchSelectionMode;
        elements.batchSelectToggle.classList.toggle('active', state.batchSelectionMode);
        elements.batchSelectToggle.setAttribute('aria-pressed', state.batchSelectionMode);
        GM_notification({
            text: state.batchSelectionMode ? 'Selection mode ON - click thumbnails to select' : 'Selection mode OFF',
            title: 'Batch Download'
        });
    });

    elements.zoomIn.addEventListener('click', zoomIn);
    elements.zoomOut.addEventListener('click', zoomOut);
    elements.resetZoom.addEventListener('click', resetZoomAndPan);
    elements.rotateLeft.addEventListener('click', () => rotate(false));
    elements.rotateRight.addEventListener('click', () => rotate(true));
    elements.helpBtn.addEventListener('click', () => { elements.helpModal.classList.toggle('active'); });
    elements.helpClose.addEventListener('click', () => { elements.helpModal.classList.remove('active'); });

    // Click on image to open lightbox
    document.addEventListener('click', (e) => {
        if (state.isOpen || state.batchInProgress) return;
        const target = e.target.closest('img');
        if (!target) return;
        if (target.closest('#lma-lightbox')) return;

        // ✅ Visual feedback for non-target images
        if (!isValidTargetImage(target)) {
            target.style.outline = '2px dashed rgba(255,100,100,0.7)';
            setTimeout(() => { target.style.outline = ''; }, 300);
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        state.lastFocusedElement = document.activeElement;
        refreshImageList();
        const index = state.allImages.findIndex(img => img === target);
        if (index !== -1) { openLightbox(index); }
        else {
            log('Clicked image not found in list, refreshing', 'warn');
            refreshImageList();
            const newIndex = state.allImages.findIndex(img => img === target);
            if (newIndex !== -1) openLightbox(newIndex);
        }
    }, true);

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (state.batchInProgress) return;
        if (!state.isOpen) return;
        if (e.key === 'Escape') { closeLightbox(); e.preventDefault(); }
        else if (e.key === 'ArrowLeft' && !elements.prevBtn.disabled) {
            navigateTo(state.currentIndex - 1); e.preventDefault();
        }
        else if (e.key === 'ArrowRight' && !elements.nextBtn.disabled) {
            navigateTo(state.currentIndex + 1); e.preventDefault();
        }
        else if (e.key === 'Home') { navigateTo(0); e.preventDefault(); }
        else if (e.key === 'End') { navigateTo(state.allImages.length - 1); e.preventDefault(); }
        else if (e.key === 'm' || e.key === 'M') { toggleMetadataPanel(); e.preventDefault(); }
        else if (e.key === 'd' || e.key === 'D') { elements.downloadBtn.click(); e.preventDefault(); }
        else if (e.key === 'b' || e.key === 'B') {
            closeLightbox(); batchDownload(); e.preventDefault();
        }
        else if (e.key === 's' || e.key === 'S') {
            elements.batchSelectToggle.click(); e.preventDefault();
        }
        else if (e.key === 'r' || e.key === 'R') { rotate(!e.shiftKey); e.preventDefault(); }
        else if (e.key === '0') { resetZoomAndPan(); e.preventDefault(); }
        else if (e.key === '+' || e.key === '=') {
            if (e.ctrlKey) { zoomIn(); e.preventDefault(); }
        }
        else if (e.key === '-' || e.key === '_') {
            if (e.ctrlKey) { zoomOut(); e.preventDefault(); }
        }
        else if (e.key === 'h' || e.key === 'H') {
            elements.helpModal.classList.toggle('active'); e.preventDefault();
        }
    });

    // Touch swipe
    elements.imageContainer.addEventListener('touchstart', (e) => {
        state.touchStartX = e.touches[0].clientX;
        state.touchStartY = e.touches[0].clientY;
    }, { passive: true });

    elements.imageContainer.addEventListener('touchend', (e) => {
        if (!state.touchStartX) return;
        const diffX = e.changedTouches[0].clientX - state.touchStartX;
        const diffY = e.changedTouches[0].clientY - state.touchStartY;
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > CONFIG.TOUCH_SWIPE_THRESHOLD) {
            if (diffX > 0 && !elements.prevBtn.disabled) navigateTo(state.currentIndex - 1);
            else if (diffX < 0 && !elements.nextBtn.disabled) navigateTo(state.currentIndex + 1);
        }
        state.touchStartX = 0;
    }, { passive: true });

    // Dragging for pan
    elements.imageContainer.addEventListener('mousedown', (e) => {
        if (state.zoomState.scale === 1) return;
        e.preventDefault();
        state.isDragging = true;
        state.dragStart.x = e.clientX - state.zoomState.panX;
        state.dragStart.y = e.clientY - state.zoomState.panY;
        elements.imageContainer.classList.add('dragging');
    });

    document.addEventListener('mousemove', (e) => {
        if (!state.isDragging) return;
        state.zoomState.panX = e.clientX - state.dragStart.x;
        state.zoomState.panY = e.clientY - state.dragStart.y;
        applyTransform();
    });

    document.addEventListener('mouseup', () => {
        state.isDragging = false;
        elements.imageContainer.classList.remove('dragging');
    });
}

// ================== IMAGE LIST REFRESH ==================
function refreshImageList() {
    state.allImages = getAllImages();
    log('Image list refreshed, found ' + state.allImages.length + ' images');
    updateBatchCount();
}

// ================== MUTATION OBSERVER (Optimized Scope) ==================
function observeMutations() {
    if (state.observer) state.observer.disconnect();

    state.observer = new MutationObserver(debounce(() => {
        refreshImageList();
    }, CONFIG.DEBOUNCE_DELAY));

    // ✅ Observe specific containers instead of entire body
    const targets = [
        document.querySelector('.chat-container'),
        document.querySelector('.message-list'),
        document.querySelector('.image-gallery'),
        document.querySelector('[class*="content"]'),
        document.querySelector('[class*="chat"]'),
        document.body // Fallback
    ].filter(el => el);

    targets.forEach(target => {
        try {
            state.observer.observe(target, { childList: true, subtree: true });
        } catch (e) {
            log('Observer error for target: ' + e.message, 'warn');
        }
    });
}

// ================== UPDATE CHECK (Bonus) ==================
async function checkForUpdates() {
    if (!GM_info.script.updateURL) return;

    const current = GM_info.script.version;
    try {
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: GM_info.script.updateURL,
                onload: resolve,
                onerror: reject
            });
        });

        if (resp.status >= 200 && resp.status < 300) {
            const meta = resp.responseText;
            const match = meta.match(/@version\s+([\d.]+)/);
            if (match && match[1] !== current) {
                GM_notification({
                    title: 'Update Available',
                    text: `Arena Lightbox v${current} → v${match[1]}. Click to update.`,
                    onclick: () => GM_openInTab(GM_info.script.downloadURL),
                    timeout: 10000
                });
            }
        }
    } catch (e) {
        log('Update check failed: ' + e.message, 'warn');
    }
}

// ================== INITIALIZATION ==================
function init() {
    if (state.initialized) return;
    log('Initializing lightbox v' + GM_info.script.version);

    createLightbox();
    attachEvents();
    refreshImageList();
    observeMutations();

    // ✅ Check for updates after short delay
    setTimeout(checkForUpdates, 5000);

    state.initialized = true;
    log('Lightbox ready');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();
