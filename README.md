# TradeTrace

A private local-browser Windows workspace for MT5 market analysis, market orders, and a trading journal with historical trade replay.

The application lives at the repository root. Run `Install.cmd` once, then
`Start.cmd`. Python modules sit beside the launcher, browser assets are in
`static/`, and automated checks are in `tests/`. Local journal data and the
encrypted API key stay in `.local/`, which is excluded from Git.

`Start.cmd` opens an interactive **TradeTrace Server Control** console and starts
the app and browser automatically. Use **1 Start**, **2 Stop**, **3 Restart**,
**4 Open browser**, **5 Refresh status**, **6 View recent logs**, or **0 Exit**.
Stop and Exit stop this console's web server; MT5 remains open and broker orders
and positions remain unchanged. Requests already in progress finish before shutdown.
Routine server logs go to `work/server.log`, keeping the controls readable.
If upgrading with an older server console still running, close that old window
first; the new launcher does not stop servers owned by another console.
For a custom port, run `.venv\Scripts\python.exe launcher.py --port 8768`.

If upgrading from the earlier `outputs/mt5-replay` layout, stop the old server
first, move its `.local` folder to the repository root to keep your journal and
saved key, and run `Install.cmd` to create the environment at the new location.
Run `CreateShortcut.ps1` to regenerate the launcher shortcut and replace any old
pinned shortcut.

## Market workspace (v1.18.0)

The app automatically connects to the signed-in, running MT5 terminal on startup,
using its last successful executable path when available, then loads broker
symbols without clicking **Connect & load markets**. The journal and Terminal
share startup connection work. Existing server sessions are reused; a fresh server
also connects automatically. The native MCP history key is optional for charting.
The last page, symbol, timeframe, indicators and drawings restore in this browser.
If no page preference exists but terminal settings are saved, Terminal opens.

If MT5 starts later, connection attempts retry at most every ten seconds while the
Terminal page is visible. The button becomes **Reconnect MT5** after a successful
load and remains available for manual recovery. Multiple running installations
still require an unambiguous saved/selected terminal path. An account change while
the app is running clears reviews and requires manual reconnection rather than
silently switching trading accounts. Startup and reconnect never submit orders.
Demo and live accounts support execution. Reviews identify the connected account as DEMO or LIVE. Confirm only after checking the account, symbol, and order fields.

- Locally bundled TradingView Lightweight Charts 5.0.9 provides candles/line view,
  crosshair OHLC, pan/zoom, price scaling, **Fit** history and **Latest** controls.
  The interval bar shows starred favorites; the arrow opens grouped Seconds,
  Minutes, Hours, Days, Weeks and Months menus. Star/unstar intervals to customize
  the bar (up to 16 favorites). The selected interval remains visible even when
  unstarred. Favorites and up to 30 custom intervals save in this browser.
- Native MT5 intervals from M1 through MN1 use up to 1,000 broker candles,
  including M2/M3/M4/M6/M10/M12/M20 and H2/H3/H6/H8/H12. Custom intervals support
  1–60 seconds, 1–1,440 minutes, 1–168 hours, 1–365 days, 1–52 weeks and 1–12
  months. Second candles aggregate broker bid ticks from the last 20 minutes;
  intervals with no ticks are omitted and no ticks are synthesized. Other custom
  intervals aggregate smaller native candles (up to 60,000 source candles), using
  UTC boundaries, Monday-based weeks and calendar months. The first incomplete
  source interval is discarded. History and second candles depend on broker
  coverage; closed markets may have no recent second candles. Projected drawing
  anchors beyond loaded monthly history use an approximate month duration.
- **Indicators** offers SMA 20, EMA 50, Bollinger Bands (20, two population standard
  deviations), Wilder RSI 14, MACD (12/26 EMA, nine-period EMA signal) and broker
  tick volume. RSI, MACD and tick volume have resizable panes. Tick volume is a
  quote activity measure, not exchange traded volume. Current candles and their
  indicators can change until the candle closes. Chart times are UTC.
- Search the broker's complete symbol list and add up to 20 symbols to the
  watchlist. Viewing an additional symbol can add it to MT5 Market Watch so quotes
  are available. The default watchlist starts with visible symbols.
- Choose **Level**, **Trend**, **Zone** or **Fib**, then click one or two chart
  anchors. Escape cancels a pending drawing; Undo removes the last drawing; Clear
  removes drawings for the current symbol across all intervals. Anchors can be placed between
  candles, before loaded history, or in empty space beyond the latest candle.
  Empty timeline space projects the selected candle interval; it does not invent
  market candles or predict session openings. Drag the price axis to expose higher
  or lower prices, including while a drawing tool is selected. Completed drawings
  use timestamps and price anchors. In Cursor mode, click a drawing to select it;
  highlighted handles identify its anchors. Read its exact price levels on the right price axis and beneath the chart.
  Selected prices update as you drag; Fibonacci shows each retracement level.
  Crosshair hover/click shows enabled indicator values beneath the chart title,
  with RSI and MACD retaining their own units. Drag the body to move the drawing or
  drag an anchor handle to resize it. Click empty chart space or press Escape to
  deselect. The drawing-toolbar Delete button or the Delete/Backspace key removes
  only the selected drawing; typing in form fields does not delete drawings.
  Changes save immediately after dragging. Drawings are shared across intervals for
  the same account/server and symbol, using their original timestamp and price
  anchors. Older per-interval drawings are merged automatically on connection;
  identical copies are deduplicated. Chart zoom and visible ranges remain separate
  for each interval.
- **Long / Short position** tools place a hypothetical trade plan at a clicked
  entry, with an initial 2:1 price risk/reward ratio and 25-bar display width.
  Green shows the target region and red the stop region. Select a plan to see
  entry, stop and target axis labels, price distances, percentages, lot volume and
  the live risk/reward ratio. Drag the entry, target or stop handles to adjust
  levels; the right entry handle adjusts width; dragging the body moves the whole
  plan. Levels remain valid for the chosen side and prices snap to the broker tick.
  The selected-plan form supports precise entry/SL/TP and lot-volume edits.
- Monetary plan estimates use MT5's read-only `order_calc_profit` in account
  currency and are available for analysis on both demo and live accounts. They are
  hypothetical gross loss at stop, profit at target and mark-to-market at the last
  bid (long) or ask (short), excluding commissions, swap and slippage. Stale quotes
  are identified. A plan is not an open position and its estimates are not recorded
  P&L. Without broker calculation data, price distances and risk/reward still work.
- **Copy SL/TP to order ticket** copies the selected plan's side, levels and lots
  without submitting an order. The ticket is a market order at the current broker
  price, not an order at the drawn entry; its existing account-bound review and
  confirmation remain required. Plans save and remain shared across timeframes.
- Settings, watchlists, visible time ranges, drawings and alerts autosave to
  browser local storage. **Save layout / Restore layout** keeps an explicit
  symbol, interval, style and indicator preset. These settings are specific to the
  browser profile and local server origin (including port); they are not included
  in SQLite journal backups and may be cleared by browser storage cleanup.
- Local bid-price alerts trigger once at/above or at/below their level using fresh
  broker quotes. Up to 20 alerts are supported, including symbols other than the
  current chart. Triggered alerts are highlighted in the alert list. Polling runs
  approximately every two seconds only while the Terminal tab and browser page
  are visible and connected. There are no OS notifications or background alerts;
  a level crossed and reversed while the app is inactive may be missed.
- The order ticket supports market buys/sells with optional SL/TP. **Review
  order** checks account permissions, quote freshness, lot step, price tick size,
  stop distance and broker order validation. **Confirm & send** uses a single-use,
  60-second preview; inputs changed during review invalidate confirmation. Quotes
  and broker checks are refreshed before submission. Unknown outcomes are never
  retried automatically. Final execution must be checked in MT5.
