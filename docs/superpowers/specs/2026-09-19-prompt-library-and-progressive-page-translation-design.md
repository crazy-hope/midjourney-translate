# Prompt Library and Progressive Page Translation Design

## Intent

Improve the Midjourney translator extension for personal daily use without adding a backend. The extension must stop page translation from overwhelming long, dynamic Midjourney pages, reuse repeated translations to reduce model-token consumption, and replace the single auto-saved Chinese draft with an explicit reusable prompt library.

Success means:

- enabling page translation does not freeze a long Midjourney page;
- repeated English UI text is translated once per provider and reused;
- retained English and its Chinese translation appear inline together without changing click behavior;
- prompts can be explicitly added, searched, selected, updated, imported, and exported;
- configuration saving no longer saves the Chinese prompt;
- all credentials, settings, caches, and prompt records remain local to the browser.

## Existing Problem and Root Cause

The current page translator walks every text node under the loaded document body, evaluates visibility through the ancestor chain, creates a job for every unique candidate, and starts overlapping scans for dynamically inserted Midjourney nodes. Although network concurrency is bounded, the number of queued jobs, promises, DOM walks, and mutation-triggered scans is not. Long or frequently changing pages can therefore accumulate enough synchronous DOM work and pending jobs to make the tab unresponsive.

The current retained-original presentation also uses `display: block`, which places Chinese below the English instead of beside it.

The fix must change the work model rather than merely adjusting a delay or concurrency number.

## Progressive Page Translation

### Candidate discovery

The extension will no longer traverse and queue the entire loaded page when the switch is enabled. It will discover candidate text elements incrementally and register eligible elements with an `IntersectionObserver`. Only elements near or inside the viewport enter the translation queue.

Mutation handling will collect roots for 100 milliseconds, remove descendants whose ancestor is already in the batch, and inspect at most 100 text nodes before yielding to the next animation frame. Extension-owned nodes, editable controls, hidden content, code, scripts, styles, URLs, numeric-only text, Midjourney prompt inputs, and already translated nodes remain excluded. The viewport observer uses a 300-pixel root margin so nearby text can finish before it scrolls fully into view.

DOM discovery must yield between bounded batches so a large mutation cannot monopolize the main thread. Disabling page translation disconnects observers, clears queued work, and prevents delayed responses from rendering.

### Queue and request reuse

The page translator will own one bounded queue for the active generation. It allows at most two active requests and 200 normalized source keys waiting for service. Visible candidates beyond that bound remain observed and are reconsidered as queue capacity becomes available; they do not create promises while waiting. New visible candidates are coalesced by normalized English text before any request begins.

Normalization for reuse trims leading and trailing whitespace and collapses internal whitespace. Cache identity is:

```text
provider + normalized English source
```

Reuse has three layers:

1. all matching nodes in one discovery batch share one request;
2. matching nodes arriving while a request is active await the same in-flight promise;
3. completed results are stored in a bounded local persistent cache and reused after refresh or a later browser session.

Provider caches remain separate. Switching from DeepSeek to Qwen or free translation restores extension-owned page text and obtains results from the selected provider's cache or endpoint. The persistent cache holds at most 1,000 entries total and evicts least-recently-used entries so local storage cannot grow without bound. Cache corruption or storage failure falls back to an empty cache without blocking translation.

On the first provider error in an active generation, no new requests start. Successfully rendered translations remain visible and the status area explains the failure. Turning the page-translation switch off and on starts a fresh generation.

### Rendering and interaction safety

With “保留原文” enabled, translated Chinese is appended inline immediately after its English source in the form `（中文）`. It inherits the surrounding font sizing where possible, uses a distinguishable muted accent, is `aria-hidden`, and has `pointer-events: none`. The original node and its event handlers are never replaced.

With “保留原文” disabled, only extension-owned text changes are allowed. Restoring or changing provider must not overwrite text that Midjourney changed after translation.

## Prompt Library

### Record model

Each prompt is stored in `chrome.storage.local` as:

```js
{
  id: string,
  title: string,
  chinese: string,
  english: string,
  date: string
}
```

`id` is the sole identity key and is generated locally for every new record. Duplicate titles are allowed. `date` is a single ISO timestamp representing the most recent add, update, or import-overwrite action.

Records are normalized on every read and write. Invalid entries are ignored instead of breaking the whole library. Title must be non-empty after trimming. A record may have an empty English value, but Chinese and English may not both be empty.

### Add, select, and update

The “中文输入” label row contains:

- a searchable combobox listing saved prompts;
- an “新增” button;
- an “更新” button.

Search matches titles without changing the saved title. Duplicate titles are disambiguated in results with their date. Selecting a record fills the Chinese editor and the right bilingual preview. When the record contains English, it becomes immediately eligible for “填入”.

