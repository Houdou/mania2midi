import cv2
import numpy as np
import argparse
import os
import json
import glob
import re

def main():
    parser = argparse.ArgumentParser(description='Detect notes in Slit-Scan chunks')
    parser.add_argument('--input', required=True, help='Directory containing chunk images')
    parser.add_argument('--lanes', type=int, default=9, help='Number of lanes')
    parser.add_argument('--lane-ratios', type=str, help='Comma-separated lane width ratios (e.g. "1,1.5,1")')
    parser.add_argument('--threshold', type=int, default=200, help='Brightness threshold (0-255)')
    parser.add_argument('--beats-per-bar', type=int, default=4, help='Beats per bar (Time Signature Numerator)')
    parser.add_argument('--bars-per-line', type=int, default=1, help='Number of bars between detected lines')
    
    args = parser.parse_args()

    # Parse lane ratios if provided
    lane_ratios = []
    if args.lane_ratios:
        try:
            lane_ratios = [float(x) for x in args.lane_ratios.split(',')]
            if len(lane_ratios) != args.lanes:
                print(f"Warning: Number of ratios ({len(lane_ratios)}) does not match lanes ({args.lanes}). Using equal widths.")
                lane_ratios = []
        except ValueError:
            print("Error parsing lane ratios. Using equal widths.")
            lane_ratios = []
    
    # If no valid ratios, use equal weights
    if not lane_ratios:
        lane_ratios = [1.0] * args.lanes

    # Normalize ratios to sum to 1.0 for easy calculation
    total_ratio = sum(lane_ratios)
    normalized_ratios = [r / total_ratio for r in lane_ratios]

    # Load metadata if exists
    metadata_path = os.path.join(args.input, "metadata.json")
    metadata = {}
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)

    # Find all chunk files
    chunk_files = glob.glob(os.path.join(args.input, "chunk_*.jpg"))
    
    # Sort by index
    # Filename format: chunk_{index}.jpg
    def get_index(filename):
        match = re.search(r'chunk_(\d+)\.jpg', filename)
        return int(match.group(1)) if match else -1
        
    chunk_files.sort(key=get_index)

    detected_notes = []
    detected_bar_lines_y = [] # Store global Y coordinates of bar lines
    current_base_y = 0.0 # Accumulate height of processed chunks

    print(f"Found {len(chunk_files)} chunks in {args.input}")

    for chunk_file in chunk_files:
        chunk_idx = get_index(chunk_file)
        print(f"Processing chunk {chunk_idx}...")
        
        img = cv2.imread(chunk_file)
        if img is None:
            continue
            
        height, width, _ = img.shape
        lane_width = width / args.lanes
        
        # Convert to grayscale for simple brightness detection
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Threshold
        _, thresh = cv2.threshold(gray, args.threshold, 255, cv2.THRESH_BINARY)

        # --- Pass 1: Detect Bar Lines (Global on the chunk) ---
        # We look for lines that span most of the image width
        contours_global, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours_global:
             x, y, w, h = cv2.boundingRect(cnt)
             # Bar line criteria: Wide (> 80% of image width) and Thin (< 10px)
             if w > (width * 0.8) and h < 10:
                 center_y = y + h/2
                 # Calculate Global Y (pixels from start of video time)
                 # Up-scroll logic: Top of chunk is LATER, Bottom is EARLIER.
                 # But chunks are ordered 0..N (0 is start).
                 # So Global Y = current_base_y + (height - center_y)
                 global_y = current_base_y + (height - center_y)
                 detected_bar_lines_y.append(global_y)

        # --- Pass 2: Detect Notes (Per Lane) ---
        # Process each lane
        current_x = 0.0
        for lane_idx in range(args.lanes):
            # Calculate lane width based on ratio
            this_lane_width_ratio = normalized_ratios[lane_idx]
            this_lane_width_px = width * this_lane_width_ratio
            
            x_start = int(current_x)
            x_end = int(current_x + this_lane_width_px)
            
            # Update current_x for next lane
            current_x += this_lane_width_px
            
            # Extract lane strip from threshold image
            lane_strip = thresh[:, x_start:x_end]
            
            # Find contours in this strip
            contours, _ = cv2.findContours(lane_strip, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for cnt in contours:
                # Filter small noise
                if cv2.contourArea(cnt) < 50:
                    continue
                    
                # Get bounding box
                x, y, w, h = cv2.boundingRect(cnt)
                
                # Filter based on dimensions (User Request: Ignore long/thin, enforce fixed style)
                # Notes in mania are typically wide (filling the lane) and have some height.
                # 1. Width check: Must be at least 50% of lane width
                if w < (this_lane_width_px * 0.5):
                    continue
                    
                # 2. Height check: Must be at least 3 pixels (avoid single line noise)
                if h < 3:
                    continue

                # 3. Bar Line check: If it's very wide but short, it's likely a bar line
                # Bar lines span the full lane (w ~ lane_width) but are thin
                if w > (this_lane_width_px * 0.9) and h < 6:
                    continue
                
                # Calculate centroid Y
                center_y = y + h / 2
                
                # Calculate Time (Seconds)
                # Global Y = current_base_y + (height - center_y)
                # Time = start_time + (Global Y / speed) / fps
                global_y = current_base_y + (height - center_y)
                time_sec = 0.0
                if 'speed' in metadata and 'fps' in metadata and 'start_time' in metadata:
                    time_sec = metadata['start_time'] + (global_y / metadata['speed']) / metadata['fps']

                # Store note
                # We store local coordinates.
                detected_notes.append({
                    "chunk_index": chunk_idx,
                    "chunk_height": height,
                    "chunk_base_y": current_base_y,
                    "lane": lane_idx,
                    "y": float(center_y),
                    "h": float(h),
                    "global_y": float(global_y),
                    "time": float(time_sec),
                    "type": "hit" # Default to hit, logic for hold notes can be added later
                })
        
        # Update base Y for next chunk
        current_base_y += height

    # Calculate BPM
    bpm = 0
    if len(detected_bar_lines_y) > 1:
        detected_bar_lines_y.sort()
        diffs = np.diff(detected_bar_lines_y)
        
        # Filter outliers (e.g. double detection or missed lines)
        # We assume most bars are evenly spaced.
        median_diff = np.median(diffs)
        
        # If we have enough data, we can be smarter.
        # Filter diffs that are close to median (within 20%)
        valid_diffs = [d for d in diffs if 0.8 * median_diff < d < 1.2 * median_diff]
        
        if valid_diffs:
            avg_diff_px = np.mean(valid_diffs)
            
            # Calculate BPM
            if 'speed' in metadata and 'fps' in metadata:
                frames_per_line = avg_diff_px / metadata['speed']
                seconds_per_line = frames_per_line / metadata['fps']
                
                # BPM = Beats Per Minute
                # beats_per_line = beats_per_bar * bars_per_line
                beats_per_line = args.beats_per_bar * args.bars_per_line
                
                if seconds_per_line > 0:
                    bpm = (60 / seconds_per_line) * beats_per_line
                    print(f"Estimated BPM: {bpm:.2f} (Avg Line Height: {avg_diff_px:.1f}px, Beats/Line: {beats_per_line})")

            # --- Quantization Step ---
            # Snap notes to 1/48 of a measure (covers 1/4, 1/8, 1/12, 1/16, 1/24, 1/32)
            # We only quantize if we have valid bar lines
            print("Quantizing notes...")
            
            # If bars_per_line > 1, the "measure" we detected is actually multiple measures.
            # We need to increase subdivisions to maintain resolution.
            # Standard: 48 subdivisions per bar.
            subdivisions = 48 * args.bars_per_line
            
            # We need to handle the case where bar lines might be missing or noisy.
            # But for now, let's assume detected_bar_lines_y gives us a grid.
            # We will only snap notes that fall within the range of detected bar lines.
            
            # Sort bar lines just in case
            bars = sorted(detected_bar_lines_y)
            
            for note in detected_notes:
                gy = note['global_y']
                
                # Find the measure this note belongs to
                # We look for the last bar line <= gy
                # This is equivalent to bisect_right - 1
                import bisect
                idx = bisect.bisect_right(bars, gy) - 1
                
                if 0 <= idx < len(bars) - 1:
                    bar_start = bars[idx]
                    bar_end = bars[idx+1]
                    measure_height = bar_end - bar_start
                    
                    # Only snap if measure height is reasonable (close to avg)
                    if 0.8 * avg_diff_px < measure_height < 1.2 * avg_diff_px:
                        relative_y = gy - bar_start
                        fraction = relative_y / measure_height
                        
                        # Snap fraction
                        snapped_fraction = round(fraction * subdivisions) / subdivisions
                        
                        # Calculate new global Y
                        new_global_y = bar_start + (snapped_fraction * measure_height)
                        
                        # Update note
                        note['global_y'] = new_global_y
                        
                        # Update local Y (visual)
                        # global_y = chunk_base_y + (height - center_y)
                        # center_y = height - (global_y - chunk_base_y)
                        note['y'] = note['chunk_height'] - (new_global_y - note['chunk_base_y'])
                        
                        # Update time
                        if 'speed' in metadata and 'fps' in metadata and 'start_time' in metadata:
                            note['time'] = metadata['start_time'] + (new_global_y / metadata['speed']) / metadata['fps']

    # Save results
    output_file = os.path.join(args.input, "notes.json")
    output_data = {
        "notes": detected_notes,
        "bpm": round(bpm, 2),
        "bar_lines": detected_bar_lines_y
    }
    with open(output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
        
    print(f"Saved {len(detected_notes)} notes and BPM {bpm:.2f} to {output_file}")

if __name__ == "__main__":
    main()
