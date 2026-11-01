# TradeTrace

A private local-browser Windows workspace for MT5 market analysis, demo market orders, and a trading journal with historical trade replay.

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
Live accounts support analysis; execution remains restricted to demo accounts.

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
  price, not an order at the drawn entry; its existing demo-only review and
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
- The order ticket supports market buys/sells with optional SL/TP. **Review demo
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
  inspect open positions. Both placement and cancellation are demo-account only.
  When the ticket is in pending mode, copying a chart plan also copies its entry;
  market mode continues to use current broker pricing.
- **Close** on an open-position row reviews closing its entire volume. The review
  shows the exact ticket, symbol, account, volume and current closing quote; a
  separate **Confirm close entire position** sends the request. Only demo accounts
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

Open positions support **Edit SL / TP** in the positions table or by clicking their chart label. Drag or type protection levels, or use × to remove a level, then review and confirm. Filled entry and volume remain fixed. Amendments are demo-only, rechecked against the current quote and broker rules, and rejected if the position changes after review.

Draft SL/TP chart labels show estimated signed P/L in account currency using MT5 broker profit calculations. Amounts update after entry, side, volume or protection changes, including single-leg drafts and position amendments. Estimates exclude commission, swap and slippage; previous amounts remain marked while an update is pending. Estimating never sends an order.

Trading activity below the chart is grouped into **Open**, **Pending**, and **Closed** tabs. Closed reads up to 100 supported closed positions from the last 30 days and includes opening/closing commission, swap and fees in net P/L; complex positions follow the journal history limitations. New pending orders select the Pending tab automatically.

Terminal fits the browser viewport without page scrolling. Drag the dividers beside Watchlist and Order ticket, or above trading activity, to resize panels; arrow keys also resize focused dividers and double-click resets a size. Panel sizes and desktop visibility save locally. Long panels scroll internally. On compact screens, Watchlist and Order ticket buttons open overlays. Journal and replay retain normal page scrolling.

## Entry conditions

Open **Order ticket → Conditions**. The setup sidebar has separate **Order** and **Conditions** tabs, a shared status badge and risk/sizing card, and compact condition summaries. Expand one row at a time to edit it; timing/reset options are under a separate disclosure. **New setup** clears the condition and order draft, stops monitoring, resets execution to alert-only, and preserves the previous completed result under **Last setup result**. It never starts monitoring or sends an order. Existing broker positions and pending orders are unchanged.

The ordered rule workflow comes from PriceConditionAlerts v1.32: add/remove/reorder conditions, choose live Bid or completed candles (M1/M5/M15/M30/H1/H4/D1), and enter a level or inclusive zone. Supported rules are zone entry/touch, trades above/below, sweeps returning across a level, candle closes above/below/inside, and first candle close above/below. Candle-only rules select completed-candle mode automatically.

Select a chart **Level** or **Zone** drawing, then click **Use as condition** in the chart toolbar. Levels create a live Bid Trades above condition; zones create a live Bid Enters zone condition. Review/change the rule in the opened Conditions tab. Prices copy at the broker tick size; zone time bounds are not entry criteria. The original drawing stays independent: later drawing edits do not change the copied condition. Conversion only adds a draft and never starts monitoring, opens an order draft, or sends an order.

Each row has a progress badge: **Watching** is the active applied step, **Waiting** follows earlier steps, and **Passed** has completed. **Draft** identifies an unapplied row; **Edited** indicates draft prices/rules/order differ from the frozen applied setup. Visibility changes do not affect progress. Stopping monitoring marks unfinished applied rows Stopped; quote-gap/timeout resets clear passed progress on the next observation. Finished progress saves with the setup and survives reload. Only an explicit Start begins a fresh sequence; New setup clears its badges while preserving the last result.

