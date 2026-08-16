# MangaStudio 60-Second Promo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible 58–62 second, 1920×1080 H.264 promotional video for AI motion-comic creators using the repository's real MangaStudio screens, Chinese narration, burned-in subtitles, music, and an open-source call to action.

**Architecture:** Keep the production pipeline isolated under `promo/`. A JSON manifest is the single source of truth for timing, narration, captions, and source images; a Python asset builder creates branded title cards and subtitle files; a shell renderer turns still UI screens into motion clips and composes them with FFmpeg; a Python validator checks the final media contract. Generated files live under `promo/build/` and `promo/output/` and are excluded from Git.

**Tech Stack:** Python 3 standard library + Pillow, FFmpeg/ffprobe 8.x, macOS `say`, Bash, existing PNG/SVG assets.

---

## File Structure

- Create `promo/manifest.json`: exact scene timings, narration, captions, screenshot source, crop focus, and transition metadata.
- Create `promo/scripts/build_assets.py`: validate the manifest, render branded cards, generate SRT captions, and write narration text chunks.
- Create `promo/scripts/render.sh`: synthesize narration, normalize audio, animate UI images, compose scenes, mix music/bed, and export MP4.
- Create `promo/scripts/validate_output.py`: assert duration, resolution, codecs, frame rate, audio presence, and file integrity.
- Create `promo/tests/test_build_assets.py`: unit tests for timeline coverage, SRT timestamps, missing assets, and card generation.
- Create `promo/assets/README.md`: document optional licensed music placement and fallback behavior.
- Create `promo/output/.gitkeep`: retain the output directory without committing generated media.
- Modify `.gitignore`: ignore `promo/build/` and rendered files under `promo/output/` except `.gitkeep`.
- Modify `package.json`: add `promo:build` and `promo:validate` convenience commands.

### Task 1: Lock the Timeline Manifest

**Files:**
- Create: `promo/manifest.json`
- Test: `promo/tests/test_build_assets.py`

- [ ] **Step 1: Write failing manifest tests**

Create `promo/tests/test_build_assets.py` with tests that load `promo/manifest.json` and assert:

```python
def test_timeline_is_contiguous_and_sixty_seconds():
    scenes = load_manifest()["scenes"]
    assert scenes[0]["start"] == 0
    assert scenes[-1]["end"] == 60
    assert all(a["end"] == b["start"] for a, b in zip(scenes, scenes[1:]))

def test_every_real_ui_asset_exists():
    root = Path(__file__).resolve().parents[2]
    for scene in load_manifest()["scenes"]:
        if "source" in scene:
            assert (root / scene["source"]).is_file()
```

- [ ] **Step 2: Run tests and verify failure**

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: FAIL because `promo/manifest.json` and its loader do not exist.

- [ ] **Step 3: Create the exact 60-second manifest**

Define seven contiguous scenes: `hook` 0–4, `reveal` 4–8, `script` 8–17, `assets` 17–27, `director` 27–40, `export` 40–49, `summary` 49–55, and `cta` 55–60. Use these real sources where applicable:

```json
{
  "id": "director",
  "start": 27,
  "end": 40,
  "source": "images/导演工作台.png",
  "alternate": "images/镜头与帧.png",
  "caption": "关键帧驱动 · 镜头级控制",
  "narration": "先定关键帧，再选择运镜，让每一个镜头按计划动起来。",
  "motion": "push-in"
}
```

The complete narration must use the approved wording from the design document and must not state that all 16 shots are complete.

- [ ] **Step 4: Add a minimal manifest loader and run tests**

Add `load_manifest()` to the test file using `json.loads(Path(...).read_text())`, then run:

`rtk python -m unittest discover -s promo/tests -v`

Expected: PASS for timing and file existence tests.

- [ ] **Step 5: Commit the manifest**

```bash
rtk git add promo/manifest.json promo/tests/test_build_assets.py
rtk git commit -m "feat(promo): define 60-second video timeline"
```

### Task 2: Build Branded Cards, Captions, and Narration Inputs