- **Market / Pending** tabs choose execution mode. In Pending mode, enter an
  entry price and choose BUY or SELL; limit vs stop is inferred automatically:
  buy below ask = limit, buy above ask = stop, sell above bid = limit, sell below
  bid = stop. The ticket and review name the inferred type. The backend resolves
  and freezes that type at review, then revalidates it before sending; it will
  not silently switch type if quotes cross the entry during confirmation.
  Orders use GTC and RETURN filling, subject to broker validation.
- The ticket uses live **Sell / Buy** quote cards and **Market / Pending** tabs.
  Pending mode starts an entry draft near the current quote; drag its chart label
  or type an exact price. Limit/stop is inferred automatically. Lot-size − / ＋
  controls respect broker min/max/step. No separate level-setting buttons are used.
- Drag the **SL** or **TP** handle beside the chart's entry label to add protection.
  Continue dragging its label to adjust the price; × removes it from the chart and
  ticket. Inputs remain available for exact prices. During a drag, protective
  levels stay on the correct side of entry and respect broker stop distance;
  prices snap to the symbol tick. Dragging the market entry creates a pending
  draft. Escape restores a cancelled drag. These interactions only edit a draft
  and invalidate any old preview; broker changes still require review and confirm.
  Drawing selection takes priority over a coincident trade line; use its explicit
  ticket-label grip to drag the trade level in that case.
- The entry-label **×** dismisses the entire draft (including its SL/TP) without
  sending any broker action. It stays dismissed through quote refreshes and page
  reloads until you explicitly use the ticket again. In amendment mode, that ×
  discards only the staged amendment and leaves the broker order untouched.
  Actual positions and pending orders have separate ticket-number labels with
  **×** controls on the chart: these open the normal reviewed close/cancel flow.
  Off-screen broker entries are marked with an arrow at the chart edge.
- On an existing pending order, use **Edit** or drag its entry/SL/TP line to stage
  an amendment. The ticket locks side and volume and requires **Review pending
  amendment**, then explicit confirmation. The backend preserves the ticket,
  broker order type and original expiration, and rejects a filled or concurrently
  changed order. Existing orders cannot be changed from limit to stop by crossing
  the quote; this requires cancelling and placing a new order explicitly. After
  placement, the old draft clears so dragging the broker line edits that order
  instead of accidentally preparing a second one. Live execution remains disabled.
- The **Pending orders** table shows broker tickets, types, remaining lots, entry
  and SL/TP, with entry lines on the current symbol chart. **Cancel** opens an
  account/ticket-specific review; confirming sends `TRADE_ACTION_REMOVE` once.
  An order that fills before cancellation is rejected as no longer pending;
  inspect open positions. Both placement and cancellation are available on demo and live accounts.
  When the ticket is in pending mode, copying a chart plan also copies its entry;
  market mode continues to use current broker pricing.
- **Close** on an open-position row reviews closing its entire volume. The review
  shows the exact ticket, symbol, account, volume and current closing quote; a
  separate **Confirm close entire position** sends the request. Demo and live accounts
  can use this action. Cancel, expiration or changes to the position invalidate
  the review. The backend names the exact MT5 position ticket, reverses its side,
  refreshes broker checks before sending and rejects changed volume/type/symbol.
  A review can only be submitted once. Results report broker status and remaining
  volume when available; partial fills, timeouts and unknown outcomes are never
  retried automatically. Use MT5 History/positions for final confirmation and
  **Sync closed trades to journal** to import completed positions.
- Open positions and their entry/SL/TP references appear on the chart. **Open
  journal** filters your journal to the current symbol. **Sync closed trades to
  journal** uses the history From/To dates in Trade replay; existing review and
  attachment behavior is preserved.

This version does not implement Pine Script, community indicators, multiple chart
windows, modifying open positions, stop-limit orders, or automatic cancel-and-replace.
Manage those trading operations in MT5. No real trades are placed by the tests.
See `THIRD_PARTY_NOTICES.md` for the chart library's separate Apache 2.0 license.

