# Mood videos

Drop `.mp4` files in this folder. They're served at `/moods/<file>` on the
display and composited over the scene background with `mix-blend-mode: screen`,
which means **pure black is treated as transparent** while bright/light
content shows through.

## Filenames the v1 catalog expects

| File           | Used for                                    |
|----------------|---------------------------------------------|
| `clouds.mp4`   | day, sunny, partlycloudy, cloudy weather    |
| `rain.mp4`     | rainy / pouring weather                     |
| `snow.mp4`     | snowy weather                               |
| `stars.mp4`    | night, clear-night                          |
| `sunrise.mp4`  | within ±45min of sunrise                    |
| `embers.mp4`   | within ±45min of sunset                     |

The mapping lives in `server/src/moods/catalog.ts` — add new ids there if
you want to extend the library.

## Format guidelines

- Container: `.mp4` (H.264 + AAC, but no audio is needed — strip it).
- **Background must be pure black (`#000000`).** The display uses
  `mix-blend-mode: screen`, so anything black drops out and any color above
  black brightens the layer underneath.
- Resolution: ≤1920x1080. Higher just wastes Pi GPU memory.
- Length: ≥10 seconds. Loop seamlessly — first frame should match the last.
  The video element loops with `loop` attribute, so a hard cut between end
  and start will be visible.
- File size: target ≤10 MB per clip. These get baked into the add-on Docker
  image, so they directly affect install size for HA users.
- No audio. The `<video>` element is muted, but stripping audio shrinks
  the file.

## Tip

If you have a clip with a non-black background (e.g. blue sky), a quick fix
is to adjust the curves so the darkest tone is pure black, then re-encode.
ffmpeg one-liner for a darken pass:

```sh
ffmpeg -i input.mp4 -vf "eq=brightness=-0.05:contrast=1.2" -c:a copy output.mp4
```
