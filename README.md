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

The app saves `.m4a` (AAC, about 128 kbps). It plays everywhere, including iOS apps like Documents by Readdle. The audio is YouTube's own stream, never re-encoded. Up to 3 downloads run at once; the rest wait.

## Opus library (e.g. for Navidrome)

Every finished download is logged to `~/Music/ytm-dl/.ytm-dl.jsonl`. One command downloads that whole library again as Opus, YouTube's best free stream (about 130–160 kbps), into a separate folder:

```bash
ytm-dl opus            # → ~/Music/ytm-dl-opus
ytm-dl opus ~/navidrome/music
bun run opus           # same, without `bun link`
```

Run it again any time: it only fetches what's new or failed last time. Finished tracks are listed in `.ytm-dl-archive.txt` in the Opus folder; delete that file (or a line in it) to fetch them again.
