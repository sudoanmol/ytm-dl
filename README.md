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

## Library layout

```
~/Music/ytm-dl/
  Radiohead - Creep.m4a                 ← songs in no playlist
  Road Trip/
    Radiohead - Bangers + Mash.m4a      ← a playlist is a folder
  Chill/
    Radiohead - Lull.m4a
```

- Files are named `Artist - Title`. Album, track number and year are in the tags.
- A song lives in one place only. Adding it to another playlist moves it there; `d` moves it back to the main folder.
- Set `YTM_DL_DIR` to use another folder.

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
| `p` | add the selected song (or album) to a playlist: pick one, or type a new name |
| `P` | in an album: add the whole album to a playlist |
| `esc` / `h` | back out of an album, or back to the search box |
| `/` | focus search |
| `c` | clear finished downloads |
| `q` / `ctrl+c` | quit (`q` asks again if downloads are running) |

## Quality

The app saves `.m4a` (AAC, about 128 kbps). It plays everywhere, including iOS apps like Documents by Readdle. The audio is YouTube's own stream, never re-encoded. Up to 3 downloads run at once; the rest wait.

## Opus library (e.g. for Navidrome)

Every saved file is logged to `~/Music/ytm-dl/.ytm-dl.jsonl`. One command mirrors the library as Opus, YouTube's best free stream (about 130–160 kbps), with the same names and playlist folders:

```bash
ytm-dl opus            # → ~/Music/ytm-dl-opus  (or bun run opus)
ytm-dl opus ~/navidrome/music
```

Run it any time. It moves files for songs that changed playlist and only downloads what's missing.

## Sync to R2

```bash
ytm-dl sync            # or bun run sync
```

Updates the Opus library, then mirrors it to the R2 bucket `music` with rclone: new files go up, and files gone locally are deleted from the bucket. It refuses to run if the Opus library is empty.

The R2 keys come from 1Password via `op run`, never from a file. One-time setup:

1. Cloudflare dashboard → R2 → Manage API tokens → Create API token with **Object Read & Write** on the `music` bucket.
2. In 1Password, vault **API Keys**, create an item **Cloudflare R2 music** with three fields: `access_key_id`, `secret_access_key`, and `endpoint` (the S3 URL, `https://<account-id>.r2.cloudflarestorage.com`).
