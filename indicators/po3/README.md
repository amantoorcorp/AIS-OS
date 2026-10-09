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
| Faded old cycles, vivid latest | Last finished cycle stays bright; it fades once the next trade or breakout prints |
| `Cycles 23 = 13 + 9 + 1` | Cycles = trades taken = Target + Stop + Timeout |
| `Avg R 1.3R` | Mean realized R over all cycles |
| `Form` | Last 10 outcomes: ■ target, □ stop, ▣ timeout |
| `Failed / Breakout` | Failed = sweep never reclaimed in time. Breakout = decisive close through the boundary |
| `Resets (e/n/y/f)` | Ranges dropped without a trade. Our reading: **e** expired (no sweep before `Range expiry`), **n** neutral (both sides swept on one bar), **y** yielded to HTF bias, **f** filtered (R:R below `Min R:R`) |
| `HTF Bias Off` | Optional higher-timeframe EMA filter (non-repainting `request.security`) |
| `TF 1D ⚠ (opt: 15M)` | Warns when chart TF ≠ `Optimal timeframe` |

## Cycle state machine

```
SCAN ──compression──▶ ACCUMULATION ──wick beyond boundary──▶ MANIPULATION
  ▲                        │ expired / double sweep (reset)        │ close back inside → DISTRIBUTION (trade)
  │                        ▼                                       │ no reclaim in time → Failed
  └──────── target / stop / timeout / breakout / reset ◀───────────┘ deep close outside → BREAKOUT
```

Same-bar stop and target counts as a stop (conservative). Stop fills at the open on a gap.

## Alerts

Boundary sweep, Long (D▲), Short (D▼), Target hit, Stop hit, Timeout, Breakout, Failed reclaim. Plus one dynamic `alert()` per signal with entry, stop, target and R.

## Tuning

- **15m**: defaults are fine. Try `HTF bias = EMA` with `HTF timeframe = 240`.
- **1D**: lower `Min range bars` to 15 and raise `Max range width` to 5 if few ranges show.
- Too many tiny trades: raise `Min R:R`. Too few: lower `Max compression percentile`.

## Known differences from the original

The original source is closed, so these are guesses: exact compression math, reset-letter meanings, target selection rule, timeout length. Stats will not match the screenshot 1:1.