Verification:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests
node tests/test_terminal_analysis.cjs
node tests/test_replay_candles.cjs
```

`node tests/test_terminal_browser.cjs` additionally requires Playwright on Node's
module path and Microsoft Edge (or an installed Playwright Chromium). It launches
an isolated headless browser with every broker endpoint intercepted, verifies
chart tools/persistence/preview behavior and responsive layout, and saves QA
screenshots under ignored `work/`. It does not use your normal browser profile.

## Trading journal (v1.3.0)

The **Journal**, **Calendar**, and **Trade replay** tabs share the same MT5 account history.

- Connecting and loading MT5 history saves supported closed-trade snapshots locally. Repeated syncs update imported facts without overwriting notes or attachments. To include older trades, widen the replay history From/To dates and load again.
- Click **Show replay here** (or **Connect & show replay** when offline) on a trade review to open the full chart and controls inside the Journal or Calendar page. **Hide replay** collapses it; notes stay in place. The separate Trade replay tab remains available and shares the same playback state. The replay button automatically connects to the running MT5 when needed and displays connection errors next to the button. Playback controls do not submit or mark the review as edited.
- Select a saved trade to add notes, a lesson, up to 12 setup tags, a process rating, four checklist items, and a reviewed flag. Drafts are preserved immediately in this browser and automatically saved to the journal database after a short pause. Reopening a trade restores its draft. Click **Save review** to finalize it; **Review completed** only counts after that explicit save. Switching trades/dates keeps the draft. A prompt appears if neither browser recovery nor database autosave can preserve changes. Drafts in the database are included in backups; the last keystrokes still waiting to sync may exist only in browser recovery.
- The calendar groups trades by exit date in Bangkok, UTC, or your browser's local timezone. Green/red daily cells show net P&L and trade count. Click a day to filter its trades; previous/next controls change the month. Changing day, month, or timezone clears the review and embedded replay, preserves unfinished drafts, and ignores late responses from a previously selected trade. Select a position from the new date to begin reviewing.
- Statistics show net P&L, trade count, wins / all closed trades, profit factor (gross gains / absolute gross losses), average net P&L and reviewed count. Search/status filters apply; Calendar statistics cover the selected month. Accounts and currencies are not combined. Summaries cover only synced supported positions and linked charges, not deposits, withdrawals, open trades or all account-level fees.
- The screenshot area is directly beneath replay. Drop images onto it, choose multiple files, or press Ctrl+V with an image on the clipboard while reviewing a trade. Normal text paste in notes is unaffected. Upload PNG/JPEG/WebP screenshots (3 MB each, eight per trade), or capture the current embedded replay chart directly from its review. Click a screenshot to open a large popup with Fit/Actual size zoom; close with Escape, the Close button or the backdrop. **Capture exit replay chart** saves a high-resolution final chart with all ticks, recorded exit fill, SL/TP references, timestamp and net result without moving your current playback position. It can load the selected trade automatically if needed. Screenshots and notes work without MT5; tick replay still requires the matching account connected.
- Saved records remain available after restarting or disconnecting MT5. **Download journal backup** creates a SQLite backup containing snapshots, reviews and images, without the API key.

The database is `.local/journal.sqlite3`, excluded from Git. Unlike the separately encrypted API key, journal records and downloaded backups are **not encrypted**. To restore a backup, stop the app, keep a copy of the existing database, and replace `.local/journal.sqlite3` with the downloaded SQLite file before restarting. No journal data is uploaded to external services. The sample replay is never added to your journal.

## Start

You can launch using **MT5 Journal.lnk**, the custom notebook/candlestick icon shortcut beside Start.cmd. The shortcut starts the launcher with its console minimized. If the app folder is moved, run **CreateShortcut.ps1** to regenerate the shortcut for its new location. The icon is journal.ico; local shortcuts are excluded from Git.

Run **Install.cmd** once if dependencies are missing. Open MT5 and sign in, then double-click **Start.cmd** in File Explorer. The app opens at http://127.0.0.1:8766. Click **Connect MT5**. The app finds your running terminal, connects the price and SL/TP interfaces, and loads the chosen exit dates (UTC) automatically. If multiple terminals are running, choose one under Connection settings.

## One-click connection and saved key (v0.7.1)

No EA, script, chart attachment, export, import or helper installation is used.

The app uses MT5’s **built-in local MCP server** to request historical positions directly. This is separate from the Python tick connection.

1. First use: in the signed-in MT5 choose **Tools → Options → MCP**, enable its internal server and copy the API key.
2. In the replay app open **Connection settings**, paste the API key once, then click **Connect MT5**. The default local address normally needs no change. Terminal discovery, both connections and loading history are one action.
3. Select a trade. Subsequent **Connect MT5** clicks reuse the authenticated native client in server memory. Refreshing the browser restores the existing session and reloads trades automatically, without reconnecting either interface.

After authentication the key and endpoint are saved in `.local/native-key.bin` using Windows DPAPI encryption tied to the current Windows user. The plaintext key is cleared from the form and never written to disk or returned by an API. Future server starts automatically reuse it for the same local endpoint. The `.local/` directory is excluded from Git. Use **Connection settings → Forget saved key** to delete the encrypted file and disconnect the native client. Enter a new key to replace the saved one. If Windows cannot decrypt the file, the app asks for the key again. Advanced terminal paths, the terminal picker and the API address are grouped under Connection settings. If authentication fails, trades still load with a clear explanation that complete SL/TP needs the key; settings open automatically.

Only local HTTP endpoints at 127.0.0.1 or localhost are accepted; redirects are refused. The client allows only get_trading_account_info, get_trading_history_positions and get_trading_history_orders. No trading tools are invoked. Account and server must match the Python connection before levels are accepted. Position ID, symbol and opening price must match; malformed, conflicting or unsupported responses fail explicitly. Native zero values mean no corresponding level at close. Historical stop amendments cannot be reconstructed.

**Verification status:** authenticated against the running MT5 terminal and verified that direct history supplied both SL and TP for all 13 loaded supported positions. Protocol, account matching, response handling and browser flows also pass automated checks. Unknown response formats fail explicitly instead of inventing levels.

References: [MT5 MCP configuration](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration), [native history capabilities](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities).

## Replay

Replay continues for **1 hour after exit** by default. Use **After exit** to choose
None, 15 minutes, 1 hour, 4 hours, or 1 day; the window reloads automatically.
**Jump to exit** takes you to the recorded close. A marked exit and an
**After exit · position closed** label distinguish later price action from the
actual trade. Final net P&L remains the recorded result; price movement after exit
is only a market comparison. Exit chart captures still end at the recorded close.
After-exit quotes depend on broker coverage and elapsed market time.

Choose a candle timeframe and select a trade. By default, the app loads up to 80 completed pre-entry candles automatically, with an extra lookback buffer for weekends and market closures. If fewer candles are available, the app reports the shortfall. Manual windows (15 minutes through 1 week) remain under **History & data settings**. Select **Candle timeframe** to use M1, M5, M15, M30, H1 or H4 for pre-entry history. Changing it reloads automatically while preserving replay time and chart zoom. After entry, bid-price candles at the selected timeframe build from already-revealed ticks, including a partial entry/exit candle; no future highs/lows are shown. The blue dot marks the current closing-side quote (bid for buys, ask for sells). Larger candle periods may require a longer history window. Only fully closed candles are shown before the entry marker; the entry-containing candle is excluded to avoid revealing post-entry OHLC. Playback starts at the first available tick at or after entry and reveals bid/ask ticks. The closing quote includes its exact UTC timestamp. Scrubbing before the first tick shows the first-quote time and a jump button; prices are never backfilled from the future. Scroll over the chart or use +/− to zoom, drag to pan, and use **Fit trade** to focus on entry-to-exit or **All history** to restore context. Arrow keys pan, +/− zoom, and Home resets when the chart has focus. Navigation changes only the chart viewport, not playback time or future-price visibility; exit captures always include the full historical window. The horizontal axis shows spaced UTC timestamps and adds month/day labels for ranges spanning multiple dates. Buys close against bid, sells against ask. SL/TP lines are labeled with their sources and serve as historical references throughout replay. Missing ticks and context are flagged; no invented prices are substituted.

The list and replay show green WIN, red LOSS or neutral BREAK EVEN based on recorded net profit, including linked commissions/swaps/fees. Running movement is in price units, not floating account currency. Final outcomes remain visible immediately. The exit reason comes from the recorded deal, not a price comparison. Expand the trade verification panel to reread executions and compare tickets, prices and charges with MT5 History.

## Limits and startup

V1 supports one entry plus one full exit, positions lasting up to 7 days and 500,000 ticks. Partial closes, scale-ins, reversals and unmatched/open positions are excluded. Separate account-level charges may not be linked to a position. Broker historical tick/candle coverage varies; warnings do not guarantee archive completeness.

The server listens on 127.0.0.1 only and uses a per-process request token. No external chart services are used. Selecting a symbol can add it to Market Watch. Start.cmd reuses an existing server only when app, version/build and workspace match. Close the old console if a stale version occupies the port; another process is never terminated. Live setup must run outside the coding assistant sandbox. Use a single browser session; reconnect after switching accounts. Stop the console with Ctrl+C.

## License

This project uses the custom **Trading Journal Source Available License 1.0**;
see [LICENSE](LICENSE). Personal and internal business use, including professional
trading, is permitted. Free sharing and modification are permitted with the
license and notices preserved. Selling the app, bundling it into a paid product,
or charging for hosted access requires separate written permission. Third-party
dependencies retain their own licenses. This project is source available.

## Development

Python standard-library backend; vanilla JavaScript/canvas frontend. Live connection needs the official MetaTrader5 package. The direct native client uses only Python standard-library HTTP/JSON.

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/app.js
node --check static/connection.js
```

References: [native deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties), [Python deal history](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py), [historical ticks](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py).

Open positions support **Edit SL / TP** in the positions table or by clicking their chart label. Drag or type protection levels, or use × to remove a level, then review and confirm. Filled entry and volume remain fixed. Amendments are account-bound, rechecked against the current quote and broker rules, and rejected if the position changes after review.

Draft SL/TP chart labels show estimated signed P/L in account currency using MT5 broker profit calculations. Amounts update after entry, side, volume or protection changes, including single-leg drafts and position amendments. Estimates exclude commission, swap and slippage; previous amounts remain marked while an update is pending. Estimating never sends an order.

Trading activity below the chart is grouped into **Open**, **Pending**, and **Closed** tabs. Closed reads up to 100 supported closed positions from the last 30 days and includes opening/closing commission, swap and fees in net P/L; complex positions follow the journal history limitations. New pending orders select the Pending tab automatically.

Terminal fits the browser viewport without page scrolling. Drag the dividers beside Watchlist and Order ticket, or above trading activity, to resize panels; arrow keys also resize focused dividers and double-click resets a size. Panel sizes and desktop visibility save locally. Long panels scroll internally. On compact screens, Watchlist and Order ticket buttons open overlays. Journal and replay retain normal page scrolling.

## Entry conditions

Open **Order ticket → Conditions**. The setup sidebar has separate **Order** and **Conditions** tabs, a shared status badge and risk/sizing card, and compact condition summaries. Expand one row at a time to edit it; timing/reset options are under a separate disclosure. **New setup** clears the condition and order draft, stops the selected monitor, resets execution to alert-only, and preserves the previous completed result under **Last setup result**. It never starts monitoring or sends an order. Existing broker positions and pending orders are unchanged.

Each condition header has **Duplicate condition** (⧉), which inserts an independent copy immediately after the original, preserving its rule, timeframe, prices and row visibility. **Undo** beside Add condition restores up to 30 condition draft changes: additions, duplication, field/rule edits, chart price picking, completed drags, row visibility, deletion, reordering, or clearing the condition list. One focused text/number edit, dropdown selection, or whole drag is one undo step. Ctrl+Z works in the Conditions editor or a condition-focused chart; inside text/number fields, native browser text undo is preserved. History resets on reload or account/symbol changes. Undo restores condition rows only, never order-ticket fields, monitoring state, completed results, event history, or broker orders. Applied rules continue unchanged until an explicit Start.

