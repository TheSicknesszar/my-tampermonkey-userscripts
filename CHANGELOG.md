# Changelog

## v6.1.1 (2026-06-28)

### Bug Fixes
- **Double download bug**: Removed duplicate `onclick` handler on download button that caused two simultaneous downloads
- **Blob URL memory leak**: Old blob URLs are now revoked before overwriting in the preload cache
- **Metadata panel stale data**: Panel now resets to "Loading..." when navigating between images
- **Selection state persistence**: `selectedBatchIndices` is now cleared when toggling selection mode off
- **Focus trap listener leak**: Added `state.isOpen` guard to prevent listener accumulation on rapid `openLightbox` calls

### Security
- **Missing `@grant GM_info`**: Added required grant for `GM_info.script.version/updateURL/downloadURL` usage
- **CSP-safe thumbnails**: Replaced inline `onerror="..."` with programmatic event handler assignment
- **`@connect`-safe fallback**: Replaced `fetch()` with `GM_xmlhttpRequest` in batch download fallback so cross-origin downloads respect the `@connect` whitelist

### Improvements
- **Custom confirm modal**: Replaced native `alert()`/`confirm()` with a styled overlay modal for visual consistency
- **Shared `fetchAsBlob` helper**: Extracted duplicated `GM_xmlhttpRequest` blob-fetching pattern into a reusable utility
- **SPA route handling**: Added `popstate` and `hashchange` listeners to refresh images on SPA navigation
- **Config sync**: `saveConfig()` now updates the in-memory `CONFIG` object via `Object.assign`
- **Config-driven preloading**: `preloadNeighbors()` now reads `CONFIG.PRELOAD_NEIGHBORS` instead of hardcoding 2
- **Query param safe thumbnails**: `getThumbnailUrl()` now appends with `&` when the URL already has a query string
- **Accessibility**: Added `role="listitem"` to batch thumbnail items

### Dead Code Removal
- Removed unused `downloadWithPromise` function (was superseded by `downloadWithFallback`)
- Removed unused `state.retryCount` variable

### Metadata
- **Update/DL URLs**: Fixed from `.git` to `raw.githubusercontent.com` so Tampermonkey auto-update works
- **Stale reference**: Removed `IMDb` from `getPageEntityName()` title regex

## v6.1.0

- Initial release of Arena.ai Lightbox Enhanced + Batch Download
