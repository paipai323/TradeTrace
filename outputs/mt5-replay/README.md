# MT5 Replay

A private Windows app for replaying closed MT5 positions using historical bid/ask ticks. The Python service binds only to `127.0.0.1`; the interface and chart have no external assets. No trading API is called. Selecting a historical symbol may add it to Market Watch.

## Start

1. Install 64-bit Python 3.10 or newer if needed.
2. Run **Install.cmd** once (internet required for the official MetaTrader5 connector and its dependencies).
3. Open MT5 and sign into the account you want to review.
4. Double-click **Start.cmd** yourself in File Explorer. Your browser opens at http://127.0.0.1:8766. This keeps the connector outside the coding assistant's restricted environment. The connector refuses restricted Windows tokens and requires an already running terminal before calling the MT5 API. The API itself can still launch a process if the terminal exits or cannot be reached during initialization.
5. Connect, choose an inclusive range of **exit dates in UTC**, and load history. If multiple terminals are installed, enter the full path to the intended `terminal64.exe` before connecting. Verify the displayed account.
6. Select a position and use Play, Next tick, speed, or the timeline. The synthetic sample works without MT5.

Close the launcher console or press Ctrl+C to stop the service. To use a different port: `.venv\Scripts\python.exe server.py --port 8766`.

## Accuracy and supported positions

- V1 supports one entry plus one full exit, including manual closure, stop loss, take profit and stop out. Scale-ins, partial closes, reversals, unmatched/open positions and other complex histories are excluded and counted. The exclusion count covers all retrieved history, not only the chosen dates.
- Exit classification comes from the actual deal reason, not a guess based on price touching a line. The actual entry and exit fill prices are marked separately from the quotes.
- SL and TP are read from the **closing order** where available. They are reference lines for the full replay, not a reconstruction of trailing stops or earlier amendments. Missing levels are omitted.
- Buys are valued against bid; sells against ask. Running movement is signed price difference **per unit**, not floating account-currency profit. Final net sums recorded entry and exit profit, commissions, swaps and fees; separate account-level charges may not be linked to the position.
- Broker tick availability varies. Coverage warnings identify missing boundary coverage and gaps over 60 seconds; gaps can also reflect closed markets. Even an unflagged replay is not a guarantee of a complete tick archive. Missing ticks are never replaced with invented prices or candle paths.
- Up to 7 days and 500,000 ticks per position. Loading is synchronous; keep the app open while it fetches. No trade data is saved to disk by the app.
- Account switches require reconnecting and reloading. Use a single browser session at a time; the connector state is shared locally.

## Development

Standard-library HTTP backend and vanilla JavaScript/canvas frontend. Only the live connector requires `requirements.txt`.

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/app.js
```

API references: [historical deals](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py), [tick ranges](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py), [deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties).

## Connection and verification (v0.2.0)

Click **Find running MT5**, select the signed-in terminal and connect. The advanced path box overrides the selection; normally leave it empty. The checks distinguish terminal discovery, connector initialization, account login, history and tick availability. Later stages remain waiting until used.

The header shows the app version and build. Running Start.cmd twice opens the existing server only if its app identity, workspace and build match. An older server or unrelated service on the port causes a clear error: close the old replay console and start again. The launcher never terminates another process.

After selecting a real trade, expand **Check this trade against MT5 History** and reread the execution records. It checks cached import values against a fresh MT5 read and displays both executions and linked costs. Compare these with MT5’s History tab to independently confirm entry/exit, timestamps, lots, charges and closure reason. This is import consistency verification, not proof of complete broker tick coverage.
