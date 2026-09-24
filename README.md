# X Feed Analyzer

*Search, map and trace the posts you scroll past.*

A personal browser extension that catalogues the posts you see on X (x.com / twitter.com) into **local** storage and lets you search them with **regex**. It also filters the live timeline as you scroll: highlight, dim, or hide posts that match a pattern.

- No API. Posts are read straight out of the rendered page, the same way your eyes do.
- No servers. Everything lives in IndexedDB inside the extension. Nothing is sent anywhere.
- Built for your own data analysis. Export to JSON or CSV whenever you like.

The original motivation: find who keeps posting em dashes (`—`), a common tell of AI-drafted text. But any regex works.

## Install (Chrome, Edge, Brave, Arc, any Chromium browser)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Open x.com. A round **⌕** button appears bottom-right. The toolbar icon's badge shows how many posts are catalogued.

Firefox: the manifest is MV3, but Firefox wants `background.scripts` instead of `background.service_worker` and a `browser_specific_settings.gecko.id`. Two small edits to `manifest.json` and it loads via `about:debugging`.

## Use

**Capture** is on by default. Every post that renders on screen while you scroll (home, profiles, search, threads, notifications) is stored: id, author, text, timestamp, permalink, language, reply/repost/like/bookmark/view counts, and what kind of post it is: who it replies to, who reposted it, who it quotes (with the quoted text), the @handles it mentions, whether it carries images, a video or a link, and the links as X displays them. Seeing the same post again updates its counts. Toggle capture from the popup or the on-page panel.

**Live filter** (the ⌕ button on x.com): type a regex and posts are marked as they load. Matching text is highlighted inline. The match count covers every post seen in the tab, including those scrolled far enough back that X has dropped them from the page (they are marked again when you scroll back to them). Modes:

- Highlight: amber bar and badge on matching posts.
- Dim others: non-matching posts fade to 18% opacity (hover to read).
- Hide others: non-matching posts are removed from the timeline. X's virtual scroller usually copes, but if the page gets jumpy, switch to Dim.

Smart content filters include em dash, en dash, smart quotes, the "it's not X, it's Y" framing, and an AI-vocabulary list. The filter is shared across tabs and remembered.