**Saved templates** stores up to 30 named setups locally in this browser, including conditions, order fields, sizing, and timing. Save/update replaces a template with the same name. Loading always creates an inactive alert-only draft, stops the current monitor, preserves the last result, and leaves broker positions/orders untouched. Automatic entry is never restored, and order draft overlays remain hidden until you use the Order ticket. Keep saved prices is available on the saved symbol; Reposition for this chart proportionally adapts the layout to the visible chart's price center and snaps prices to broker ticks. Review all condition/entry/SL/TP prices and lot limits before Start, especially across symbols. Templates survive reload; removing a template does not change the current draft or monitoring. Undo of loading restores condition rows only, not order fields or monitoring state.

**Plain-language preview** reads the current draft in sequence, distinguishing live Bid conditions from newly completed candles and explaining crossings/sweeps and the final alert/review/automatic-entry action. It is a read-only draft description; it neither applies edits nor starts monitoring or sends an order.

The ordered rule workflow comes from PriceConditionAlerts v1.32: add/remove/reorder conditions, choose live Bid or completed candles (M1/M5/M15/M30/H1/H4/D1), and enter a level or inclusive zone. Supported rules are zone entry/touch, trades above/below, sweeps returning across a level, candle closes above/below/inside, and first candle close above/below. Candle-only rules select completed-candle mode automatically.

Select a chart **Level** or **Zone** drawing, then click **Use as condition** in the chart toolbar. Levels create a live Bid Trades above condition; zones create a live Bid Enters zone condition. Review/change the rule in the opened Conditions tab. Prices copy at the broker tick size; zone time bounds are not entry criteria. The original drawing stays independent: later drawing edits do not change the copied condition. Conversion only adds a draft and never starts monitoring, opens an order draft, or sends an order.

Each row has a progress badge: **Watching** is the active applied step, **Waiting** follows earlier steps, and **Passed** has completed. **Draft** identifies an unapplied row; **Edited** indicates draft prices/rules/order differ from the frozen applied setup. Visibility changes do not affect progress. Stopping monitoring marks unfinished applied rows Stopped; quote-gap/timeout resets clear passed progress on the next observation. Finished progress saves with the setup and survives reload. Only an explicit Start begins a fresh sequence; New setup clears its badges while preserving the last result.

Expand **Conditions → Applied vs draft** for a read-only comparison of the frozen rules from Start and current draft. It highlights changed, added, removed and reordered conditions, shows applied step progress, and compares action, sizing, side, market/pending entry, manual lots, SL/TP, timeout and quote-gap settings. Visibility toggles are excluded because they do not change monitoring; automatic lot recalculations and changing market quotes are not treated as manual edits. New runs capture an order/timing snapshot; older saved setups without one say so instead of inferring previous values. Completed snapshots survive reload, remain explicitly Finished, and are cleared by New setup. Opening the comparison never applies changes or sends an order; only an explicit Start applies a new draft.

Condition fields validate as you edit: missing/nonpositive prices, reversed zone bounds, invalid rule/mode/timeframe combinations, and invalid timing values show messages beside the fields. Invalid rows remain marked when collapsed, with a summary above the tabs. Start is disabled until the draft is valid. Editing an invalid draft does not stop or alter a running applied setup; Stop remains available. Broker execution checks still run separately at review/submission.

Expand **Event log** below the setup controls to see timestamped starts, passed steps with applied prices and observations, quote-gap/timeout resets, stop reasons, order attempts, blocked attempts, completions, and draft restores. The most recent 100 events save locally per account/server/symbol and survive reload and New setup. This records events observed while TradeTrace is running; it is not a broker execution audit or a reconstruction of missed ticks. The event log never sends or retries orders.

Condition drafts have independent chart previews: dashed price levels and shaded zones with price labels. Select a row to highlight it. Drag a condition label or a selected level line to move its price; zone low/high drag independently, and **Move zone** shifts both boundaries while preserving width. Prices snap to the broker tick and zone boundaries cannot cross during dragging. **Pick on chart** fills a specific condition price; Escape cancels picking or restores a cancelled drag. Show condition levels/zones switches and each row's Show on chart checkbox control visibility independently of order drafts and save per account/server/symbol. Moving or hiding conditions does not open an order draft or change an already running setup; explicitly Start again to apply draft edits.

Selecting a zone rule fills missing bounds with a tick-aligned starter range, so it appears immediately when zone visibility is on. With no bounds, it uses a visible existing level, visible Bid, or the visible chart center, with an initial width relative to the displayed price range. One existing boundary is preserved while the missing side is filled. Existing two-boundary values, imported drawing prices, and restored drafts are not overwritten. This is a convenient draft range, not a detected trading zone; drag its handles to choose your intended bounds before Start.

Selecting a condition temporarily reveals its chart preview even when the global Levels or Zones switch is off. Other conditions remain globally hidden; deselecting/collapsing the selected row hides it again. The global switches are not changed. The condition's individual Show on chart checkbox still controls whether that condition may be displayed.

Adding a condition also creates a visible, tick-aligned starter price for its default level rule. Selecting any level rule fills a missing price using a visible prior zone midpoint, visible Bid, or the chart center. Existing level prices, drawing conversions, and restored drafts are preserved. Drag the level to your intended price before Start; the starter price does not identify a trading signal or start monitoring.

Choose **Alert only**, **Prepare order for review**, or **Automatic entry**, configure the normal market/pending ticket and select ticket lots or automatic 2% equity sizing. Start snapshots the condition list and ticket. Later draft/ticket edits do not change that running snapshot; Start again applies them. Changing the action edits the draft; the frozen running setup stays unchanged until Stop or an explicit restart. Trade modes require SL and TP; demo and live accounts support execution. An empty list completes immediately on Start, including one immediate order attempt when automatic entry is explicitly armed. Start is the explicit authorization for automatic submission; review mode instead requires the normal confirmation button.

Only the active step is observed; each step needs a separate fresh quote observation. Prior sweeps do not carry forward. Candle steps establish a baseline and wait for a new completed candle; the forming candle and old closed candles never trigger a step. A positive timeout runs from the first passed condition. Quote gaps reset progress and sweep memory. All modes are one-shot and require Start to rearm.

Completed setups stay Finished, including after quote gaps, timeout deadlines, hiding/reopening Terminal, reconnecting, or reloading. Completion status saves per account/server/symbol. Editing draft settings does not rearm them; only explicitly clicking Start creates a fresh run. Sequence reset rules apply only to unfinished monitoring.

The local TradeTrace server polls active frozen setups approximately every two seconds. Monitoring continues while the browser is hidden, minimized, reloaded or closed, and while other app views or chart symbols are displayed. Keep the computer awake, the TradeTrace server running, and MT5 connected. The server observes sampled Bid, not every MT5 tick; intrapoll entries/sweeps can be missed and missed structure signals are not replayed. MT5 disconnect, stale quotes, account change, or a server polling interruption over 30 seconds stops the setup without retry. By default, a server restart restores saved configurations disarmed as Saved—review to restart. Optional safe restart resumption is described below. The UI reconnects to the existing server run after reload and clearly labels an applied AUTO setup even though draft execution mode restores to alerts-only. Up to 20 setups run independently per local server, including several on the same symbol. Start atomically replaces only the selected setup; Add another setup creates an independent draft while existing monitors continue. Stop is acknowledged by the server, and New setup/template loading waits for that acknowledgement before clearing a draft. Stop during calculation prevents a later submission, but an order already being sent cannot be recalled. Existing positions and pending orders remain in MT5. Review mode waits for explicit confirmation and expires after 60 seconds; hiding the browser never turns a review into an automatic order. There are no OS/mobile notifications.

Automatic lots are calculated at completion from current equity and broker account-currency loss estimates, rounded down to broker steps and capped at broker maximum. The calculation includes an adverse entry allowance of 20 broker points; minimum lots above budget are rejected. The server rechecks the 2% modeled cap at both preview and submission, rejecting changed risk rather than rounding up. Manual ticket lots remain permitted above 2%. Commission, swaps, gaps and execution beyond the allowance are excluded; actual loss can exceed the estimate.

