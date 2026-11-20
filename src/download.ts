import { existsSync, readdirSync } from "node:fs"
import { appendFile, mkdir, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { extname, join, relative } from "node:path"

// Library layout: one flat folder of "Artist - Title.ext"; a playlist is a subfolder.
// A song lives in exactly one place: the main folder or one playlist.
export const OUT_DIR = process.env.YTM_DL_DIR ?? join(homedir(), "Music", "ytm-dl")
export const OPUS_DIR = process.env.YTM_DL_OPUS_DIR ?? join(homedir(), "Music", "ytm-dl-opus")
/** Every saved file, one JSON line each, newest last. Lets the library be rebuilt in another format. */
export const MANIFEST = join(OUT_DIR, ".ytm-dl.jsonl")

/** What to fetch: song IDs, or (some tracks of) an album's playlist. */
export type Source = { type: "song"; ids: string[] } | { type: "album"; playlistUrl: string; items?: number[] }
export type Request = { source: Source; playlist: string | null }
/** One saved file. `file` is relative to the library, without extension. */
export type Saved = {
  id: string
  file: string
  playlist: string | null
  source: { type: "song"; id: string } | { type: "album"; playlistUrl: string; index: number }
}
export type Target = { format: "m4a" | "opus"; dir: string }
export const M4A: Target = { format: "m4a", dir: OUT_DIR }

// m4a: YouTube's AAC stream (~128k, format 140), plays everywhere incl. iOS.
// opus: YouTube's best stream (~160k, format 251).
// Either way the matching source stream is remuxed, not re-encoded.
const FORMAT = {
  m4a: ["-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a"],
  opus: ["-f", "bestaudio[acodec=opus]/bestaudio", "-x", "--audio-format", "opus"],
}

// A literal path segment inside a yt-dlp output template.
const literal = (s: string) => s.replaceAll("/", "_").replaceAll("%", "%%")
/** Playlist names become folder names. */
export const cleanPlaylistName = (s: string) => s.trim().replace(/[/\\:]/g, "-").replace(/^\.+/, "")

function argsFor({ source, playlist }: Request, t: Target): string[] {
  const album = source.type === "album"
  return [
    ...FORMAT[t.format],
    // Thumbnail gets cropped to a square so it works as cover art.
    "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
    "--ppa", `ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -vf crop="'if(gt(ih,iw),iw,ih)':'if(gt(iw,ih),ih,iw)'"`,
    "--parse-metadata", "release_year:(?P<meta_date>\\d+)", // release year, not upload date
    ...(album ? ["--parse-metadata", "playlist_index:%(track_number)s"] : []),
    ...(album && source.items ? ["--playlist-items", source.items.join(",")] : []),
    "--no-warnings", "--newline", "--quiet", "--progress",
    "--progress-template", "download:%(info.playlist_index|1)s/%(info.n_entries|1)s %(progress._percent_str)s",
    "--print", "after_move:SAVED\t%(id)s\t%(playlist_index|)s\t%(filepath)s",
    "-P", t.dir,
    "-o", `${playlist ? literal(playlist) + "/" : ""}%(artists.0,artist|Unknown Artist)s - %(title)s.%(ext)s`,
    ...(album ? [source.playlistUrl] : source.ids.map((id) => `https://music.youtube.com/watch?v=${id}`)),
  ]
}

export function listPlaylists(): string[] {
  if (!existsSync(OUT_DIR)) return []
  return readdirSync(OUT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
}

export async function readManifest(): Promise<Saved[]> {
  const file = Bun.file(MANIFEST)
  if (!(await file.exists())) return []
  return (await file.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Saved)
}

/** Logs a saved m4a file and deletes its previous copy, so a song moved to a playlist isn't kept twice. */
export async function record(s: Saved) {
  const previous = (await readManifest()).findLast((p) => p.id === s.id)
  if (previous && previous.file !== s.file) await unlink(join(OUT_DIR, previous.file + ".m4a")).catch(() => {})
  await mkdir(OUT_DIR, { recursive: true })
  await appendFile(MANIFEST, JSON.stringify(s) + "\n")
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

type Callbacks = { onStart?: () => void; onLine?: (line: string) => void; onSaved?: (s: Saved) => void }

/** Queues a download. Resolves with the last error line, or null on success. */
export function download(req: Request, t: Target, cb: Callbacks = {}): Promise<string | null> {
  const { source } = req
  const key = source.type === "album" ? source.playlistUrl : source.ids.join()
  const job = async () => {
    await acquire()
    try {
      cb.onStart?.()
      return await spawn(argsFor(req, t), (line) => {
        if (!line.startsWith("SAVED\t")) return cb.onLine?.(line)
        const [, id = "", index, path = ""] = line.split("\t")
        cb.onSaved?.({
          id,
          file: relative(t.dir, path).slice(0, -extname(path).length),
          playlist: req.playlist,
          source:
            source.type === "album" ? { type: "album", playlistUrl: source.playlistUrl, index: Number(index) } : { type: "song", id },
        })
      })
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
