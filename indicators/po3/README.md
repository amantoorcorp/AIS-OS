# Po3 · Accumulation / Manipulation / Distribution (Pine v6)

Clean-room rebuild of the "Po3 v2.4.0" indicator, reverse-engineered from one BTCUSD 1D screenshot. Not the original source. Logic is inferred from what the chart and dashboard show.

## Install

1. TradingView → Pine Editor → New → paste `po3_accumulation.pine`
2. Save → Add to chart
3. Best on 15m (the dashboard warns on other timeframes, like the original). It also works on 1D.

## What the screenshot told us

| Seen on chart | Rebuilt as |
|---|---|
| Dashed gray boxes | **Accumulation**: a range of at least `Min range bars` whose width is ≤ `Max width × ATR` and whose compression percentile is ≤ `Max compression percentile` |
| `Compression 16p ▰▰▰▰▰▱` | Percentile rank of (range width / ATR) over `Compression lookback`. Lower = tighter. Meter fill = (100 − p) / 100 × 6 (16p → 5 of 6 filled, matches) |
| `Phase ACCUMULATION (22b)` | Current state + range age in bars |
| `M` tags | **Manipulation**: wick beyond a range boundary (≥ `Min sweep depth`) |
| `D▲` / `D▼` | **Distribution** signal: close back inside the range within `Bars allowed to reclaim` |
| Entry / Stop / Target lines | Entry = reclaim close. Stop = sweep extreme ± buffer. Target = nearest unswept swing high/low beyond the range (external liquidity) |
| `✓ +4.88R` | Realized R = (exit − entry) / (entry − stop). Checked: (71868.11 − 59744.60) / (59744.60 − 57258.81) = 4.88 |
| `Target -23%` on a short | Targets are far, several times the range height, so they're liquidity pools, not range projections |
| `BREAKOUT` + orange box | Close beyond boundary by > `Breakout close × ATR`, or sweep deeper than `Max sweep depth` |
| Faded old cycles, vivid latest | Last finished trade stays bright until the next trade opens. Breakouts keep their orange box |
| One green zone per trade | Box from the sweep extreme to the target, plus dotted `1R` level |
| Red `?` | Marks a live range waiting on its sweep |
| `Cycles 23 = 13 + 9 + 1` | Cycles = trades taken = Target + Stop + Timeout |
| `Avg R 1.3R` | Mean realized R over all cycles |
| `Form` | Last 10 outcomes: ■ target, □ stop, ▣ timeout |
| `Failed / Breakout` | Failed = sweep reclaimed, but later than `Bars allowed to reclaim` (no trade). Breakout = decisive close or wick through the boundary. Matches the screenshot's 0 / 4: failures are rare |
| `Resets (e/n/y/f)` | Ranges dropped without a trade. Our reading: **e** expired (no sweep before `Range expiry`), **n** neutral (both sides swept on one bar), **y** yielded to HTF bias, **f** filtered (R:R below `Min R:R`) |
| `HTF Bias Off` | Optional higher-timeframe EMA filter (non-repainting `request.security`). Auto-promotes to the next of 240 / D / W / M / 12M if the chosen TF isn't above the chart TF |
| `TF 1D ⚠ (opt: 15M)` | Warns when chart TF ≠ `Optimal timeframe` |

## Cycle state machine

```
SCAN ──compression──▶ ACCUMULATION ──wick beyond boundary──▶ MANIPULATION
  ▲                        │ expired / double sweep (reset)        │ close back inside in time → DISTRIBUTION
  │                        ▼                                       │ reclaim too late → Failed
  └──────── target / stop / timeout / breakout / reset ◀───────────┘ deep close outside → BREAKOUT
```

Same-bar stop and target counts as a stop (conservative). Stop fills at the open on a gap; target fills at the target. A new range can't overlap the last cycle's bars.

## Gold, ES, NQ

`Preset = Auto` detects the symbol and loads tuned inputs. Works on futures (GC/MGC, ES/MES, NQ/MNQ, incl. `1!` continuous) and CFDs (XAUUSD, US500/SPX500, NAS100/US100). Run it on **15m**.

| Input | Gold | ES | NQ |
|---|---|---|---|
| Min range bars | 20 | 16 | 16 |
| Max range width (×ATR) | 4.0 | 3.5 | 4.0 |
| Range expiry (bars) | 96 | 64 | 64 |
| Min / max sweep depth (×ATR) | 0.05 / 1.5 | 0.03 / 1.2 | 0.05 / 1.5 |
| Bars allowed to reclaim | 3 | 2 | 2 |
| Breakout close (×ATR) | 0.75 | 0.6 | 0.75 |
| Liquidity pivot length | 10 | 8 | 8 |
| Trade timeout (bars) | 40 | 26 (one RTH day) | 26 |
| Trade window (NY time) | 02:00–12:00 | 09:30–16:00 | 09:30–16:00 |

These are reasoned starting points, not backtested optima. Pick `Custom` to use your own numbers.

Session features:
- **Trade window**: setups outside it reset the cycle (y). Open trades flatten at the window end (Timeout).
- **Accumulation source = Session range**: the Asia box (20:00–00:00 NY) becomes the range, swept later at London/NY. Classic ICT Po3 for indices and gold. For ES/NQ set the trade window to `0200-1600` if you want London sweeps too.
- **Min stop buffer (ticks)**: stop is never tighter than this many ticks past the sweep.
- **Risk row**: points and $ per contract from `syminfo.pointvalue` (ES $50/pt, NQ $20/pt, GC $100/pt, micros 1/10th).
- **HTF bias**: EMA on 240 is a good filter for ES/NQ.

## Alerts

Boundary sweep, Long (D▲), Short (D▼), Target hit, Stop hit, Timeout, Breakout, Failed reclaim. Plus one dynamic `alert()` per signal with entry, stop, target and R.

## Tuning

- **15m**: defaults are fine. Try `HTF bias = EMA` with `HTF timeframe = 240`.
- **1D**: lower `Min range bars` to 15 and raise `Max range width` to 5 if few ranges show.
- Too many tiny trades: raise `Min R:R`. Too few: lower `Max compression percentile`.

## Calibration check

The screenshot was taken on BTCUSD 1D (Binance) with the 15m warning showing, so likely default inputs. Target to match: 23 cycles, 13 / 9 / 1, Failed / Breakout 0 / 4, Resets 1 / 0 / 0 / 0, Avg R ≈ 1.3. If yours is far off, tune `Max compression percentile` (20–25), `Min R:R` (1.5–2) and `Liquidity pivot length` (10–20).

## Known differences from the original

The original source is closed, so these are guesses: exact compression math, reset-letter meanings, target selection rule, timeout length. Stats will not match the screenshot 1:1.
