# FFmpeg / ffprobe bundled with CedPlay Windows

These two executables are the pre-existing local Gyan full build, not binaries
compiled by CedPlay:

- Build: `2026-09-17-git-7070fe638e-full_build-www.gyan.dev`
- Upstream distributor: https://www.gyan.dev/ffmpeg/builds/
- FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/tree/7070fe638e
- FFmpeg source archive: https://github.com/FFmpeg/FFmpeg/archive/7070fe638e.tar.gz
- Configuration includes `--enable-gpl --enable-version3` and additional libraries.
- FFmpeg's GPL version 3 text is provided in `GPL-3.0.txt`.
- Exact executable sizes and SHA-256 hashes are recorded in `BUNDLED-RUNTIME.json`.

This notice records provenance and the known FFmpeg license. It is not a claim
that a source archive for FFmpeg alone supplies the corresponding source for
every library in this static full build. A public redistribution requires the
matching third-party licenses and complete corresponding source/build materials
for this exact build. Those materials were not present beside the local binaries.

The Electron runtime includes its own LICENSE and LICENSES.chromium.html files
at the root of the Windows application directory. Keep them with the application.
