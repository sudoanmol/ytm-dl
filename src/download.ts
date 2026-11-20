import { homedir } from "node:os"
import { join } from "node:path"
import type { AlbumDetail, Song } from "./ytm"

export const OUT_DIR = process.env.YTM_DL_DIR ?? join(homedir(), "Music", "ytm-dl")

// Best stream YouTube offers (usually Opus ~160k, format 251). -x without --audio-format
// keeps the source codec, so audio is remuxed, never re-encoded.
// Thumbnail gets cropped to a square so it works as cover art.
const COMMON = [
  "-f", "bestaudio",
  "-x",
  "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
  "--parse-metadata", "release_year:(?P<meta_date>\\d+)", // release year, not upload date
  "--ppa", `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`,
  "--no-warnings", "--newline", "--quiet", "--progress",
  "--progress-template", "download:%(info.playlist_index|1)s/%(info.n_entries|1)s %(progress._percent_str)s",
  "-P", OUT_DIR,
]

// A literal path segment inside a yt-dlp output template.
const literal = (s: string) => (s.trim() || "Unknown").replaceAll("/", "_").replaceAll("%", "%%")

export const songArgs = (s: Song) => [
  ...COMMON,
  "-o", "%(artists.0|Unknown Artist)s/%(album|Singles)s/%(title)s.%(ext)s",
  `https://music.youtube.com/watch?v=${s.id}`,
]

/** Whole album, or just one track of it (by playlist position) so the file and tags match a full-album download. */
export const albumArgs = (a: AlbumDetail, track?: number) => [
  ...COMMON,
  ...(track ? ["--playlist-items", String(track)] : []),
  "--parse-metadata", "playlist_index:%(track_number)s",
  "-o", `${literal(a.artist)}/${literal(a.title)}/%(playlist_index)02d %(title)s.%(ext)s`,
  a.playlistUrl,
]

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

/** Queues yt-dlp, reporting each progress/error line. Resolves with the last error line, or null on success. */
export async function runYtDlp(args: string[], onStart: () => void, onLine: (line: string) => void): Promise<string | null> {
  await acquire()
  try {
    onStart()
    return await spawn(args, onLine)
  } finally {
    release()
  }
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