Selecting 2% equity also sizes the draft immediately once a valid stop loss is present. The ticket and chart entry label show the calculated lots, and the draft estimate shows the equity budget and modeled risk. Entry/SL/side changes refresh sizing; manual lot controls are disabled in this mode. Missing stops, unavailable estimates, or an unaffordable broker minimum block ordinary ticket review until a valid current size is available. Condition completion still recalculates from the latest equity and quote before submission. Existing broker positions and pending-order amendments retain their fixed volume.

Condition orders use the existing broker preview/submission validation, freeze pending limit/stop type at preview, require unchanged account identity, and allow additional positions or pending orders on the same symbol. Automatic 2% sizing applies independently to each new order, not to combined existing exposure. MT5 account mode and broker rules determine whether fills create separate positions or adjust a net position. The server permits one condition-entry submission attempt per monitor ID in 60 seconds, shared by tabs using that server process; legacy requests without an ID retain the account/server/symbol cooldown. Separate monitors on the same symbol may submit independently. The cooldown is in memory and does not coordinate separate server processes. Rejected, skipped and unknown outcomes are never retried automatically. Existing broker orders are not cancelled by stopping monitoring.

Verification: `node tests/test_terminal_conditions.cjs`, `python -m unittest discover -s tests`, and `node tests/test_conditions_browser.cjs` (Playwright; all broker endpoints mocked). Browser tests accept `TRADETRACE_TEST_PYTHON` to override the default `.venv/Scripts/python.exe`. No broker orders are sent by these tests.

The **Setup readiness** checklist beside Start shows DEMO/LIVE account identity, the completion action, quote freshness, condition/timing errors, trading permissions, protection, and lot limits. Alert-only setups do not require order fields or trading permissions. Fix listed blockers to enable Start. Automatic 2% lots and final broker acceptance are checked at execution; readiness does not reserve a quote or guarantee a fill. This describes the current draft and does not alter an applied setup.

Condition-triggered submissions automatically save an immutable local **Condition entries** journal record after the broker reports acceptance (including partial fills). The record includes the applied rules, observed passes/resets (last 100), settings, requested protection, and broker order/deal/result. Reviewed condition entries are recorded only after confirmation. Pending acceptance is labeled separately from execution; later history sync links supported closed trades using the broker entry order ID. Snapshots stay separate from review notes, drafts, calendar statistics, and P&L. The newest 200 records per account appear in the overview; all remain in the database/backup. Storage failure after execution is reported without retrying the trade. Existing trades before this feature are not backfilled.

### BOS and market structure shifts

Conditions include **Bullish/Bearish BOS** (continuation) and **Bullish/Bearish MS** (direction change). Select a timeframe and 1–10 swing candles on each side (default 2). Only completed candles are used. Strict swing highs/lows require higher/lower prices than all surrounding candles; ties are excluded. A pivot is available only after its right-side candles close. Consecutive same-kind pivots retain the more extreme confirmed pivot; a candle qualifying as both high and low is skipped because its intrabar order is unknown.

Initial structure requires two confirmed swing highs and two lows: both rising establish bullish structure; both falling establish bearish structure. Otherwise the rule waits for clear structure. A close crossing an unbroken swing in the current direction is BOS; an opposite break of the protected higher low/lower high is MS and changes the tracked direction. Protection tightens with confirmed higher lows/lower highs and does not retreat after a wick-only excursion. Each swing breaks once. Wicks and closes exactly at a level do not trigger. Historical candles establish context only. Each newly active structure step warms up from available history and waits for a new close. If multiple closed candles arrive between polls, their context is processed but their signals are skipped to avoid a late entry. The chart's purple calculated levels cannot be dragged; change timeframe or sensitivity instead. Active, unchanged rows use the running tracker's level; other rows preview the draft. Draft readiness explains loading/unclear structure, which can resolve while monitoring. Templates, undo, comparison, event logs and journal snapshots preserve structure settings; passed structure events record the broken swing and triggering candle. Initial context is limited to broker history loaded for the selected timeframe (normally up to 1,000 bars).

### Automatic condition trade plans

Enable **Conditions → Automatic trade plan** to calculate entry, SL, TP and lots when conditions pass. Choose BUY/SELL in Order; automatic plans override the other ticket fields for condition entries. Start freezes the plan settings. **Prepare order for review** displays calculated fields, modeled risk/reward and expiry without submitting; **Automatic entry** explicitly arms one submission. The normal ticket and alerts remain available when the plan is off.

Market entry uses the fresh broker quote. Retest entry uses the last matching-direction BOS/MS break in the applied sequence and always creates a limit order; a level already reached, absent matching trigger or invalid broker distance skips entry instead of changing to a stop order. Retests require broker-supported specified expiry (1–1,440 minutes), stored as an absolute deadline in the review and sent to MT5; there is no browser-dependent cancellation fallback. A filled position does not expire with its former pending order.

SL uses the latest usable confirmed swing low for buys or high for sells from the chosen timeframe and sensitivity, plus an outward buffer in broker ticks. Missing/broken swings and invalid protection skip entry. TP is a price-distance R multiple. Market calculations use an adverse entry including the app's 20-point deviation allowance; lots round down to broker volume steps for 0.01–2% equity risk per order. Minimum lots above budget, unavailable profit calculations or broker rejection block submission. Broker checks, current equity budget and minimum modeled R are checked again when the single-use review is consumed; adverse price movement can require a new plan. These are gross modeled amounts, excluding costs and actual execution slippage, not a guaranteed maximum loss or an aggregate limit across positions. Settings persist in templates/drafts, but execution always restores to alerts-only. Journal snapshots include the calculated plan, stop swing, modeled amounts and expiry alongside the applied conditions.

**Quick-start templates** at the top of Conditions provide buy/sell MS market entries, buy/sell BOS market continuations, and buy/sell MS retest limits. Choose a timeframe and 0.01–2% risk (starter default 0.5%), then Load starter draft. They use two candles each side for structure and stop swings, a 10-broker-tick outward SL buffer, 2R TP distance, and 30-minute broker expiry for retests. Inspect these starting settings for your symbol; they are not tested strategy recommendations. Loading stops monitoring and forces alerts-only without sending an order. Choose Prepare order for review before Start to inspect a calculated order after a future trigger. Built-ins are separate from your saved library; save a named copy to keep edits.

Server monitoring is implemented by `condition_monitor.py` with a Python port of the sampled-price/confirmed-swing engine in `condition_engine.py`. Broker and journal calls share the HTTP API lock. Start uses a unique request ID for retry deduplication; completion is consumed before preparation/submission and never automatically retries unknown outcomes. Engine parity tests compare Python and browser rule behavior. The browser only starts/stops, edits drafts, displays server progress and confirms prepared reviews; it does not evaluate or auto-submit running conditions. Tests include a real local HTTP/worker process with a fake broker, covering hidden-state events, reload, a closed browser page, Stop, review expiry and account change.

### Setup invalidation

Enable **Conditions → Cancel setup if price invalidates it** to add an independent cancellation guard. Choose a manual Bid price (at/below or at/above), or a confirmed swing: BUY uses a confirmed low, SELL a confirmed high, with an outward buffer in broker ticks. Swing timeframe and sensitivity are configurable. A missing/broken swing or an already breached level blocks Start.

Start freezes the cancellation level. It stays fixed through later swings, draft edits, sequence timeouts and quote-gap resets. The server checks it before entry steps, while an order awaits review, after preparation and again at submission. A breach marks the setup **Invalidated**, removes any prepared review and requires an explicit new Start. It never closes a position or cancels a pending order already submitted. Bid observations are sampled; a brief breach between observations can be missed. Monitoring still requires the local server and MT5 connection.

All six quick-start templates enable confirmed-swing invalidation on the selected timeframe, with two candles each side and a 10-tick outward buffer. This starting guard is separate from the stop loss calculated when entry conditions pass. Inspect the red cancellation line before Start. Saved templates preserve guard settings; older templates without them keep invalidation off.

