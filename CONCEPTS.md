# CONCEPTS.md - Technical Glossary

## Computer Vision (CV) Concepts

### Slit-Scan (Waterfall)
A technique where we take a single line of pixels (a "slit") from every frame of a video and stack them on top of each other.
- **In our context**: By placing the slit across the note highway, falling notes (which move over time) become static vertical bars or blobs in the resulting image. This transforms a "video processing" problem into a simpler "image processing" problem.

### ROI (Region of Interest)
A specific portion of an image that we want to process.
- **In our context**: We don't need to look at the background animation or the score counter. We only care about the specific rectangle where the notes fall.

### Thresholding
Converting a color image into a binary image (black and white) based on pixel intensity.
- **In our context**: Notes are usually bright and colorful against a dark background. We use thresholding to say "keep pixels brighter than X, discard the rest" to isolate the notes.

### Contours
Curves joining all the continuous points (along the boundary), having same color or intensity.
- **In our context**: After thresholding, we find "contours" to identify the shapes of the notes. The center of a contour gives us the precise position of a drum hit.

## Music/MIDI Concepts

### MIDI Ticks
MIDI time is not measured in seconds, but in "ticks".
- **PPQ (Pulses Per Quarter-note)**: The resolution of the MIDI file (e.g., 480 or 960).
- **Calculation**: To convert a pixel position to a MIDI tick, we need to know the "Scroll Speed" (Pixels per Beat).

### Lane Mapping
Assigning a specific game track to a specific MIDI pitch.
- **Example**:
    - Lane 0 (Leftmost) -> MIDI Note 36 (Kick)
    - Lane 1 -> MIDI Note 38 (Snare)
    - ...and so on.
