import type { KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"
import { cleanPlaylistName } from "./download"
import { C } from "./theme"

type Props = {
  /** What is being added, shown in the title. */
  label: string
  /** Existing playlists, most relevant first. */
  playlists: string[]
  width: number
  height: number
  onPick: (playlist: string) => void
  onCancel: () => void
}

/** Command-palette style picker: type to filter, or type a new name to create a playlist. */
export function PlaylistPicker({ label, playlists, width, height, onPick, onCancel }: Props) {
  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  const move = (n: number) => {
    selRef.current = Math.max(0, Math.min(rows.length - 1, n))
    setSel(selRef.current)
  }

  const name = cleanPlaylistName(filter)
  const matches = playlists.filter((p) => p.toLowerCase().includes(filter.trim().toLowerCase()))
  const isNew = name !== "" && !playlists.some((p) => p.toLowerCase() === name.toLowerCase())
  const rows = [...(isNew ? [{ name, isNew: true }] : []), ...matches.map((p) => ({ name: p, isNew: false }))]

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    if (k === "escape") onCancel()
    else if (k === "down" || (key.ctrl && (k === "n" || k === "j"))) move(selRef.current + 1)
    else if (k === "up" || (key.ctrl && (k === "p" || k === "k"))) move(selRef.current - 1)
    else if (k === "return") {
      const row = rows[selRef.current]
      if (row) onPick(row.name)
    } else return
    key.preventDefault()
  })

  const w = Math.min(60, width - 4)
  const listH = Math.max(1, Math.min(rows.length || 1, height - 10))
  const top = Math.max(0, Math.min(sel - listH + 1, rows.length - listH))
  return (
    <box
      position="absolute"
      left={Math.floor((width - w) / 2)}
      top={Math.max(1, Math.floor((height - listH - 6) / 3))}
      width={w}
      height={listH + 6}
      zIndex={10}
      border
      borderStyle="rounded"
      borderColor={C.accent}
      title={` Add to playlist: ${label.length > w - 24 ? label.slice(0, w - 25) + "…" : label} `}
      titleColor={C.accent}
      backgroundColor={C.panel}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <box height={1} flexDirection="row">
        <text fg={C.accent}>{"› "}</text>
        <input
          focused
          placeholder={playlists.length ? "Filter, or type a new name" : "Name your first playlist"}
          placeholderColor={C.dim}
          textColor={C.text}
          focusedTextColor={C.text}
          backgroundColor={C.panel}
          focusedBackgroundColor={C.panel}
          flexGrow={1}
          onInput={(v: string) => {
            setFilter(v)
            selRef.current = 0
            setSel(0)
          }}
        />
      </box>
      <text fg={C.border} height={1} wrapMode="none">{"─".repeat(w - 4)}</text>
      <box flexDirection="column" height={listH}>
        {rows.length === 0 ? (
          <text fg={C.dim}>No playlists yet. Type a name.</text>
        ) : (
          rows.slice(top, top + listH).map((r, i) => {
            const selected = top + i === sel
            return (
              <text key={(r.isNew ? "+" : "") + r.name} height={1} wrapMode="none" bg={selected ? C.sel : undefined}>
                <span fg={selected ? C.accent : C.panel}>{selected ? "▌" : " "}</span>
                {r.isNew ? (
                  <>
                    <span fg={C.green}> + New playlist </span>
                    <span fg={C.text}>{`“${r.name}”`}</span>
                  </>
                ) : (
                  <span fg={selected ? C.text : C.muted}>{` ${r.name}`}</span>
                )}
              </text>
            )
          })
        )}
      </box>
      <text fg={C.border} height={1} wrapMode="none">{"─".repeat(w - 4)}</text>
      <text height={1} wrapMode="none">
        <span fg={C.accent}>↵</span>
        <span fg={C.dim}> add  </span>
        <span fg={C.accent}>↑↓</span>
        <span fg={C.dim}> move  </span>
        <span fg={C.accent}>esc</span>
        <span fg={C.dim}> cancel</span>
      </text>
    </box>
  )
}
