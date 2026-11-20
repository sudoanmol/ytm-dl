// `ytm-dl opus [dir]`: re-download everything the TUI ever downloaded as Opus (YouTube's best free
// stream) into a separate library. Safe to re-run: files that already exist are skipped.
import { download, MANIFEST, OPUS_DIR, readManifest, type Entry } from "./download"

const dir = process.argv[3] ?? OPUS_DIR
const entries = await readManifest()
if (!entries.length) {
  console.log(`Nothing to do: no downloads recorded in ${MANIFEST}`)
  process.exit(0)
}

const name = (e: Entry) =>
  e.type === "song"
    ? `${e.song.title} — ${e.song.artist}`
    : `${e.album.title}${e.track ? ` #${e.track}` : " (album)"} — ${e.album.artist}`

console.log(`Downloading ${entries.length} items as Opus into ${dir}\n`)
let finished = 0
const failed: string[] = []
await Promise.all(
  entries.map(async (e) => {
    const err = await download(e, { format: "opus", dir }, () => {}, () => {}).catch((x) => String(x))
    finished++
    if (err) failed.push(`${name(e)}: ${err}`)
    console.log(`${err ? "✗" : "✓"} [${finished}/${entries.length}] ${name(e)}`)
  }),
)
console.log(`\n${entries.length - failed.length} done, ${failed.length} failed.`)
for (const f of failed) console.log(`  ✗ ${f}`)
process.exit(failed.length ? 1 : 0)