### Multiple monitored setups

Use **Monitoring workspace → Add another setup** to create an independent draft without stopping existing monitors. Name it, configure its symbol, conditions, invalidation and trade plan, then Start. Each setup has its own progress, frozen configuration, events, single attempt and review token. Open setup restores that setup for inspection/editing; Open review shows its own confirmation. Starting an opened setup replaces only that selected run. Stop on a card stops that setup; Stop all stops all server monitors and removes their prepared reviews. New setup and Add another setup both create an independent alerts-only draft and keep existing runs monitoring. Loading a template into an opened setup still stops only that selected run; choose New setup first to keep it running. The list reconnects after browser reload; waiting configurations are saved locally and restored disarmed after server restart by default. Optional clean-restart checkpoints can preserve progress; review tokens are never restored. Up to 100 recent runs, including active ones, are retained in memory and local setup storage.

Optional **Linked setups** uses a group name and policy, frozen at Start. Groups match this account/server and exact symbol. Allow every setup to enter keeps them independent. First entry stops the others stops waiting siblings and removes their review tokens after an accepted broker submission, including a pending order. An uncertain submission outcome also stops siblings so you can check MT5. A rejected entry does not cancel other setups. It never cancels orders already submitted or closes positions. Multiple same-symbol reviews remain separate and require individual confirmation. Broker work is serialized, so a first-entry group cannot send two simultaneous successful entries from the same server. All members of a running group must use the same policy.

Risk settings apply to each order, not a shared portfolio budget. Independent setups can submit together and combined exposure can exceed one setup's risk percentage. Account mode and broker rules determine whether opposite entries hedge, reduce or reverse an existing position.

### Entry quality checks

Enable **Conditions → Check entry distance and minimum RR**. Settings freeze at Start, persist in drafts/saved templates, and appear in Applied vs draft. Older setups and starters keep the checks off. These filters apply to condition orders; alerts and ordinary manual ticket orders retain their behavior. A failure ends the setup as **Skipped**, records the reason and never retries. It does not stop linked peers because no entry was submitted.

**Maximum distance** uses price units (for gold, 5 means 5.00, not five ticks). Choose an applied condition as the reference. For a zone, distance is zero inside and otherwise measured from the nearest edge. A level uses its price; BOS/MS uses the break price observed when that applied step passed. The reference never follows later swings. Missing structure evidence skips the entry. Set distance to 0 to disable this check.

**Minimum RR** uses entry-to-SL price risk and entry-to-TP price reward. An optional target price caps reward at the nearer of that level and the actual TP, useful for support/resistance such as 3875. It never moves TP or assumes extra reward past the order's target. Set target to 0 to use TP; set minimum RR to 0 to disable the ratio check. Market checks include the app's 20-point adverse-entry allowance; pending orders use their entry price. These are price ratios, excluding costs and actual slippage.

Checks run during preparation, after preparation and again on the fresh submission quote, including confirmation of a review. A review that no longer passes is consumed and marked Skipped. Successful journal receipts include the evaluated quality metrics. Repositioning a saved template scales its optional target and distance along with the template's prices; inspect them before Start.

### Setup builder

Use **Build / edit setup** in the monitoring sidebar for a large three-step editor: **Conditions → Entry & risk → Review**. Choose a starter or saved template, set the conditions, choose BUY/SELL and risk/execution, then inspect the plain-language summary and readiness before explicitly starting. Next/Back, closing, changing views and chart picking do not arm monitoring or send orders. Prepared reviews still require the separate confirmation button.

Simple view hides sensitivity, buffers, timing, cancellation/quality controls and linked-group configuration; the summary continues to show active advanced settings. Show advanced exposes these controls without resetting values. Starter controls collapse after loading so conditions remain in focus. Pick on chart closes the builder temporarily and preserves the draft; reopen Build / edit setup to continue. Escape and Back to chart close it without stopping monitors.

The sidebar stays focused on monitors, with name, progress, risk/lots and cancellation price. Add another setup opens an independent draft in the builder. Open review opens the prepared order in its Review step. The optional **Quick order / classic editor** remains available and remembers whether it was expanded. It shares the same controls and draft as the builder, including manual position/pending-order amendments. There are no duplicate order inputs or alternate execution paths.

Condition chart labels distinguish **Draft preview · may move**, **Tracking · may move**, **Passed · fixed**, and **Frozen at Start · cancellation**. Running BOS/MS levels follow their applied structure tracker; a passed structure line uses the recorded break price rather than a later draft swing. Editing the draft marks its preview as a draft and never changes the recorded signal.

The selected setup and monitoring cards say what the active applied step is waiting for, including the candle timeframe, direction and watched price. Structure conditions explain that wicks do not pass the rule. Candle countdowns use the broker's current forming-candle timestamp and a fresh quote; they are estimates of the scheduled close, not a promise of the next quote or execution. Stale history, session gaps and unavailable candle timing suppress the countdown. These are display changes; condition evaluation and order execution are unchanged.

### If triggered now

Expand **If triggered now** on an active monitor to calculate a read-only estimate from that monitor's frozen settings and the current broker quote. It shows projected entry, SL, TP, lots, modeled account-currency risk and equity percentage, available price RR, and configured reference distance. The outcome says **Would pass local checks**, **Would skip at this quote**, or explains what is unavailable. This does not mean the conditions have passed, predict the price at a future trigger, or guarantee broker acceptance.

The estimate shares the automatic-plan calculator and local execution validations, including entry-quality checks. It does not call MT5 order_check/order_send, create or consume review tokens, change condition progress, record a journal entry, or reserve a linked group. Retest entries and structure-based distance references remain unavailable until the required break has actually been observed. Missing stop swings and invalid current protection are shown as current-quote failures.

Estimates load on expansion and Refresh, with only one request in flight in the UI. They do not poll brokers in the background. The server caches each estimate for three seconds; the timestamp is visible and estimates older than 15 seconds are marked old. Final prices, swings, sizing, entry quality and broker checks run again at actual execution. Status wording distinguishes settings frozen at Start from tracked swing levels that can move.

### Monitoring interruptions and recovery

A server polling gap over 30 seconds or unavailable MT5 market data stops that setup and records **Monitoring interrupted**. A finite quote older than 30 seconds instead pauses an unattempted running setup for up to two minutes; see Quote pause below. Stale prepared reviews and attempted submissions still stop without automatic re-entry. Hard interruptions record the last fresh quote time and the estimated data/monitoring gap. A polling gap can indicate laptop sleep or a scheduling interruption; the app does not claim it directly detected the lid or Windows sleep state. Stale quotes can also mean a closed market. Prepared reviews are invalidated when an interruption stops them. Already-submitted broker orders remain unchanged.

Stopped interrupted setups receive lightweight connection checks (one monitor per worker cycle, at most once per ten seconds per setup). Fresh quotes must come from the same MT5 account/server and account type, with trading permissions enabled for order modes. The card then says **Connection restored—review and restart**. Check connection requests a fresh check immediately. These checks never advance conditions, submit an order, or automatically resume monitoring. Explicit Stop, Stop all or replacement ends recovery checks for that old setup.

**Review & restart** checks the connection again and opens the preserved applied configuration in the builder's Review step. It does not restart anything. Review the conditions, cancellation, sizing and original execution mode, then use the explicit Start/Arm button to create a fresh setup starting at step 1. Swings/cancellation are re-established under the normal Start checks; missed candles are not replayed and old review tokens are never reused. Recovery details are in memory with the monitor and do not survive a server restart.

### Saved monitors after server restart

Waiting setups are saved atomically in `.local/condition-setups.json` (excluded from Git). This keeps their account/server, symbol, name, conditions, ticket/trade plan, sizing and risk, entry quality, group policy and previous frozen cancellation level. Server restart restores them as **Saved—review to restart**, with automatic entry disarmed, zero condition progress and no prepared-order token. Loading does not contact MT5 or replay old candles.