**Catalogue viewer** (toolbar popup → Open catalogue, or the on-page panel): full search over everything captured, with account, date, post-type and threshold filters, sorting, and inline highlighting. The page is a workbench: a bar at the top with the search box, the **account chip** and the date range; a rail on the left with the filters (post types with counts, the three threshold sliders, the **By author** list); the posts in the middle at reading width; and a pane on the right with the **network map** (Account tab) or the **word clouds** (Topics tab), drawn small. The header's **Network map** and **Topics** links (and **Expand** in the pane) show either at full width in place of the posts, with its controls; **← Back to posts** returns. The search always runs over the post text. The chip is the one account the page is about: type a name or @handle and pick one (it suggests every captured account, then the accounts that only appear because others interact with them), or click any author row, any @handle on a card or any circle on the network map. The list, the map and the clouds all follow it, the address bar carries it (`viewer.html#account=alice`), and **✕** or Escape clears it. Plain text in the chip filters by name or handle without choosing one account. With an account chosen, the list header offers **By them** (their own posts) and **Interactions with them** (the posts behind their connections: what quotes, answers, reposts or mentions them, and their posts doing that to others), each with its count. In the rail, the **min likes**, **min reposts** and **min chars** sliders each draw, behind the thumb, how the posts passing every other filter are spread (choose an account and the range becomes that account's), with p50 / p90 / p99 ticks and a live readout of how many posts pass, so you see the distribution before choosing a cut-off; the box beside each takes an exact number, and every threshold in force also shows as a chip in the bar with its own ✕. All three use a log scale. The length slider surfaces long-form posts (the shape talking points arrive in): a post X collapsed behind “Show more” counts as long whatever was captured of it, and every card prints its character and line count. The **sort order** sits on the list itself, above the first post: newest, oldest, likes, views, longest, matches (with a pattern) and captured; the count line names the order in force. Sort by **longest** to skim a day's essays first. Posts are set at reading width (about 70 characters a line) whatever the window. The search box carries the same three toggles as an editor's find widget, with the same Alt-key shortcuts (Alt+C match case, Alt+W whole word, Alt+R regex); **/** jumps to it, and **⌘↑** goes back to the top of the page from anywhere but a multi-line box. More posts load as you scroll. **Select text in any post** and a small toolbar appears over it: **Filter posts** searches the list for that exact text (regex off), **+ Keyword** adds it to the Topics keyword list (switching to the heat map when the current view has no keywords), **Search X ↗** opens an X search for the phrase, latest first, and **Copy** copies it. Web addresses in a post, and the 🔗 line of links under it (videos, articles, link previews), open in a new tab. The **···** menu on a card opens the post on X, copies its text or link, or removes it from the catalogue, with **Undo** in a toast for a few seconds.

- **Aa** Match Case (Alt+C). Off by default, so `delve` also finds `Delve`.
- **ab** Match Whole Word (Alt+W). `delve` stops matching `delves`. Works for symbols too: an em dash between spaces still counts.
- **.\*** Use Regular Expression (Alt+R). On by default. Turn it off to search for literal text like `(1/2)` without escaping.

The rarely needed regex flags (multiline `^`/`$`, dot matches newlines, Unicode `\p{…}` classes) and the ready-made patterns sit behind the **≡** glyph at the end of the search box, with a plain-language description of each flag. The **By author** list in the rail shows, for the current pattern, what share of each author's captured posts match (the count is in the tooltip). Sort by rate to see who leans on em dashes the most. Click a row to choose that account; **min posts** next to the heading hides the accounts with fewer captured posts.

**Post types.** A list at the top of the rail, **all posts** by default, with one tick box per kind of post: **replies**, **reposts**, **quotes**, **original posts** (neither a reply, a repost nor a quote), **images**, **videos**, **links**. Tick one or more and the list shows the posts that are any of them ("quotes, replies"); tick **all posts** to clear. The number beside each kind is how many of the current results are of that kind, so you can compare types at a glance. Every post card carries the same details as tags (`reply to @a`, `quotes @b`, `2 images`, `video`, `link`), and links are listed as X displays them. A quote post shows the original under it as a nested card: its author, its full text when the original is in the catalogue (marked *in the catalogue*) and otherwise the text X showed in the quote card, plus links to open it and to its quotes page. Click a tag that names an account to choose it. Images and videos are told apart only for posts captured from this version on; older posts with media carry a plain `media` tag until you scroll past them again, and a hint says how many such posts are in view. Every card also says how many captured posts quote it (**N quotes here**); click it to list them, which is who picked up that framing inside the catalogue. The nested original on a quote post carries the same link when the original is captured.

**Topics** (the Topics tab of the pane, small; the **Topics** link in the header, **Expand** in the pane, or `viewer.html#compare` show it at full width in place of the posts) has four views. Each is a square image you can export, and each prints its sample size, date range and matching mode on the image itself.

- **Author clouds**: one word cloud per author, most posts first. Words are sized by *distinctive* weight by default: how much more this author uses the word than the other authors shown (log-likelihood keyness; a word needs at least two uses), so the clouds show what sets each account apart rather than "people" and "think". Switch **weight** to *frequent* for plain counts. Type a **term or phrase** to restrict every cloud to the posts that mention it ("Posts mentioning “iran”").
- **Term cloud**: as you type a term or phrase, one cloud of the words that go with it, drawn from every post that mentions it and compared with the rest of the catalogue. The line under the box always says how many posts and authors mention the term, in red when none do. **Click a word to drill in**: it joins a trail under the box (`gas › mandate › farmers`), the cloud redraws from the posts that contain all of them, and the list shows those posts; click an earlier step of the trail to go back.
- **Co-mentions**: for the posts that mention the term, how many also mention each keyword in the list (one per line, optional label before ` :: `), as a bar table. The bar is the keyword's share of the term's posts, the tick is its share of all posts, and every row prints posts, mentions and the lift between the two. A keyword that matches no post at all says "matches nowhere", so a typo cannot pass for a real zero. Leave the list empty and the table shows the term's most distinctive words instead.
- **Heat map**: the author × keyword matrix. Type keywords or patterns one per line, optionally with a label before ` :: ` (e.g. `AI :: \b(?:ai|llms?)\b`). You get a square heat-map with one row per author and one column per keyword, sorted so the densest cell sits top left. Each cell prints its number, so colour is never the only channel, and the single-hue ramp reads for colour-blind viewers. Choose what to count (posts that mention it, total mentions, or mentions per 100 posts so prolific accounts don't dominate) and how many authors to show. Cells drawn with a dashed border are **unusually silent**: a zero where the author’s number of posts, at the keyword’s overall rate across every author in the filter, would predict three or more posts mentioning it. An author silent on every keyword stays in the matrix for that alone: the **authors** box caps the densest rows, and up to five unusually silent accounts are appended after them, the most unexpected silence first. The tooltip and the table give the expected number.

All four views use the search options (Aa, ab, .*) and the filters above, but not the main pattern; the term cloud and co-mentions also honour the chosen account, and all hide authors below **min posts per author**. Matching is case-insensitive unless **Aa** is on. Phrases are found automatically: when a two-word combination accounts for most uses of its rarer word ("gas prices", "regime change") it becomes one entry and its uses come out of the single words. URLs and @mentions are dropped, #hashtags and emoji are kept, and English (plus common Spanish, German, French and Portuguese) function words are ignored. Click a word to search the main list for it, together with the term and the author when they apply; click a co-mention row or a heat-map cell for the posts behind it. The author clouds and the heat map never apply the chosen account (they compare authors), so every cloud stays on screen while you read one author's posts below; that author's tile is outlined, and a **← Back** pill (in the panel and above the results) restores the account and pattern from before the click. **Alt-click** (Option-click) a word in any cloud to open its own term cloud. **Shift-click** words in any cloud (the Topics clouds or the account's cloud in the pane) to gather them in a tray, then **release Shift** to open one X search for all of them, on the Latest tab, in a background tab so several can go out in a row and capture pulls the results in. When the words come from an account's cloud (or an account is chosen), the tray picks whose posts: **@them** (`from:`), **Everyone else** (`-from:`, to find other accounts on the same subject) or **Everyone**; Shift+1/2/3 switches while Shift is still down, and the choice is remembered. Words picked from a cloud narrowed by a term start from the term and its trail. Esc cancels; if Shift comes up in another window, the tray waits for its **Search X ↗** button instead. **Show as table** gives the numbers behind any view. The panel's **Export** menu takes an optional image title and an image theme (as the page, light or dark) and downloads the image as SVG (1080 × 1080) or PNG (2160 × 2160) with a "what one person scrolled past" caveat printed on it, or the numbers as CSV.

**Network map** (the Account tab of the pane, small and without its controls; the **Network map** link in the header, **Expand map** in the pane, the button in the toolbar popup or in the on-page panel, or `viewer.html#network` show it at full width in place of the posts, with its controls) draws who quotes, replies to, reposts and mentions whom. Arrows run from the account that acted to the one acted on. Circle size is interactions received, so the biggest circles are the accounts others quote, answer and repost most. Filled circles are accounts whose own posts you have captured; hollow ones only appear because others interact with them. Each interaction type has its own colour and dash pattern (validated for colour-blind readers), named in the legend with counts.

- **Choose an account** in the chip at the top of the page (the pane's **Choose an account ↑** takes you there) and the map redraws around it: the accounts it quotes, replies to and reposts, the accounts that do that to it, and how those connect to each other. **✕ Everyone** goes back to the whole map and clears the chip. Clicking a circle does the same as choosing it, and `viewer.html#network&account=alice` opens the map already focused. Under the small map, the pane shows the account's numbers (how often it was quoted, replied to and reposted, and by how many accounts), **who amplifies it** and **whom it amplifies** (click a row for the posts behind that pair), its **most amplified post** (by X's repost count, with how many quotes of it the catalogue holds), and the capture links. With no account chosen it lists the **most interacted-with** accounts instead; click one to choose it. The pane draws at most 30 accounts; the expanded map honours the **accounts** box.
- **Click an arrow** and a card opens on it with the posts behind that connection: for "@a quotes @b" those are a's quote posts. Each line links to the post on X (**open ↗**) and to that post's quotes page (**quotes ↗**), which is who endorsed or reframed it; a quote post whose original is known also links to the quotes of the original. The same posts are listed in the pane beside the expanded map, or in the main list when the map is in the pane; the ✕ clears that.
- **Capture more**: with an account chosen, links appear in the pane and under the expanded map's title for its profile, its Replies tab and an X search for posts that link to its posts (what a quote does). Every post card also has **quotes ↗** and **replies ↗** links to its `/quotes` page and its replies. Open one with capture on, scroll, come back and hit Refresh: each captured quote or reply joins the map. A post's `/retweets` page lists the accounts that reposted it: scroll it with capture on and each account joins the map as "reposts" the author. X only renders the rows you scroll to, so a long list needs scrolling to the end. If the post itself has not been captured yet, it is stored as a stub (author and reposters only) until you see it.
- Hover a circle for its numbers, drag to move it, drag the background to pan, click the map then scroll to zoom (or hold Ctrl / ⌘). The controls under the map choose the interaction types (mentions are off by default), hide connections backed by fewer than **min posts**, cap how many **accounts** are drawn (the least connected are peeled away, so what remains is the connected core), and restrict the map to posts matching the search pattern. The map uses the date, type and threshold filters above; the chosen account focuses it rather than filtering it.
- The **Export** menu under the map takes an optional image title and an image theme and downloads the map as shown (SVG 1080 × 1080 / PNG 2160 × 2160) with the usual caveat printed on it; **Accounts CSV** is one row per account with interactions received and sent by type; **Connections CSV** is one row per arrow.

On a post's own page X hides the "Replying to" line, so the posts under the focal post are recorded as replies to its author and flagged `replyInferred` (the card tag says "inferred"). A reply to another reply in the thread is attributed to the focal author too; the "Discover more" recommendations under the replies are left alone. A reply target read from a real "Replying to" line always wins over an inferred one. Every count covers only what you scrolled past, so treat the map as a map of your own timeline rather than of X.

**Find copies** (the **find copies** link on a card) composes an X search for copies and near-copies of that post: its rarest phrases, judged against the catalogue, as exact matches OR-ed together, in a window from three days before the post to one day after it, not by its author. The query is shown and editable, with a plain-language line saying what it does; **Open on X ↗** runs it on the Latest tab, **reworded ↗** searches for its rarest single words in any order (talking points that were reworded) and **web ↗** searches the web for the first phrase. Open the search with capture on and scroll: every copy joins the catalogue and its author the map. X keeps copypasta out of recommendations, so scrolling alone under-samples copies; this is the loop that pulls them in.

**Export** (JSON or CSV, in the header) downloads the current result set (so filter first, then export). **Import JSON** (in the header's **···** menu, next to the page theme) merges a previous export back in, deduplicated by post id.

## Data model

```jsonc
{
  "id": "1834567890123456789",
  "url": "https://x.com/alice/status/1834567890123456789",
  "handle": "alice",
  "name": "Alice Chen ✨",
  "text": "It's not about the tool — it's about the workflow.",
  "lang": "en",
  "time": "2026-09-17T10:00:00.000Z",
  "isReply": false, "replyTo": [], "replyInferred": false,  // handles from the "Replying to" line, or inferred on a post's page
  "isRepost": false, "repostedBy": null,       // the timeline's "X reposted" line
  "reposters": ["bob", "carol"],             // read from the post's /retweets page (only the rows you scrolled past)
  "stub": false,                             // true while only id, author and reposters are known
  "isQuote": true, "quotedHandle": "dave", "quotedName": "Dave", "quotedId": "999", "quotedText": "The quoted one…",
  "mentions": ["bob"],                       // @handles in the text (not the reply line)
  "hasImage": false, "images": 0, "hasVideo": false,
  "hasLink": true, "links": ["example.com/why-it-matters"],  // as X displays them (X hides the real URL behind t.co)
  "hasMedia": true,                          // image, video or link card; kept for older exports
  "isPinned": false, "truncated": false,
  "replies": 12, "reposts": 3, "likes": 45, "bookmarks": 2, "views": 1234,
  "firstSeen": 1758190000000, "lastSeen": 1758190000000, "seenCount": 1,
  "context": "/home"            // page you were on when it was first captured
}
```

## Limitations

- Long posts show truncated in timelines. The catalogue keeps the longest version it has seen and flags `truncated` until you open the post.
- Quoted posts are not captured as separate records. Their author and text are kept on the quoting post (`quotedHandle`, `quotedText`) and excluded from its `text`; `quotedId` is only known when X links the card.
- `isReply` and `replyTo` rely on the "Replying to" label, which threads do not show; on a post's own page they are inferred from position (`replyInferred: true`) and may attribute a nested reply to the focal author. Treat them as best-effort.
- `links` hold the display text of each link (the real URL sits behind t.co); a link-preview card contributes its domain. GIFs render as videos on X and count as such.
- Posts captured before this version have no `hasImage` / `hasVideo` fields. The viewer treats them as media of unknown kind until they are seen again.
- Engagement numbers come from what X renders. Views are only shown for some posts.
- X changes its markup without notice. The selectors live at the top of `content.js` (`data-testid` attributes) and are easy to patch.
- Regex runs on the page's main thread. A pathological pattern (catastrophic backtracking) will make the tab sluggish until you fix it.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: `storage`, `unlimitedStorage`. |
| `content.js` / `content.css` | Runs on x.com: DOM extraction, live filter panel, highlight styling. |
| `background.js` | Service worker: receives posts, writes IndexedDB, keeps the badge count. |
| `db.js` | IndexedDB helper shared by the worker and the viewer. |
| `search.js` | Search options and regex compiler shared by the viewer and the on-page panel. |
| `viewer.html` / `viewer.js` / `viewer.css` | The catalogue search page. |
| `matrix.js` | Author × keyword matrix: builds the model and renders the SVG used on the page and in the exports. |
| `words.js` | Tokenizer, stop-words, phrase detection, keyness (log-likelihood) and the co-mention model. |
| `clouds.js` | Word-cloud layout and the SVG for the author clouds, term cloud and co-mention table. |
| `network.js` | Interaction network: builds the who-interacts-with-whom graph, lays it out (force simulation), renders the SVG and the CSVs. |
| `popup.html` / `popup.js` | Toolbar popup: count, capture toggle, live-filter toggle. |
| `test/fixture.html` | Mock X timeline for exercising the content script without logging in (`python3 -m http.server`, then open `/test/fixture.html`). |
| `test/words.test.js` | Checks for the tokenizer, keyness, co-mentions and cloud layout (`node test/words.test.js`). |
| `xsearch.js` | Composes an X advanced search for copies of a post: its rarest phrases as exact matches in a date window around it. Wired to the **find copies** sheet on every post card and to the selection toolbar's **Search X**. |
| `coord.js` | Coordination evidence for a topic: copy groups (MinHash), heavy posters, accounts that co-act on two or more different posts within 1 min / 10 min / 1 h, copies aimed at people. Tested on real pushes and ordinary posting (`docs/research/coordination-validation.md`); not yet wired into the viewer. |
| `test/coord.test.js` | Checks for the coordination measures, on posts from the #KochFarms and #PhosphorusDisaster hoaxes (`node test/coord.test.js`). |
| `test/matrix.test.js` | Checks for the author × keyword matrix, in particular the silence cue (`node test/matrix.test.js`). |
| `test/xsearch.test.js` | Checks for the search composer on the “$4 gallon of gasoline” chain post (`node test/xsearch.test.js`). |
| `test/network.test.js` | Checks for the interaction graph model, layout, SVG and CSVs (`node test/network.test.js`). |
| `test/db.test.js` | Checks for the merge rule: how a fresh sighting or a reposters stub updates a stored post (`node test/db.test.js`). |
