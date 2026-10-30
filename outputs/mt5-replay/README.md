# MT5 Trading Journal

A private, read-only local Windows app to replay closed MT5 trades, with outcomes, net P&L, recorded exit reasons, SL/TP and pre-entry candles.

## Trading journal (v1.0.0)

The **Journal**, **Calendar**, and **Trade replay** tabs share the same MT5 account history.

- Connecting and loading MT5 history saves supported closed-trade snapshots locally. Repeated syncs update imported facts without overwriting notes or attachments. To include older trades, widen the replay history From/To dates and load again.
- Select a saved trade to add notes, a lesson, up to 12 setup tags, a process rating, four checklist items, and a reviewed flag. Click **Save review**; unsaved changes are indicated and protected when switching trades or closing the page.
- The calendar groups trades by exit date in Bangkok, UTC, or your browser's local timezone. Green/red daily cells show net P&L and trade count. Click a day to filter its trades; previous/next controls change the month.
- Statistics show net P&L, trade count, wins / all closed trades, profit factor (gross gains / absolute gross losses), average net P&L and reviewed count. Search/status filters apply; Calendar statistics cover the selected month. Accounts and currencies are not combined. Summaries cover only synced supported positions and linked charges, not deposits, withdrawals, open trades or all account-level fees.
- Upload PNG/JPEG/WebP screenshots (3 MB each, eight per trade), or replay the selected trade and return to Journal to capture its chart. Screenshot links open the full image. Screenshots and notes work without MT5; tick replay still requires the matching account connected.
- Saved records remain available after restarting or disconnecting MT5. **Download journal backup** creates a SQLite backup containing snapshots, reviews and images, without the API key.

The database is `.local/journal.sqlite3`, excluded from Git. Unlike the separately encrypted API key, journal records and downloaded backups are **not encrypted**. To restore a backup, stop the app, keep a copy of the existing database, and replace `.local/journal.sqlite3` with the downloaded SQLite file before restarting. No journal data is uploaded to external services. The sample replay is never added to your journal.

## Start

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

Choose 15 minutes, 30 minutes, 1/4/8/12 hours, 1 day, 3 days or 1 week of context and select a trade. Completed M1 candles appear before the entry marker; the entry-containing candle is excluded to avoid revealing post-entry OHLC. Playback starts at the first available tick at or after entry and reveals bid/ask ticks. The closing quote includes its exact UTC timestamp. Scrubbing before the first tick shows the first-quote time and a jump button; prices are never backfilled from the future. The horizontal axis shows spaced UTC timestamps and adds month/day labels for ranges spanning multiple dates. Buys close against bid, sells against ask. SL/TP lines are labeled with their sources and serve as historical references throughout replay. Missing ticks and context are flagged; no invented prices are substituted.

The list and replay show green WIN, red LOSS or neutral BREAK EVEN based on recorded net profit, including linked commissions/swaps/fees. Running movement is in price units, not floating account currency. Final outcomes remain visible immediately. The exit reason comes from the recorded deal, not a price comparison. Expand the trade verification panel to reread executions and compare tickets, prices and charges with MT5 History.

## Limits and startup

V1 supports one entry plus one full exit, positions lasting up to 7 days and 500,000 ticks. Partial closes, scale-ins, reversals and unmatched/open positions are excluded. Separate account-level charges may not be linked to a position. Broker historical tick/candle coverage varies; warnings do not guarantee archive completeness.

The server listens on 127.0.0.1 only and uses a per-process request token. No external chart services are used. Selecting a symbol can add it to Market Watch. Start.cmd reuses an existing server only when app, version/build and workspace match. Close the old console if a stale version occupies the port; another process is never terminated. Live setup must run outside the coding assistant sandbox. Use a single browser session; reconnect after switching accounts. Stop the console with Ctrl+C.

## Development

Python standard-library backend; vanilla JavaScript/canvas frontend. Live connection needs the official MetaTrader5 package. The direct native client uses only Python standard-library HTTP/JSON.

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/app.js
node --check static/connection.js
```

References: [native deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties), [Python deal history](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py), [historical ticks](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py).
