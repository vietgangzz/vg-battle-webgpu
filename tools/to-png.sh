#!/bin/zsh
# Convert raw frames from render-frames.ts to PNG (and a contact sheet).
cd "${1:-tools/.out/frames}"
S=$(cat size.txt)
for f in *.bgra(N) *.rgba(N); do
  ffmpeg -v error -y -f rawvideo -pix_fmt ${f:e} -s $S -i $f ${f:r}.png
done
ffmpeg -v error -y -pattern_type glob -i '[fs]*.png' -vf "scale=640:-1,tile=2x2:padding=4" sheet.png 2>/dev/null
ls *.png
