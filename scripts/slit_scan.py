import cv2
import numpy as np
import argparse
import os
import sys
import json

# =============================================================================
# SLIT-SCAN GENERATOR
# =============================================================================
# This script implements the "Slit-Scan" technique to transform a rhythm game
# video into a static "Waterfall" chart.
#
# CONCEPT:
# 1. We pick a specific horizontal line (Scan Line) on the screen where the
#    notes pass through.
# 2. We read the video frame by frame.
# 3. From each frame, we copy ONLY that single line of pixels.
# 4. We stack these lines on top of each other.
#
# RESULT:
# - Time becomes the vertical axis (Y-axis).
# - The horizontal axis (X-axis) remains the lane position.
# - Falling notes appear as vertical bars or blobs.
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Generate Slit-Scan Waterfall from Video')
    parser.add_argument('--video', required=True, help='Path to input video file')
    parser.add_argument('--output', required=True, help='Directory to save output chunks')
    parser.add_argument('--y', type=int, required=True, help='Y coordinate of the scan line')
    parser.add_argument('--x1', type=int, required=True, help='Left X coordinate of the track')
    parser.add_argument('--x2', type=int, required=True, help='Right X coordinate of the track')
    parser.add_argument('--chunk-size', type=int, default=5000, help='Height of each output image chunk')
    parser.add_argument('--start', type=float, default=0.0, help='Start time in seconds')
    parser.add_argument('--end', type=float, default=0.0, help='End time in seconds (0 for end of video)')
    parser.add_argument('--speed', type=float, default=10.0, help='Scroll speed in pixels per frame (Slit Height)')
    
    args = parser.parse_args()

    # 1. Open the video file
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: Could not open video {args.video}")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    
    # Save metadata
    metadata = {
        "fps": fps,
        "speed": args.speed,
        "chunk_size": args.chunk_size,
        "y": args.y,
        "x1": args.x1,
        "x2": args.x2,
        "start_time": args.start,
        "end_time": args.end
    }
    
    if not os.path.exists(args.output):
        os.makedirs(args.output)
        
    with open(os.path.join(args.output, "metadata.json"), 'w') as f:
        json.dump(metadata, f, indent=2)

    # Seek to start time
    if args.start > 0:
        fps = cap.get(cv2.CAP_PROP_FPS)
        start_frame = int(args.start * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        print(f"Seeking to {args.start}s (Frame {start_frame})")

    # Calculate end frame
    end_frame = float('inf')
    if args.end > 0:
        fps = cap.get(cv2.CAP_PROP_FPS)
        end_frame = int(args.end * fps)
        print(f"Processing until {args.end}s (Frame {end_frame})")

    # Ensure output directory exists
    if not os.path.exists(args.output):
        os.makedirs(args.output)

    print(f"Processing video: {args.video}")
    print(f"Scan Line Y: {args.y}, Range X: {args.x1} to {args.x2}")
    print(f"Scroll Speed: {args.speed} px/frame")

    # Buffer to hold the scan lines for the current chunk
    chunk_buffer = []
    chunk_index = 0
    frame_count = 0
    current_frame_idx = cap.get(cv2.CAP_PROP_POS_FRAMES)
    
    # Accumulator for fractional speed
    y_accumulator = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break # End of video
        
        current_frame_idx += 1
        if current_frame_idx > end_frame:
            break

        # 2. Calculate Slit Height for this frame
        # We add the speed to the accumulator
        y_accumulator += args.speed
        
        # The number of pixels to take this frame is the integer part of the accumulator
        # minus what we took previously (which is implicitly handled by resetting/decrementing)
        # Actually, simpler:
        # We want to advance 'speed' pixels.
        # We take 'int(speed)' pixels.
        # We keep the remainder.
        
        slit_height = int(y_accumulator)
        y_accumulator -= slit_height
        
        # Ensure we take at least 1 pixel if speed is very slow, or handle 0?
        # If speed < 1, we might skip frames. For now, let's assume speed >= 1.
        if slit_height < 1:
            slit_height = 1 # Force at least 1 pixel to avoid gaps/stalls
            y_accumulator = 0 # Reset to avoid infinite buildup if speed is tiny

        # 3. Extract the Region of Interest (ROI)
        # We capture from y downwards
        # frame.shape is (Height, Width, Channels)
        y_start = args.y
        y_end = min(args.y + slit_height, frame.shape[0])
        
        scan_strip = frame[y_start:y_end, args.x1:args.x2]

        # 4. Add to buffer
        if scan_strip.shape[0] > 0:
            chunk_buffer.append(scan_strip)
        
        frame_count += 1

        # 5. Check if buffer is full (Chunking)
        # We check the total height of the buffer
        # Since each strip has variable height, we can't just count frames.
        # But for performance, checking len(chunk_buffer) is okay if we assume avg height.
        # Let's check estimated height.
        current_chunk_height = len(chunk_buffer) * args.speed
        if current_chunk_height >= args.chunk_size:
            save_chunk(chunk_buffer, args.output, chunk_index)
            chunk_buffer = [] # Clear buffer
            chunk_index += 1
            print(f"Processed {frame_count} frames...")

    # 6. Save any remaining lines in the buffer
    if len(chunk_buffer) > 0:
        save_chunk(chunk_buffer, args.output, chunk_index)

    cap.release()
    print("Done! Waterfall generation complete.")

def save_chunk(buffer, output_dir, index):
    """
    Stacks the list of single-row arrays into one image and saves it.
    """
    # np.vstack stacks arrays vertically.
    # Input: List of (1, W, 3) arrays
    # Output: (H, W, 3) array
    
    # User requested "Reverse the concat order".
    # By reversing the buffer before stacking, we stack the LATEST frame at the TOP.
    # [ Frame T+N ]
    # ...
    # [ Frame T ]
    # This creates an UP-SCROLL chart (Time flows upwards).
    # This is necessary for falling notes to appear "upright" (Top of note above Bottom of note).
    waterfall_image = np.vstack(buffer[::-1])
    
    # If we wanted to follow "flip upside down at the end", we would do:
    # waterfall_image = cv2.flip(waterfall_image, 0)
    # But this would invert the time axis back to Down-scroll, making the notes upside-down again.
    # We will stick with the Up-scroll chart as it is the "Correct Scan" for shape.
    
    filename = os.path.join(output_dir, f"chunk_{index}.jpg")
    
    # cv2.imwrite doesn't support non-ASCII paths on Windows
    is_success, im_buf = cv2.imencode(".jpg", waterfall_image)
    if is_success:
        with open(filename, "wb") as f:
            im_buf.tofile(f)
            
    print(f"Saved {filename} (Height: {waterfall_image.shape[0]})")

if __name__ == "__main__":
    main()
