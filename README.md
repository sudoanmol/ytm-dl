# ytm-dl

Keyboard-first terminal app to search YouTube Music and download songs or whole albums.

- Search: [YouTube.js](https://github.com/LuanRT/YouTube.js) (YouTube Music's internal API, no key needed)
- Download: `yt-dlp` + `ffmpeg`, with tags and square cover art
- UI: [OpenTUI](https://github.com/anomalyco/opentui) (React)

## Setup

```bash
brew install yt-dlp ffmpeg
bun install
bun link        # optional: puts `ytm-dl` on your PATH
```

## Run

```bash
bun start       # or: ytm-dl
```

Files go to `~/Music/ytm-dl/<Artist>/<Album>/`. Set `YTM_DL_DIR` to change that.

## Keys

| Key | Action |
| --- | --- |
| type + `↵` | search |
| `tab` | switch between songs and albums (re-runs the search) |
| `esc` / `↓` | from search box to results |
| `j` `k` / `↑` `↓` | move |
| `g` / `G`, `ctrl+d` / `ctrl+u` | top / bottom, half page |
| `↵` | song: download. album: open its track list |
| `d` | download the selected song, or the whole selected album |
| `D` | in an album: download the whole album |
| `esc` / `h` | back out of an album, or back to the search box |
| `/` | focus search |
| `c` | clear finished downloads |
| `q` / `ctrl+c` | quit (`q` asks again if downloads are running) |

## Quality

Downloads the best stream YouTube offers, which is Opus at about 130–160 kbps (format 251) for free accounts. The audio is kept as-is, never re-encoded, so files end up as `.opus` (or `.m4a` when YouTube only has AAC). Up to 3 downloads run at once; the rest wait.
