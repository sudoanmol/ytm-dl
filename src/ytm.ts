import { Innertube, YTNodes } from "youtubei.js"

export type Kind = "song" | "album"
export type Song = { kind: "song"; id: string; title: string; artist: string; album: string; duration: string }
export type Album = { kind: "album"; id: string; title: string; artist: string; year: string }
export type Item = Song | Album
export type AlbumDetail = Album & { playlistUrl: string; tracks: (Song & { index: number })[] }

const yt = Innertube.create({ retrieve_player: false })

export async function search(query: string, kind: Kind): Promise<Item[]> {
  const res = await (await yt).music.search(query, { type: kind })
  const items = res.contents?.firstOfType(YTNodes.MusicShelf)?.contents ?? []
  return items.flatMap((it): Item[] => {
    if (!it.id || !it.title) return []
    if (kind === "album")
      return [{ kind, id: it.id, title: it.title, artist: it.author?.name ?? "", year: it.year ?? "" }]
    return [{
      kind,
      id: it.id,
      title: it.title,
      artist: it.artists?.map((a) => a.name).join(", ") ?? "",
      album: it.album?.name ?? "",
      duration: it.duration?.text ?? "",
    }]
  })
}

export async function getAlbum(album: Album): Promise<AlbumDetail> {
  const res = await (await yt).music.getAlbum(album.id)
  if (!res.url) throw new Error(`No playlist for album ${album.title}`)
  return {
    ...album,
    playlistUrl: res.url,
    tracks: res.contents.flatMap((t, i) =>
      t.id && t.title
        ? [{
            kind: "song" as const,
            id: t.id,
            title: t.title,
            artist: t.artists?.map((a) => a.name).join(", ") || album.artist,
            album: album.title,
            duration: t.duration?.text ?? "",
            index: Number(t.index?.toString()) || i + 1,
          }]
        : [],
    ),
  }
}