**Files:**
- Create: `promo/scripts/build_assets.py`
- Modify: `promo/tests/test_build_assets.py`
- Create: `promo/assets/README.md`

- [ ] **Step 1: Add failing tests for generated assets**

Add tests that call `build_assets.build(manifest_path, output_dir)` in a temporary directory and assert:

```python
assert (out / "hook.png").is_file()
assert (out / "reveal.png").is_file()
assert (out / "cta.png").is_file()
assert (out / "captions.srt").read_text().count("--> ") == 8
assert (out / "narration.txt").read_text().startswith("现在，一个网站就够了。")
```

Also assert all cards are `(1920, 1080)` RGB images.

- [ ] **Step 2: Run tests and verify failure**

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: FAIL with `ModuleNotFoundError` for `build_assets`.

- [ ] **Step 3: Implement the asset builder**

Implement:

```python
def srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

def build(manifest_path: Path, output_dir: Path) -> None:
    # Validate contiguous timing and source paths.
    # Render hook/reveal/cta cards with PingFang or STHeiti fallback.
    # Write one SRT cue per scene and narration.txt without the silent hook line.
```

Cards must use a dark navy background, cyan-to-purple accents, `public/logo.svg` rendered through FFmpeg or a PNG conversion step, and mobile-safe centered text. `promo/assets/README.md` must specify `promo/assets/music.mp3` as the optional licensed track and state that the renderer creates a subtle synthesized bed when it is absent.

- [ ] **Step 4: Run tests**

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit asset generation**

```bash
rtk git add promo/scripts/build_assets.py promo/tests/test_build_assets.py promo/assets/README.md
rtk git commit -m "feat(promo): generate branded cards and captions"
```

### Task 3: Implement the Reproducible FFmpeg Renderer

**Files:**
- Create: `promo/scripts/render.sh`
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `promo/output/.gitkeep`

- [ ] **Step 1: Add a dry-run contract test**

Add a unittest that invokes `bash promo/scripts/render.sh --dry-run` and asserts stdout contains all stage IDs, `libx264`, `captions.srt`, and `promo/output/mangastudio-60s-promo.mp4`.

- [ ] **Step 2: Run tests and verify failure**

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: FAIL because `render.sh` does not exist.

- [ ] **Step 3: Implement rendering stages**

The script must:

```bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BUILD="$ROOT/promo/build"
OUTPUT="$ROOT/promo/output/mangastudio-60s-promo.mp4"
```

Then it must perform these explicit operations:

1. Run `build_assets.py`.
2. Use `/usr/bin/say -v Tingting -r 205 -f narration.txt -o narration.aiff`, falling back to the default Chinese voice if Tingting is unavailable.
3. Normalize narration to `-16 LUFS` using `loudnorm`.
4. Animate each source image with scale/crop plus `zoompan` at 30 fps; use crossfades no longer than 0.25 seconds inside each fixed scene duration.
5. Use `promo/assets/music.mp3` when present; otherwise generate a low-volume tonal bed with FFmpeg `sine` sources.
6. Burn `captions.srt` using `/System/Library/Fonts/STHeiti Light.ttc`, white text, cyan highlighted title cards, translucent dark subtitle box, and safe margins.
7. Encode with `libx264 -profile:v high -pix_fmt yuv420p -r 30`, AAC stereo audio, and `-movflags +faststart`.
8. Produce the exact output path above and retain `/tmp`-free intermediates only under ignored `promo/build/`.

The `--dry-run` path prints the resolved timeline and commands without generating media.

- [ ] **Step 4: Add convenience commands and ignore rules**

Add to `package.json`:

```json
"promo:build": "bash promo/scripts/render.sh",
"promo:validate": "python3 promo/scripts/validate_output.py promo/output/mangastudio-60s-promo.mp4"
```

Add to `.gitignore`:

```gitignore
promo/build/
promo/output/*
!promo/output/.gitkeep
```

- [ ] **Step 5: Verify dry-run and tests**

Run: `rtk bash promo/scripts/render.sh --dry-run`

Expected: eight scene IDs in order and a final 1080p H.264 command.

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: all tests PASS.

