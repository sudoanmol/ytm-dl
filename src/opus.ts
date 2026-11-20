// `ytm-dl opus [dir]`: mirror the m4a library as Opus (YouTube's best free stream) in a separate
// folder, with the same names and playlist folders. Only fetches what's missing; safe to re-run.
import { existsSync } from "node:fs"
import { mkdir, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { download, MANIFEST, readManifest, type Request, type Saved } from "./download"

/** Returns how many songs are missing after the run (0 = library complete). */
export async function buildOpus(dir: string): Promise<number> {
  const history = await readManifest()
  if (!history.length) {
    console.log(`Nothing to do: no downloads recorded in ${MANIFEST}`)
    return 0
  }
  const latest = new Map<string, Saved>()
  for (const s of history) latest.set(s.id, s)
  const path = (file: string) => join(dir, file + ".opus")

  // A song moved to another playlist since the last run: move its opus file too.
  for (const old of history) {
    const now = latest.get(old.id)!
    if (old.file === now.file || !existsSync(path(old.file))) continue
    if (existsSync(path(now.file))) await unlink(path(old.file))
    else {
      await mkdir(dirname(path(now.file)), { recursive: true })
      await rename(path(old.file), path(now.file))
      console.log(`→ moved ${now.file}`)
    }
  }

  const missing = [...latest.values()].filter((s) => !existsSync(path(s.file)))
  console.log(`${latest.size} songs in library, ${missing.length} to fetch as Opus into ${dir}\n`)
  if (!missing.length) return 0

  // One yt-dlp run per album (tracks via --playlist-items) and one for loose songs, per playlist folder.
  const groups = new Map<string, Request>()
  for (const s of missing) {
    const key = `${s.playlist ?? ""}\0${s.source.type === "album" ? s.source.playlistUrl : ""}`
    const src = s.source
    const g =
      groups.get(key) ??
      groups
        .set(key, {
          playlist: s.playlist,
          source: src.type === "album" ? { type: "album", playlistUrl: src.playlistUrl, items: [] } : { type: "song", ids: [] },
        })
        .get(key)!
    if (g.source.type === "album" && src.type === "album") g.source.items!.push(src.index)
    if (g.source.type === "song" && src.type === "song") g.source.ids.push(src.id)
  }

  const fetched = new Set<string>()
  const errors: string[] = []
  await Promise.all(
    [...groups.values()].map(async (req) => {
      const err = await download(req, { format: "opus", dir }, {
        onSaved: (s) => {
          fetched.add(s.id)
          console.log(`✓ [${fetched.size}/${missing.length}] ${s.file}`)
        },
      }).catch((e) => String(e))
      if (err) errors.push(err)
    }),
  )
  const failed = missing.filter((s) => !fetched.has(s.id))
  console.log(`\n${fetched.size} fetched, ${failed.length} failed.`)
  for (const f of failed) console.log(`  ✗ ${f.file}`)
  if (failed.length) console.log(`Last error: ${errors.at(-1) ?? "unknown"}\nRe-run to retry; YouTube errors like HTTP 403 are usually temporary.`)
  return failed.length
}
