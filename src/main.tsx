#!/usr/bin/env bun
import { createCliRenderer, type KeyEvent } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { useEffect, useRef, useState } from "react"
import { busy, download as runDownload, killAll, listPlaylists, M4A, OPUS_DIR, OUT_DIR, record, type Request } from "./download"
import { PlaylistPicker } from "./picker"
import { C } from "./theme"
import { getAlbum, search, type Album, type AlbumDetail, type Item, type Kind, type Song } from "./ytm"

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

type Job = {
  key: string
  label: string
  sub: string
  status: "queued" | "running" | "done" | "failed"
  pct: number
  step: string
  error?: string
}

/** Truncate/pad to exactly `w` terminal cells. */
function fit(s: string, w: number, right = false) {
  if (w <= 0) return ""
  let out = s
  if (Bun.stringWidth(out) > w) {
    while (out && Bun.stringWidth(out) > w - 1) out = out.slice(0, -1)
    out += "…"
  }
  const pad = " ".repeat(Math.max(0, w - Bun.stringWidth(out)))
  return right ? pad + out : out + pad
}

/** Keep the end of a long string, e.g. a path. */
const tail = (s: string, w: number) => (Bun.stringWidth(s) <= w ? s : "…" + s.slice(-(w - 1)))

function useRefState<T>(init: T) {
  const [value, setValue] = useState(init)
  const ref = useRef(init)
  const set = (v: T) => {
    ref.current = v
    setValue(v)
  }
  return [value, ref, set] as const
}

function bar(pct: number, w: number) {
  const n = Math.round((pct / 100) * w)
  return ["━".repeat(n), "─".repeat(w - n)] as const
}