“新增” opens an extension-owned dialog requesting a title. Confirming creates a new ID even when another record has the same title, saves the current Chinese and English values with the current date, and selects the new record.

“更新” acts only on the selected record ID. If the Chinese source has changed since the displayed English was produced or selected, update is blocked with a message requiring retranslation. After a fresh translation, update writes the current Chinese, English, existing title, and current date to the selected ID.

Clearing the editors clears only current UI state. It does not delete or modify a library record. Deletion of library records is outside this change.

### Configuration save and draft removal

The existing “保存” action becomes “保存配置”. It saves only:

- selected translation provider;
- model translation instruction;
- aspect ratio;
- stylize;
- chaos;
- quality;
- HD.

It never writes Chinese or English prompt text. Automatic draft writes and automatic draft restoration are removed. The legacy single-draft storage key is left untouched for safety but is no longer read or written. Refreshing does not restore unsaved edits.

## Import and Export

The main panel heading places “导入” and “导出” beside the title while retaining the provider selector.

Export asks for Markdown or TXT and downloads every local prompt record in one UTF-8 file. Both representations are human-readable and include an explicit machine-readable ID, title, Chinese text, English text, and date for every record. The serializer must escape or length-frame content so prompt text containing headings, separators, or blank lines still round-trips exactly.

Import accepts `.md` and `.txt` only. Parsing and validation complete in memory before any storage write. If the file is malformed, the existing library remains unchanged.

Merge behavior is based only on ID:

- an imported ID matching a local ID overwrites that record and sets its date to the import time;
- an imported ID not found locally is added and receives the import time;
- equal titles with different IDs remain separate records;
- invalid records are skipped;
- duplicate IDs inside one file use the last valid occurrence.

After a successful atomic write, the UI reports counts for added, overwritten, and skipped records and refreshes the searchable combobox.

## UI Layout

The top heading contains the product title, import/export actions, and provider selector. The two-column editor remains: Chinese on the left and bilingual preview on the right. Library controls fit in the left editor's title row and wrap on narrow widths. The title dialog, export-format choice, search results, and import summary use extension-owned accessible UI and remain inside the panel interaction scope so they do not trigger panel hiding.

The panel remains the same width as the Midjourney composer and must not move or cover Midjourney's submit controls.

## Modules and Responsibilities

- `content/page-translator.js`: candidate normalization, visible-element registration, bounded scheduling, request deduplication, lifecycle cancellation, and safe rendering.
- `content/page-translation-cache.js`: bounded provider-aware persistent translation cache.
- `content/prompt-library.js`: record normalization, local CRUD, selection-safe updates, and atomic import merge.
- `content/prompt-file.js`: deterministic Markdown/TXT serialization and parsing.
- `content/content.js`: panel markup, event wiring, dialogs, combobox state, status messages, and integration with translation.
- `content/styles.css`: inline page translations and prompt-library controls.
- `content/draft-store.js`: configuration-only save behavior and removal of automatic prompt persistence.

Pure data and scheduling behavior must remain independently testable without a browser.

## Error Handling

- A page-translation provider error halts new jobs for the generation and preserves completed translations.
- Queue overflow coalesces or defers candidates; it never creates an unbounded promise list.
- A missing or unavailable `IntersectionObserver` falls back to small, yielding viewport checks rather than a whole-document request burst.
- Storage failures show an error and leave current editor contents intact.
- Add fails without mutation when the title is empty or both prompt fields are empty.
- Update fails without mutation when no record is selected or the preview is stale.
- Import performs no storage write until the entire file has been parsed and normalized.
- Export failure leaves the library unchanged and reports the error.

## Verification

Automated tests will cover:

- repeated page text making one provider request and rendering to every matching node;
- offscreen content remaining untranslated until it enters the observed viewport;
- bounded discovery and queue behavior under large batches and mutations;
- disabling, provider switching, delayed responses, and first-error halting;
- provider-aware persistent cache reuse, eviction, and corrupt-cache recovery;
- retained-original inline rendering without replacing the original event target;
- prompt creation with unique IDs despite duplicate titles;
- searchable selection and correct Chinese/English restoration;
- selected-record update and stale-preview rejection;
- configuration save omitting prompt content;
- Markdown and TXT round trips containing separators, Unicode, and blank lines;
- ID-based import overwrite, duplicate-title coexistence, duplicate IDs, invalid entries, and atomic failure;
- extension manifest validation and the complete existing test suite.

Manual acceptance on Midjourney will verify smooth scrolling on a long gallery, clickable buttons and images after inline translations, panel layout, native file download/upload, and prompt reuse after an extension reload.

## Privacy

No backend is added. Prompt records, settings, provider credentials, and page-translation cache stay in `chrome.storage.local`. Page text is sent only after the user enables page translation and only to the selected provider. Documentation and the privacy notice will disclose the persistent translation cache and file import/export behavior.
