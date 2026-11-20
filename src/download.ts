import { homedir } from "node:os"
import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { AlbumDetail, Song } from "./ytm"

export const OUT_DIR = process.env.YTM_DL_DIR ?? join(homedir(), "Music", "ytm-dl")
export const OPUS_DIR = join(homedir(), "Music", "ytm-dl-opus")
/** Every finished download, one JSON entry per line, so the library can be rebuilt in another format. */
export const MANIFEST = join(OUT_DIR, ".ytm-dl.jsonl")

/** What was downloaded: a search-result song, a whole album, or one track of an album. */
export type Entry =
  | { type: "song"; song: Song }
  | { type: "album"; album: AlbumRef; track?: number }
type AlbumRef = Pick<AlbumDetail, "id" | "title" | "artist" | "playlistUrl">
export type Target = { format: "m4a" | "opus"; dir: string }
export const DEFAULT_TARGET: Target = { format: "m4a", dir: OUT_DIR }

// m4a: YouTube's AAC stream (~128k, format 140), plays everywhere incl. iOS.
// opus: YouTube's best stream (~160k, format 251).
// Either way the matching source stream is remuxed, not re-encoded, and an explicit
// --audio-format lets yt-dlp skip files that already exist.
const FORMAT = {
  m4a: ["-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a"],
  opus: ["-f", "bestaudio[acodec=opus]/bestaudio", "-x", "--audio-format", "opus"],
}

const common = (t: Target) => [
  ...FORMAT[t.format],
  // Thumbnail gets cropped to a square so it works as cover art.
  "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
  "--ppa", `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`,
  "--parse-metadata", "release_year:(?P<meta_date>\\d+)", // release year, not upload date
  "--no-warnings", "--newline", "--quiet", "--progress",
  "--progress-template", "download:%(info.playlist_index|1)s/%(info.n_entries|1)s %(progress._percent_str)s",
  "-P", t.dir,
  // The opus library is rebuilt by re-running a command: an archive of finished track IDs makes
  // re-runs skip them entirely (yt-dlp otherwise re-tags existing files, which fails on .opus with cover art).
  ...(t.format === "opus" ? ["--download-archive", join(t.dir, ".ytm-dl-archive.txt")] : []),
]

// A literal path segment inside a yt-dlp output template.
const literal = (s: string) => (s.trim() || "Unknown").replaceAll("/", "_").replaceAll("%", "%%")

function argsFor(e: Entry, t: Target): string[] {
  if (e.type === "song")
    return [
      ...common(t),
      "-o", "%(artists.0|Unknown Artist)s/%(album|Singles)s/%(title)s.%(ext)s",
      `https://music.youtube.com/watch?v=${e.song.id}`,
    ]
  // A single album track is fetched by playlist position, so its file and tags match a full-album download.
  return [
    ...common(t),
    ...(e.track ? ["--playlist-items", String(e.track)] : []),
    "--parse-metadata", "playlist_index:%(track_number)s",
    "-o", `${literal(e.album.artist)}/${literal(e.album.title)}/%(playlist_index)02d %(title)s.%(ext)s`,
    e.album.playlistUrl,
  ]
}

export const albumRef = ({ id, title, artist, playlistUrl }: AlbumDetail): AlbumRef => ({ id, title, artist, playlistUrl })

export async function record(e: Entry) {
  await mkdir(OUT_DIR, { recursive: true })
  await appendFile(MANIFEST, JSON.stringify(e) + "\n")
}

export async function readManifest(): Promise<Entry[]> {
  const file = Bun.file(MANIFEST)
  if (!(await file.exists())) return []
  const lines = (await file.text()).split("\n").filter(Boolean)
  return [...new Set(lines)].map((l) => JSON.parse(l) as Entry)
}

const MAX_PARALLEL = 3
const running = new Set<Bun.Subprocess>()
const waiting: (() => void)[] = []
let slots = 0
async function acquire() {
  if (slots < MAX_PARALLEL) slots++
  else await new Promise<void>((r) => waiting.push(r)) // slot is handed over by release()
}
function release() {
  const next = waiting.shift()
  if (next) next()
  else slots--
}

export const busy = () => slots > 0
export const killAll = () => running.forEach((p) => p.kill())

// Jobs touching the same album (a track plus the whole album) would write the same files at once,
// so they run one after another.
const tails = new Map<string, Promise<unknown>>()

/** Queues a download, reporting each progress/error line. Resolves with the last error line, or null on success. */
export function download(e: Entry, t: Target, onStart: () => void, onLine: (line: string) => void): Promise<string | null> {
  const key = e.type === "album" ? `album:${e.album.id}` : `song:${e.song.id}`
  const job = async () => {
    await acquire()
    try {
      onStart()
      return await spawn(argsFor(e, t), onLine)
    } finally {
      release()
    }
  }
  const run = (tails.get(key) ?? Promise.resolve()).then(job)
  tails.set(key, run.catch(() => {}))
  return run
}

async function spawn(args: string[], onLine: (line: string) => void): Promise<string | null> {
  const proc = Bun.spawn(["yt-dlp", ...args], { stdout: "pipe", stderr: "pipe" })
  running.add(proc)
  let lastErr = ""
  const pump = async (stream: ReadableStream<Uint8Array>, isErr: boolean) => {
    let buf = ""
    const dec = new TextDecoder()
    for await (const chunk of stream) {
      buf += dec.decode(chunk, { stream: true })
      const lines = buf.split(/\r?\n|\r/)
      buf = lines.pop() ?? ""
      for (const l of lines.map((l) => l.trim()).filter(Boolean)) {
        if (isErr) lastErr = l
        onLine(l)
      }
    }
  }
  await Promise.all([pump(proc.stdout, false), pump(proc.stderr, true), proc.exited])
  running.delete(proc)
  return proc.exitCode === 0 ? null : lastErr || `yt-dlp exited with ${proc.exitCode}`
}
