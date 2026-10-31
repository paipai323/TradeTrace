# TradeTrace

A private, read-only local Windows app to replay closed MT5 trades, with outcomes, net P&L, recorded exit reasons, SL/TP and pre-entry candles.

The application lives at the repository root. Run `Install.cmd` once, then
`Start.cmd`. Python modules sit beside the launcher, browser assets are in
`static/`, and automated checks are in `tests/`. Local journal data and the
encrypted API key stay in `.local/`, which is excluded from Git.

If upgrading from the earlier `outputs/mt5-replay` layout, stop the old server
first, move its `.local` folder to the repository root to keep your journal and
saved key, and run `Install.cmd` to create the environment at the new location.
Run `CreateShortcut.ps1` to regenerate the launcher shortcut and replace any old
pinned shortcut.

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
