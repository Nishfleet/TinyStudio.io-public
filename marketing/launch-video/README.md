# Launch video (HyperFrames)

Source for the TinyStudio launch video. Script: [script.md](script.md). Built with [HyperFrames](https://github.com/heygen-com/hyperframes) 0.8.149 (Apache-2.0).

```bash
cd marketing/launch-video
npm run check    # lint the composition
npm run render   # writes renders/*.mp4 (1920x1080, ~100 s on the VPS)
```

`assets/*.jpg` are screenshots of the live pages at 1920 px width. The rendered mp4 is not in git; it is on the draft GitHub release `launch-video`. To remove the video, delete this folder.