Choose **Review saved setup** to load its preserved configuration into the builder's Review step. For cancellation, it shows the previous frozen price and the proposed current draft price; the broker level is calculated again at explicit Start. Review the original execution mode and click Start/Arm to create a new one-shot setup from step 1. Returning fresh quotes does not start a saved setup. **Dismiss saved**, Stop all, or explicitly replacing a setup removes it from the next restart's saved list. Normally completed, invalidated and skipped setups do not return as waiting setups.

An order-submission intent is saved before sending. If the app stops before its outcome is recorded, the restored setup explicitly asks you to check MT5 positions/history before re-arming. It never resends an order or restores an old review token. Save errors are shown in the monitoring sidebar; a failed save before Start leaves the existing run intact, and a failed pre-send save prevents that submission. Corrupt files are preserved, with an unreadable backup retained before a later intentional save replaces them. Configurations are local JSON without broker passwords or order-review tokens.


### Monitoring workspace

The monitoring popup compares setups across all symbols, grouped by symbol, without taking space below the chart. Each row shows the side, current condition and timeframe, risk or lot size, cancellation level and status. Active setups appear first; saved/interrupted setups are under Needs attention, and stopped/completed runs are in collapsed History. Open monitoring workspace in the sidebar opens the popup; Close or Escape dismisses it. View on chart selects the setup without opening its editor. Open setup edits its draft; running settings change only after an explicit Start. Hiding or expanding the workspace does not change monitoring.

The top toolbar Monitoring button shows the active count and opens the popup even with the setup sidebar hidden. All, Monitoring, Needs attention and History filters narrow the view. Rows start compact; expand Details for cancellation, waiting explanations and estimates. Numbered default names are displayed as descriptions of the first condition; custom names are preserved.

Compact rows show the current trigger explanation without opening Details. The toolbar flags reviews, saved setups and interrupted monitors needing attention. Filter and expanded-row preferences survive browser refresh locally. Duplicate draft copies the settings into an independent alerts-only draft, clears linked-group membership, and leaves existing monitors untouched; it creates no server monitor or order until explicitly started.

The setup builder's Use current chart shortcut applies the current chart timeframe to the draft conditions, starter selection, automatic-plan swing stop and cancellation swing. Unsupported chart intervals require choosing a supported condition timeframe. A readiness strip shows the first blocking issue with a settings shortcut, or explains the selected Start action when ready. These controls edit the draft without starting or changing an applied monitor.

### Finished setup trade outcomes

In Monitoring → History, Check trade outcome reconciles the submitted order/deal identifiers against the same MT5 account and server. It is read-only and on demand: refresh to update waiting-to-fill, open, cancelled, expired, rejected or closed status. Closed net includes commission, swap and fees; R is shown only when original stop-loss risk can be calculated from the broker order. Floating profit is not a final result. Shared/netting entries, reversals and incomplete broker history are labelled explicitly instead of assigning the whole result to one setup. Finished, skipped and invalidated setups retain their phase and broker result across server restarts (up to the 100-run retention limit); use Sync closed trades to journal for durable closed-trade records. This does not auto-sync or submit any broker requests.

On startup, missing accepted execution snapshots can also be recovered from the local journal into History, including order and deal IDs. Recovery never arms a setup or sends an order. Waiting setups still restore disarmed. Stop all and explicitly restarting a completed setup preserve its prior History record. Old finished alerts or skipped setups that were never saved or journaled cannot be reconstructed.

### Automatic setup-trade journaling

The server checks recorded setup executions in the connected MT5 account every ten seconds, processing up to five outstanding entries per pass. Filled positions are linked to their immutable setup snapshots. Once a supported position closes, its closed-trade record is upserted into the journal and made available to the existing journal replay controls, without manual Sync closed trades. The journal remains the durable source for restart catch-up; no monitoring runner needs to remain active. Existing review text, drafts, screenshots, journal-account selection and history date filters are preserved. Open positions are not presented as closed trades. Partial closes, scale-ins, reversals and incomplete broker history remain unsupported by the existing replay reconstruction and are reported in the monitoring popup. Keep the server and the correct MT5 account connected; reopen Journal to load new records. Historical replay still needs broker price history.

### Optional breakout entry protections

In Build / edit setup → Entry & risk → Automatic trade plan, Stop placement can use Beyond swing and BOS / MS signal candle + buffer. BUY stops use the lower of the confirmed swing low and matching signal-candle low; SELL stops use the higher high. The buffer is applied outward, and lots and TP are recalculated for the chosen equity risk and R target. Missing matching signal data prevents entry.

Require breakout to hold until market entry checks BUY Bid above, or SELL Ask below, the matching observed broken level. It is checked during calculation, preview and submission, including after manual review; failure skips the attempt without automatic retry. It does not apply to retest limits. Both options require a matching BOS/MS direction when applicable, are frozen at Start, are recorded in the execution snapshot, and default to the previous swing-only / no-holding-check behavior. An estimate may be unavailable before the required signal candle has formed. These are testable execution filters, not a guarantee of better trade results.

Built-in BOS/MS starters now select the signal-candle-aware stop. Market starters also enable Require breakout to hold; retest-limit starters leave that market-only check off. Risk remains at the selected starter percentage (default 0.5%), target 2R and buffer 10 broker ticks. Loading remains alerts-only and does not arm entry. Existing saved templates retain their saved settings; load a fresh built-in and save a new named copy to adopt these options.

The starter selector includes eight presets: market and retest-limit BUY/SELL variants for both BOS and MS. Retest presets wait for the matching closed-candle structure break, then submit a limit at the broken level with 30-minute expiry, signal-candle-aware stop, selected equity risk and 2R target. They do not wait for an additional rejection candle at the retest; a limit fill is not extra confirmation. Setup cancellation only guards before submission; submitted pending orders require their own broker cancellation or expiry.

Accepted setup pending orders stay visible in a Pending orders section in the monitoring popup and count in the toolbar, including under the Monitoring filter. Their broker order ID and requested/live pending price are shown. Pending submissions say checking until MT5 verifies them; read-only background checks update fills, expiry and cancellation. Filled orders leave the pending section, with Position open / trade outcome available in History. This status tracking never cancels orders, and Stop monitoring / Stop all do not cancel submitted pending orders.

The + New setup button shares the same independent-draft action as Add another setup. It detaches the editor from the selected monitor and does not send a stop request. Editing a blank draft cannot replace an existing monitor unless that monitor is explicitly reopened first.

Monitoring History has search (name, symbol, order/deal ID or message), symbol/status filters and rolling started-date ranges. Filters apply only to historical cards, leaving active monitors and pending orders unaffected. Matching history is paginated at ten entries, selected newest-started first and grouped by symbol, with matching/total counts, Previous/Next and Clear filters. Preferences persist locally after browser refresh; filters do not remove stored history or change broker orders.


### Exposure, linked orders and setup results

The setup builder shows a compact Combined risk line before Start. Expand it for current-position risk (additional loss from quote to SL), pending-order risk (entry to SL), the proposed draft budget, and other armed setup budgets. Linked alternatives are counted conservatively; missing stops, stale quotes and unestimated fixed-lot setups make totals incomplete. Refresh exposure for a current snapshot. Estimates exclude gaps, costs and slippage, assume no hedge offsets, and do not impose a new trading limit.

Highlight order on a submitted setup switches to its symbol and emphasizes the exact broker order/position entry, SL and TP by broker identifiers. Unmatched or netting linkage is reported rather than guessed from symbol. Show all order levels clears the focus. Highlighting does not amend or cancel orders.

Journal → Setup performance compares linked closed trades by BOS/MS and market, limit retest or confirmation entry. Counts, win rate, net, total planned-risk R and average R use this account's recorded closed trades; duplicate position snapshots are counted once, and missing-risk trades are excluded only from R metrics. This summary is independent of the journal search filters; small samples are not evidence of profitability.

### Retest then rejection confirmation

