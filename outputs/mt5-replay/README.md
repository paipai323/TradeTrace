# MT5 Replay

A private, read-only local Windows app to replay closed MT5 trades, with outcomes, net P&L, recorded exit reasons, SL/TP and pre-entry candles.

## Start

Run **Install.cmd** once if dependencies are missing. Open MT5 and sign in, then double-click **Start.cmd** in File Explorer. The app opens at http://127.0.0.1:8766. Click **Find running MT5**, select your terminal, connect and load exit dates (UTC).

## Direct SL/TP history (v0.6.0)

No EA, script, chart attachment, export, import or helper installation is used.

The app uses MT5’s **built-in local MCP server** to request historical positions directly. This is separate from the Python tick connection.

1. In the signed-in MT5 choose **Tools → Options → MCP**. Enable the internal server and copy its address and API key.
2. In the replay app connect to MT5 as usual. Expand **Direct MT5 history → Connect direct history**, paste the local address and API key, then connect. Keep the key out of chat.
3. Load history and select a trade. Matched SL/TP values refresh automatically. The key stays in server memory until reconnection/restart and is cleared from the form after successful authentication. It is never saved or logged.

Only local HTTP endpoints at 127.0.0.1 or localhost are accepted; redirects are refused. The client allows only get_trading_account_info, get_trading_history_positions and get_trading_history_orders. No trading tools are invoked. Account and server must match the Python connection before levels are accepted. Position ID, symbol and opening price must match; malformed, conflicting or unsupported responses fail explicitly. Native zero values mean no corresponding level at close. Historical stop amendments cannot be reconstructed.

**Verification status:** authenticated against the running MT5 terminal and verified that direct history supplied both SL and TP for all 13 loaded supported positions. Protocol, account matching, response handling and browser flows also pass automated checks. Unknown response formats fail explicitly instead of inventing levels.

References: [MT5 MCP configuration](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/configuration), [native history capabilities](https://www.metatrader5.com/en/terminal/help/mcp_and_ai/capabilities).

## Replay

Choose 15/30/60/240 minutes of context and select a trade. Completed M1 candles appear before the entry marker; the entry-containing candle is excluded to avoid revealing post-entry OHLC. Playback starts at entry and reveals bid/ask ticks. Buys close against bid, sells against ask. SL/TP lines are labeled with their sources and serve as historical references throughout replay. Missing ticks and context are flagged; no invented prices are substituted.

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