- [ ] **Step 6: Commit the renderer**

```bash
rtk git add promo/scripts/render.sh promo/tests/test_build_assets.py promo/output/.gitkeep .gitignore package.json
rtk git commit -m "feat(promo): add automated ffmpeg renderer"
```

### Task 4: Validate the Final Media Contract

**Files:**
- Create: `promo/scripts/validate_output.py`
- Modify: `promo/tests/test_build_assets.py`

- [ ] **Step 1: Add failing validator tests**

Mock `subprocess.run` returning ffprobe JSON and assert `validate_probe()` accepts:

```json
{"format":{"duration":"60.0"},"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30/1"},{"codec_type":"audio","codec_name":"aac","channels":2}]}
```

Also assert it rejects duration `50`, width `1280`, missing audio, and non-H.264 video.

- [ ] **Step 2: Run tests and verify failure**

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: FAIL because `validate_output.py` does not exist.

- [ ] **Step 3: Implement validation**

Run ffprobe with:

```bash
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height,avg_frame_rate,channels -of json INPUT
```

Return nonzero with a specific message unless duration is 58–62 seconds, resolution is 1920×1080, video codec is H.264, frame rate is 30 fps, and AAC stereo audio exists. Also reject files smaller than 1 MiB.

- [ ] **Step 4: Run tests**

Run: `rtk python -m unittest discover -s promo/tests -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit validation**

```bash
rtk git add promo/scripts/validate_output.py promo/tests/test_build_assets.py
rtk git commit -m "test(promo): validate rendered media contract"
```

### Task 5: Render, Inspect, and Deliver the First Cut

**Files:**
- Generate: `promo/output/mangastudio-60s-promo.mp4`
- Generate: `promo/output/mangastudio-60s-promo-cover.jpg`
- Generate: `promo/output/contact-sheet.jpg`

- [ ] **Step 1: Run the full renderer with bounded logging**

Run with a 10-minute timeout and tee output to `/tmp/codex-mangastudio-promo-<time>.log`:

```bash
gtimeout 600 rtk npm run promo:build 2>&1 | tee /tmp/codex-mangastudio-promo-<time>.log
```

Expected: renderer exits 0 and prints the final MP4 path.

- [ ] **Step 2: Run automated media validation**

Run: `rtk npm run promo:validate`

Expected: PASS with duration, resolution, video codec, and audio codec summary.

- [ ] **Step 3: Generate visual verification artifacts**

Use FFmpeg to extract frames at 2, 6, 12, 22, 33, 44, 52, and 58 seconds and tile them into `promo/output/contact-sheet.jpg`. Extract the 55-second CTA frame as `promo/output/mangastudio-60s-promo-cover.jpg` only if its text remains legible; otherwise render a dedicated cover from the reveal card.

- [ ] **Step 4: Perform visual and audio review**

Inspect the contact sheet at original detail and play the MP4. Confirm no black frames, cropped subtitles, illegible UI focus, narration clipping, misleading completion claims, or silent sections other than the intentional opening beat.

- [ ] **Step 5: Correct and re-render once if required**

Change only manifest timing, caption copy, zoom focus, or audio levels needed to fix observed defects, rerun Tasks 5.1–5.4, and keep the revised output only after validation passes.

- [ ] **Step 6: Deliver paths and known limitations**

Provide clickable links to the MP4, cover, contact sheet, render log, manifest, and renderer. Note that the synthetic background bed is a fallback and should be replaced with a licensed music track before a public campaign if no licensed track was supplied.

---

## Self-Review Results

- Spec coverage: all eight scenes, real UI sources, narration, subtitles, branding, audio, fallback behavior, 16:9 output, open-source CTA, and 58–62 second validation are mapped to tasks.
- Scope: the pipeline is isolated from the application and produces one testable deliverable; vertical recuts and the longer workflow tutorial remain out of scope.
- Consistency: the output path is always `promo/output/mangastudio-60s-promo.mp4`; the manifest contains eight contiguous scenes; all commands use the same build and output directories.
- Placeholder scan: no implementation placeholders remain; optional music has a deterministic synthesized fallback.
