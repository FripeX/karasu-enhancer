# Karasu Enhancer

Browser extension for [karasu.live](https://karasu.live) that automates matchmaking and adds in-game stats overlays.

## Features

### Matchmaking
- **Auto-ready**: clicks READY the moment a match is found.
- **Configurable delay**: set a click delay from 0 to 10 seconds (instant by default).
- **Desktop notifications**: get alerted as soon as a match is found.

### In-game overlays
- **Team Elo**: average Elo per team, win probability and expected Elo gain/loss.
- **Map stats**: your personal win rate on every map of the lobby.
- **Team map stats**: each team's average results over their last 30 matches, per map.
- **Best picks**: suggests the maps where you have the highest win rate.
- **Live stats**: K/D and KDA displayed during the match.

### Other
- Bilingual interface (English / French), auto-detected and switchable from the popup.
- Every feature can be toggled individually from the extension popup.
- Match history is synced automatically: open your match history on karasu.live once, and stats stay up to date afterwards.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Open [karasu.live](https://karasu.live) and configure the extension from the toolbar icon.

Requires a Chromium-based browser (Chrome 111+).

## Permissions

| Permission      | Usage                                          |
| --------------- | ---------------------------------------------- |
| `storage`       | Save settings and match history locally        |
| `notifications` | Alert when a match is found                    |

The extension only runs on `karasu.live`.

## Author

Made by [FripeX](https://github.com/fripex).