Condition drafts have independent chart previews: dashed price levels and shaded zones with price labels. Select a row to highlight it. Drag a condition label or a selected level line to move its price; zone low/high drag independently, and **Move zone** shifts both boundaries while preserving width. Prices snap to the broker tick and zone boundaries cannot cross during dragging. **Pick on chart** fills a specific condition price; Escape cancels picking or restores a cancelled drag. Show condition levels/zones switches and each row's Show on chart checkbox control visibility independently of order drafts and save per account/server/symbol. Moving or hiding conditions does not open an order draft or change an already running setup; explicitly Start again to apply draft edits.

Choose **Alert only**, **Prepare order for review**, or **Automatic demo entry**, configure the normal market/pending ticket and select ticket lots or automatic 2% equity sizing. Start snapshots the condition list and ticket. Later draft/ticket edits do not change that running snapshot; Start again applies them. Changing the action stops the monitor. Trade modes require SL and TP; live accounts retain analysis/alerts only. An empty list completes immediately on Start, including one immediate demo order attempt when automatic entry is explicitly armed. Start is the explicit authorization for automatic demo submission; review mode instead requires the normal confirmation button.

Only the active step is observed; each step needs a separate fresh quote observation. Prior sweeps do not carry forward. Candle steps establish a baseline and wait for a new completed candle; the forming candle and old closed candles never trigger a step. A positive timeout runs from the first passed condition. Quote gaps reset progress and sweep memory. All modes are one-shot and require Start to rearm.

Completed setups stay Finished, including after quote gaps, timeout deadlines, hiding/reopening Terminal, reconnecting, or reloading. Completion status saves per account/server/symbol. Editing draft settings does not rearm them; only explicitly clicking Start creates a fresh run. Sequence reset rules apply only to unfinished monitoring.

TradeTrace polls while the Terminal is visible, approximately every two seconds. It observes sampled Bid, not every MT5 tick: intrapoll entries/sweeps can be missed, and multiple candle closes between polls are not replayed. Keep the app connected and visible. Hiding the browser/Terminal, disconnecting, stale quotes, changing the chart selection, or reloading stops monitoring. There are no background/mobile notifications. Draft rules and sizing preferences restore separately per server/account/symbol; execution mode always restores to alert-only, with monitoring stopped. A request already sent cannot be recalled by Stop.

Automatic lots are calculated at completion from current equity and broker account-currency loss estimates, rounded down to broker steps and capped at broker maximum. The calculation includes an adverse entry allowance of 20 broker points; minimum lots above budget are rejected. The server rechecks the 2% modeled cap at both preview and submission, rejecting changed risk rather than rounding up. Manual ticket lots remain permitted above 2%. Commission, swaps, gaps and execution beyond the allowance are excluded; actual loss can exceed the estimate.

Selecting 2% equity also sizes the draft immediately once a valid stop loss is present. The ticket and chart entry label show the calculated lots, and the draft estimate shows the equity budget and modeled risk. Entry/SL/side changes refresh sizing; manual lot controls are disabled in this mode. Missing stops, unavailable estimates, or an unaffordable broker minimum block ordinary ticket review until a valid current size is available. Condition completion still recalculates from the latest equity and quote before submission. Existing broker positions and pending-order amendments retain their fixed volume.

Condition orders use the existing broker preview/submission validation, freeze pending limit/stop type at preview, require unchanged account identity, and allow additional positions or pending orders on the same symbol. Automatic 2% sizing applies independently to each new order, not to combined existing exposure. MT5 account mode and broker rules determine whether fills create separate positions or adjust a net position. The server permits one condition-entry submission attempt per account/server/symbol in 60 seconds, shared by tabs using that server process. The cooldown is in memory and does not coordinate separate server processes. Rejected, skipped and unknown outcomes are never retried automatically. Existing broker orders are not cancelled by stopping monitoring.

Verification: `node tests/test_terminal_conditions.cjs`, `python -m unittest discover -s tests`, and `node tests/test_conditions_browser.cjs` (Playwright; all broker endpoints mocked). Browser tests accept `TRADETRACE_TEST_PYTHON` to override the default `.venv/Scripts/python.exe`. No broker orders are sent by these tests.