function App() {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const [kind, setKind] = useState<Kind>("song")
  const [query, setQuery] = useState("")
  const [focus, setFocus] = useState<"input" | "list">("input")
  const [results, setResults] = useState<Item[]>([])
  const [sel, selRef, setSel] = useRefState(0)
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [albumSel, albumSelRef, setAlbumSel] = useRefState(0)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const searchId = useRef(0)
  // `p` opens the playlist picker for this item; the last playlist used is listed first.
  const [picking, setPicking] = useState<Item | null>(null)
  const [lastPlaylist, setLastPlaylist] = useState<string | null>(null)

  const anyRunning = loading !== null || jobs.some((j) => j.status === "running" || j.status === "queued")
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(t)
  }, [anyRunning])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  async function runSearch(q: string, k: Kind) {
    if (!q.trim()) return
    const id = ++searchId.current
    setLoading(`Searching ${k === "song" ? "songs" : "albums"}…`)
    setError(null)
    setAlbum(null)
    try {
      const items = await search(q, k)
      if (id !== searchId.current) return
      setResults(items)
      setSel(0)
      if (items.length) setFocus("list")
    } catch (e) {
      if (id === searchId.current) setError(String((e as Error).message ?? e))
    } finally {
      if (id === searchId.current) setLoading(null)
    }
  }

  async function openAlbum(a: Album) {
    const id = ++searchId.current
    setLoading(`Loading ${a.title}…`)
    setError(null)
    try {
      const detail = await getAlbum(a)
      if (id !== searchId.current) return
      setAlbum(detail)
      setAlbumSel(0)
    } catch (e) {
      if (id === searchId.current) setError(String((e as Error).message ?? e))
    } finally {
      if (id === searchId.current) setLoading(null)
    }
  }

  const patch = (key: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...p } : j)))

  async function download(job: Omit<Job, "status" | "pct" | "step">, request: () => Promise<Request>) {
    const existing = jobs.find((j) => j.key === job.key)
    if (existing && existing.status !== "failed") {
      setNotice(existing.status === "done" ? `Already downloaded: ${job.label}` : `Already queued: ${job.label}`)
      return
    }
    setJobs((js) => [{ ...job, status: "queued", pct: 0, step: "" }, ...js.filter((j) => j.key !== job.key)])
    try {
      const req = await request()
      const saving: Promise<void>[] = []
      const err = await runDownload(req, M4A, {
        onStart: () => patch(job.key, { status: "running" }),
        onLine: (line) => {
          const m = line.match(/^(\S+)\/(\S+)\s+([\d.]+)%/)
          if (!m) return
          // Only whole-album jobs span the playlist; a single album track still reports its position in it.
          const whole = req.source.type === "album" && !req.source.items
          const [i, n] = whole ? [Number(m[1]) || 1, Number(m[2]) || 1] : [1, 1]
          patch(job.key, { pct: ((i - 1 + Number(m[3]) / 100) / n) * 100, step: n > 1 ? `${i}/${n}` : "" })
        },
        onSaved: (saved) => void saving.push(record(saved)),
      })
      await Promise.all(saving)
      patch(job.key, err ? { status: "failed", error: err } : { status: "done", pct: 100 })
    } catch (e) {
      patch(job.key, { status: "failed", error: String((e as Error).message ?? e) })
    }
  }

  const where = (playlist: string | null) => (playlist ? ` → ${playlist}` : "")
  const downloadSong = (s: Song, playlist: string | null = null) => {
    const track = album?.tracks.find((t) => t.id === s.id)
    download(
      { key: `song:${s.id}:${playlist ?? ""}`, label: s.title, sub: s.artist + where(playlist) },
      async () => ({
        playlist,
        // Album tracks come from the album's playlist so they carry album tags and track numbers.
        source: album && track ? { type: "album", playlistUrl: album.playlistUrl, items: [track.index] } : { type: "song", ids: [s.id] },
      }),
    )
  }
  const downloadAlbum = (a: Album, playlist: string | null = null) =>
    download({ key: `album:${a.id}:${playlist ?? ""}`, label: a.title, sub: `${a.artist} · album${where(playlist)}` }, async () => ({
      playlist,
      source: { type: "album", playlistUrl: (album?.id === a.id ? album : await getAlbum(a)).playlistUrl },
    }))
  const downloadItem = (it: Item, playlist: string | null = null) =>
    it.kind === "album" ? downloadAlbum(it, playlist) : downloadSong(it, playlist)

  function quit() {
    killAll()
    renderer.destroy()
    process.exit(0)
  }

  const list: Item[] = album ? album.tracks : results
  const cur = album ? albumSel : sel
  // Read the ref, not render state, so fast key repeats ("jjjd") never act on a stale row.
  const curNow = () => (album ? albumSelRef : selRef).current
  const setCur = (n: number) => (album ? setAlbumSel : setSel)(Math.max(0, Math.min(list.length - 1, n)))

  // Layout math: header 1, search box 3, downloads box, footer 1, list box borders 2 + column header 1.
  const shownJobs = jobs.slice(0, Math.min(5, Math.max(1, Math.floor(height / 8))))
  const jobsH = jobs.length ? shownJobs.length + 2 : 0
  const listRows = Math.max(1, height - 1 - 3 - jobsH - 1 - 3)
  const top = Math.min(Math.max(0, cur - Math.floor(listRows / 2)), Math.max(0, list.length - listRows))
  const rowW = width - 4

  const quitArmed = useRef(false)

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    if (key.ctrl && k === "c") return quit()
    if (picking) return // the picker handles its own keys
    if (k !== "q") quitArmed.current = false

    if (k === "tab") {
      key.preventDefault()
      const next = kind === "song" ? "album" : "song"
      setKind(next)
      runSearch(query, next)
      return
    }

    if (focus === "input") {
      if ((k === "escape" || k === "down") && list.length) {
        key.preventDefault()
        setFocus("list")
      }
      return
    }

    // List focus: vim-ish navigation + actions.
    const item = list[curNow()]
    const half = Math.max(1, Math.floor(listRows / 2))
    if (key.sequence === "/" || k === "i" || k === "s") {
      key.preventDefault()
      setFocus("input")
    } else if (k === "j" || k === "down") setCur(curNow() + 1)
    else if (k === "k" || k === "up") setCur(curNow() - 1)
    else if ((key.ctrl && k === "d") || k === "pagedown") setCur(curNow() + half)
    else if ((key.ctrl && k === "u") || k === "pageup") setCur(curNow() - half)
    else if (k === "g" && !key.shift) setCur(0)
    else if (k === "g" && key.shift) setCur(list.length - 1)
    else if (k === "return" || k === "l" || k === "right") {
      if (item?.kind === "album") openAlbum(item)
      else if (item) downloadSong(item)
    } else if (k === "d" && !key.shift) {
      if (item) downloadItem(item)
    } else if (k === "d" && key.shift) {
      if (album) downloadAlbum(album)
      else if (item?.kind === "album") downloadAlbum(item)
    } else if (k === "p" && !key.shift) {
      if (item) setPicking(item)
    } else if (k === "p" && key.shift) {
      if (album) setPicking(album)
      else if (item?.kind === "album") setPicking(item)
    } else if (k === "escape" || k === "h" || k === "left" || k === "backspace") {
      if (album) {
        searchId.current++
        setAlbum(null)
      } else setFocus("input")
    } else if (k === "c" && !key.shift) setJobs((js) => js.filter((j) => j.status === "running" || j.status === "queued"))
    else if (k === "q") {
      if (busy() && !quitArmed.current) {
        quitArmed.current = true
        setNotice("Downloads still running. Press q again to cancel them and quit.")
      } else quit()
    }
  })

  const jobFor = (it: Item) => jobs.find((j) => j.key.startsWith(`${it.kind}:${it.id}:`))
  const spin = SPIN.charAt(frame % SPIN.length)

  // Column widths for the current list.
  const W = { mark: 2, dur: 6 }
  const flex = rowW - W.mark - W.dur - 3 // 3 = selection bar + two column gaps
  const cols =
    album
      ? { a: 4, b: Math.floor(flex * 0.65) - 4, c: flex - Math.floor(flex * 0.65) }
      : kind === "song"
        ? { a: Math.floor(flex * 0.42), b: Math.floor(flex * 0.29), c: flex - Math.floor(flex * 0.42) - Math.floor(flex * 0.29) }
        : { a: Math.floor(flex * 0.6), b: flex - Math.floor(flex * 0.6), c: 0 }

  function row(it: Item, i: number) {
    const selected = i === cur
    const job = jobFor(it)
    const mark: [string, string] =
      job?.status === "done" ? ["✓", C.green] : job?.status === "failed" ? ["✗", C.red] : job ? [spin, C.yellow] : ["", C.dim]
    const fg = selected ? C.text : C.muted
    const bg = selected ? (focus === "list" ? C.sel : C.panel) : undefined
    let a: string, b: string, c: string, d: string
    if (album && it.kind === "song") {
      const t = it as AlbumDetail["tracks"][number]
      ;[a, b, c, d] = [fit(String(t.index), cols.a - 1, true) + " ", fit(t.title, cols.b), fit(t.artist, cols.c), t.duration]
    } else if (it.kind === "song") [a, b, c, d] = [fit(it.title, cols.a), fit(it.artist, cols.b), fit(it.album, cols.c), it.duration]
    else [a, b, c, d] = [fit(it.title, cols.a), fit(it.artist, cols.b), "", it.year]
    return (
      <text key={`${it.kind}:${it.id}:${i}`} bg={bg} height={1} wrapMode="none">
        <span fg={selected && focus === "list" ? C.accent : C.panel}>{selected ? "▌" : " "}</span>
        <span fg={mark[1]}>{fit(mark[0], W.mark - 1)} </span>
        {album ? <span fg={C.dim}>{a}</span> : <span fg={selected ? C.text : C.muted}>{selected ? <b>{a}</b> : a}</span>}
        <span fg={album ? fg : C.dim}> {album && selected ? <b>{b}</b> : b}</span>
        <span fg={C.dim}> {c}</span>
        <span fg={C.dim}>{fit(d, W.dur, true)}</span>
      </text>
    )
  }

  const listTitle = album
    ? ` ${album.title} · ${album.artist}${album.year ? ` · ${album.year}` : ""} · ${album.tracks.length} tracks `
    : results.length
      ? ` ${results.length} ${kind === "song" ? "songs" : "albums"} `
      : " Results "

  const header = album
    ? ["#", "Title", "Artist", "Time"]
    : kind === "song"
      ? ["Title", "Artist", "Album", "Time"]
      : ["Album", "Artist", "", "Year"]

  const hints: [string, string][] =
    focus === "input"
      ? [["↵", "search"], ["tab", kind === "song" ? "albums" : "songs"], ["esc", "results"], ["ctrl+c", "quit"]]
      : album
        ? [["j/k", "move"], ["↵ d", "track"], ["D", "album"], ["p P", "to playlist"], ["esc", "back"], ["/", "search"], ["q", "quit"]]
        : [
            ["j/k", "move"],
            ...(kind === "song"
              ? ([["↵ d", "download"]] as [string, string][])
              : ([["↵", "open"], ["d", "whole album"]] as [string, string][])),
            ["p", "to playlist"],
            ["tab", kind === "song" ? "albums" : "songs"],
            ["/", "search"],
            ...(jobs.length ? ([["c", "clear done"]] as [string, string][]) : []),
            ["q", "quit"],
          ]

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={C.bg}>
      {/* Header */}
      <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} justifyContent="space-between">
        <text>
          <span fg={C.accent}><b>♪ ytm-dl</b></span>
          <span fg={C.dim}>  </span>
          <span fg={kind === "song" ? C.bg : C.muted} bg={kind === "song" ? C.accent : undefined}> Songs </span>
          <span fg={C.dim}> </span>
          <span fg={kind === "album" ? C.bg : C.muted} bg={kind === "album" ? C.accent : undefined}> Albums </span>
        </text>
        <text fg={C.dim}>{"→ " + tail(OUT_DIR.replace(process.env.HOME ?? "", "~"), Math.max(0, width - 32))}</text>
      </box>

      {/* Search */}
      <box
        height={3}
        border
        borderStyle="rounded"
        borderColor={focus === "input" ? C.focus : C.border}
        title={` Search ${kind === "song" ? "songs" : "albums"} `}
        titleColor={focus === "input" ? C.focus : C.dim}
        paddingLeft={1}
        backgroundColor={C.panel}
      >
        <input
          focused={focus === "input"}
          placeholder="Artist, song or album…  (tab switches songs / albums)"
          placeholderColor={C.dim}
          textColor={C.text}
          focusedTextColor={C.text}
          backgroundColor={C.panel}
          focusedBackgroundColor={C.panel}
          onInput={setQuery}
          onSubmit={() => runSearch(query, kind)}
        />
      </box>

      {/* Results / album tracks */}
      <box
        flexGrow={1}
        border
        borderStyle="rounded"
        borderColor={focus === "list" ? C.focus : C.border}
        title={listTitle}
        titleColor={focus === "list" ? C.focus : C.dim}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={C.panel}
        flexDirection="column"
      >
        {loading ? (
          <text fg={C.accent}>{`${spin} ${loading}`}</text>
        ) : error ? (
          <text fg={C.red}>{`✗ ${error}`}</text>
        ) : list.length === 0 ? (
          <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
            <text fg={C.muted}>{query ? "No results." : "Search YouTube Music for songs or albums."}</text>
            <text fg={C.dim}>Type a query, press ↵. tab switches between songs and albums.</text>
          </box>
        ) : (
          <>
            <text fg={C.dim} height={1} wrapMode="none">
              {"   " +
                (album ? fit(header[0]!, cols.a - 1, true) + " " : fit(header[0]!, cols.a)) +
                " " + fit(header[1]!, album ? cols.b : cols.b) +
                " " + fit(header[2]!, cols.c) +
                fit(header[3]!, W.dur, true)}
            </text>
            {list.slice(top, top + listRows).map((it, i) => row(it, top + i))}
          </>
        )}
      </box>

      {/* Downloads */}
      {jobs.length > 0 && (
        <box
          height={jobsH}
          border
          borderStyle="rounded"
          borderColor={C.border}
          title={` Downloads · ${jobs.filter((j) => j.status === "done").length}/${jobs.length} done `}
          titleColor={C.dim}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={C.panel}
          flexDirection="column"
        >
          {shownJobs.map((j) => {
            const barW = Math.min(24, Math.max(8, Math.floor(rowW / 5)))
            const [filled, empty] = bar(j.pct, barW)
            const icon = j.status === "done" ? "✓" : j.status === "failed" ? "✗" : j.status === "queued" ? "·" : spin
            const color = j.status === "done" ? C.green : j.status === "failed" ? C.red : C.yellow
            const tail =
              j.status === "failed"
                ? (j.error ?? "failed")
                : j.status === "queued"
                  ? "queued"
                  : j.status === "done"
                    ? "done"
                    : `${Math.floor(j.pct)}%${j.step ? `  ${j.step}` : ""}`
            const labelW = Math.max(10, rowW - barW - 4 - 16)
            return (
              <text key={j.key} height={1} wrapMode="none">
                <span fg={color}>{icon} </span>
                <span fg={C.text}>{fit(j.label, Math.floor(labelW * 0.55))}</span>
                <span fg={C.dim}> {fit(j.sub, Math.ceil(labelW * 0.45) - 1)} </span>
                {j.status === "failed" ? (
                  <span fg={C.red}>{fit(tail, barW + 16)}</span>
                ) : (
                  <>
                    <span fg={j.status === "done" ? C.green : C.accent}>{filled}</span>
                    <span fg={C.border}>{empty}</span>
                    <span fg={C.muted}> {fit(tail, 14)}</span>
                  </>
                )}
              </text>
            )
          })}
        </box>
      )}

      {picking && (
        <PlaylistPicker
          label={picking.title}
          playlists={(() => {
            const all = listPlaylists()
            return lastPlaylist && all.includes(lastPlaylist) ? [lastPlaylist, ...all.filter((p) => p !== lastPlaylist)] : all
          })()}
          width={width}
          height={height}
          onCancel={() => setPicking(null)}
          onPick={(playlist) => {
            setPicking(null)
            setLastPlaylist(playlist)
            mkdirSync(join(OUT_DIR, playlist), { recursive: true }) // so it's listed right away
            downloadItem(picking, playlist)
          }}
        />
      )}

      {/* Footer: notice or key hints */}
      <box height={1} paddingLeft={1}>
        {notice ? (
          <text fg={C.yellow}>{notice}</text>
        ) : (
          <text>
            {hints.map(([key, label], i) => (
              <span key={i}>
                <span fg={C.accent}>{key}</span>
                <span fg={C.dim}>{` ${label}  `}</span>
              </span>
            ))}
          </text>
        )}
      </box>
    </box>
  )
}

const cmd = process.argv[2]
if (cmd === "opus") {
  const { buildOpus } = await import("./opus")
  process.exit((await buildOpus(process.argv[3] ?? OPUS_DIR)) ? 1 : 0)
} else if (cmd === "sync") {
  const { sync } = await import("./sync")
  process.exit(await sync())
} else {
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  createRoot(renderer).render(<App />)
}