Automatic trade plan Entry includes Retest then rejection candle → market. After all conditions pass, a matching observed BOS/MS level is fixed and the server watches future closed candles on that condition's timeframe. A BUY retest touches the level with its low, then requires a bullish candle closing above the level; SELL requires a high touching the level and a bearish close below. Touch and rejection can occur in one future candle, or rejection can follow a previous touch. The retest window uses the minutes setting; timeout or missed candles skip entry without replay/retry. Setup invalidation still applies while waiting. On confirmation the server prepares one market attempt, recalculates swing SL, target and risk-sized lots, and requires the live breakout still to hold at submission. Review mode still needs explicit confirmation. This mode does not place a resting pending order. Existing starters and running setups keep their current entry mode until explicitly changed and started again.


### Keep PC awake while monitoring (Windows)

Monitoring has a Keep PC awake while monitoring toggle, enabled by default and saved machine-locally in `.local/keep-awake.json`. A toolbar status button opens the control. While any setup is running (including a retest-confirmation wait), paused for short quote recovery, finishing, or awaiting order review, the server holds Windows SystemRequired and ExecutionRequired requests with the reason `TradeTrace: active setup monitoring`. It does not request the display to stay on, set away mode, or change power-plan, lid, registry or sleep settings. Closing the browser does not release an active server request. Stopped/finished/disarmed saved setups and broker-hosted pending orders alone do not require a request; when the last active setup ends, the toggle is disabled, the worker exits, or the server shuts down, requests are cleared and handles closed. Process exit also lets Windows clean up its handles.

The toolbar reports Keeping PC awake, Sleep allowed, protection off, an API error, or a battery/power-source warning. Requests are refreshed after long polling gaps or changes of AC/battery source. Configuration changes never start, stop or retry a trade. Save failures retain the previous preference; request failures are shown rather than reported as active protection. Existing quote-staleness and interruption stops remain in force, and saved setups after restart require explicit re-arming unless optional safe restart checks pass.

Keep the laptop plugged in for unattended monitoring. Microsoft documents that Modern Standby can terminate system/execution requests on battery five minutes after the sleep timeout, and manual sleep/lid/power actions can terminate requests. Hibernation, shutdown, power/network failure and MT5 disconnection remain possible. No request guarantees a broker connection. See [PowerSetRequest](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest).

Validation covers fake-native request counts, partial-acquisition cleanup, preferences, review/retest lifecycle, shutdown/worker-error cleanup, battery warnings and browser behavior. Native Windows acquisition and release succeeded on the development laptop on AC power, with no trading involved. SleepStudy and `powercfg /requests` require administrator access in that session; their reports and an overnight idle run were not verified. To validate unattended use, start an alerts-only test setup while plugged in, confirm Keeping PC awake, allow the screen to turn off beyond its usual idle interval, and verify quotes and server observations continue. Then Stop the test and confirm Sleep allowed. Do not use a live automatic order for that validation.


### Quote pause before entry

A finite stale quote (over 30 seconds old) pauses an unattempted running setup, blocks evaluation/orders and starts a fixed two-minute recovery window from detection. The Paused card remains in Monitoring and keeps the keep-awake request active. Stop still works. Fresh quotes must have a newer timestamp and pass the same account/server/type, permissions and current cancellation checks. Candle-based conditions and retest confirmation may resume only if the last observed required closed candle is still present and unchanged; a new/missing required candle stops for explicit restart, without replay. Live crossing/sweep memory is cleared and re-baselined so an unobserved move cannot be inferred. Recovery itself never evaluates an entry; normal evaluation may continue on subsequent fresh polls.

Configured unfinished-sequence gap/timeout resets still apply, and retest-confirmation expiry is not extended. Window expiry, a >30-second server polling gap, malformed/future timestamps, account changes or connection loss still stop safely. Prepared reviews and attempted/submitted orders never use automatic grace resumption. After a hard stop, fresh quotes only enable manual Review & restart. Server restart restores a paused setup disarmed. The grace does not alter broker-side orders or global Windows power settings.


### Optional safe resume after a brief server restart

In **Monitoring workspace**, enable **Safely resume waiting setups after a brief server restart**. This server-local preference is off by default. During a normal server shutdown, eligible waiting setups receive a one-use checkpoint of passed steps, structure tracking and any retest-confirmation wait. A crash, forced termination or PC reboot without a clean checkpoint restores setups disarmed as Saved.

The server must return within 30 seconds of the last observation and quote. Before resuming, it requires the same MT5 account, server and account type, fresh newer quotes, trading permissions where applicable, an unbreached frozen cancellation level and unexpired sequence/confirmation limits. Candle conditions require the exact last observed closed candle and unchanged OHLC: missed or revised required candles block resume. Live crossing/sweep sampling is re-baselined. The recovery poll never evaluates an entry; later normal polls may advance the armed setup and submit its single authorized order.

Checkpoints are durably consumed before validation. Reviews, paused setups, empty condition lists and attempted/submitted/uncertain orders never resume automatically. A recorded execution also blocks checkpoint replay. Failed checks leave the setup Saved with an explanation for manual review and Start; there is no automatic retry. Stop and disabling the option cancel pending restart checks. This feature cannot keep monitoring while the computer or server is off.

Restart the TradeTrace server to install this feature; refreshing the browser alone is insufficient. The first upgrade restart cannot preserve progress from the old server. Enable the setting and explicitly Start the saved setups once; subsequent eligible clean restarts can resume automatically.


The Terminal monitoring health bar reports running, paused, restart-checking and review counts, plus fresh quotes across setups currently being observed. If status polling fails or no response arrives for ten seconds, it reports monitoring status unknown; it does not infer that the server stopped. Monitoring shows the current clean-restart candidate count (final checks still run after restart). Setup cards show successful restart recovery and expandable connection/recovery events, including the detected gap when available. These events cover the current server run; they do not diagnose Windows sleep or power loss.


**Monitoring → Results** reads the selected journal account and summarizes closed positions linked to their recorded condition setup. Group by BOS/MS (mixed sequences are shown separately), symbol or setup name. Totals include wins, losses, flat trades, win rate, net P/L and average net R with its risk sample count. R uses the recorded automatic-plan modeled loss, not a reconstructed stop; trades without it remain in P/L totals and are excluded from R averages. Pending/open/skipped rows use retained monitoring outcomes, separate from closed journal statistics. Refresh results reloads the journal snapshot without placing orders or changing setups. The latest 50 linked closed trades provide Journal/Replay actions; replay still requires the matching connected MT5 account and broker price history. Older records have no template identifier, so setup-name grouping does not infer a template.


The setup sidebar now shows a short draft story and **My templates / Save as template** shortcuts. In the builder, the personal template library is visible without Advanced settings. BOS breakout, BOS retest and MS reversal shortcut buttons use the explicit Buy/Sell selector; timeframe and risk remain editable before loading the inactive draft. The detailed preview and readiness checklist remain in Review. Personal templates stay in this browser (up to 30); saving the same name updates its stable identity and increments its version. Loads remain alert-only, and draft direction is retained on refresh. Existing selected monitoring follows the usual template-load Stop behavior; choose New setup before loading if you want to keep that monitor running.

New setup starts freeze a “based on template” identity and version in their settings and execution journal snapshot. Later draft edits or template updates do not rewrite an execution. Results can group by **Based on template**, separating identities and versions; this records provenance, not a claim that every setup used identical settings. Legacy trades are Unattributed.


Click a monitoring card heading or **View on chart** for a compact, read-only chart review. It shows the applied waiting step, current trigger/zone, frozen cancellation and available estimated entry/SL/TP, with RR and estimate time. Structure triggers are labelled as tracking and may move; retest confirmation levels are shown separately. Projections expire after 15 seconds or a step/phase change, and cannot be shown when server status is unknown. Refresh estimate uses the existing read-only calculation; unavailable future retest prices are explained rather than invented. Prepared review levels and matched broker order/position levels are labelled separately. **Fit review levels** includes the review prices in chart scaling; Close removes the review overlays. Same-symbol inspection leaves the editable draft untouched; another-symbol review uses normal chart navigation. **Edit setup** explicitly opens the applied setup in the builder. Neither inspection, Fit nor estimate refresh starts/stops monitoring or submits an order.
