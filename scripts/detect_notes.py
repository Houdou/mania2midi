import cv2
import numpy as np
import argparse
import os
import json
import glob
import re
import bisect

def main():
    parser = argparse.ArgumentParser(description='Detect notes in Slit-Scan chunks')
    parser.add_argument('--input', required=True, help='Directory containing chunk images')
    parser.add_argument('--lanes', type=int, default=9, help='Number of lanes')
    parser.add_argument('--lane-ratios', type=str, help='Comma-separated lane width ratios (e.g. "1,1.5,1")')
    parser.add_argument('--threshold', type=int, default=200, help='Brightness threshold (0-255)')
    parser.add_argument('--beats-per-bar', type=int, default=4, help='Beats per bar (Time Signature Numerator)')
    parser.add_argument('--bars-per-line', type=int, default=1, help='Number of bars between detected lines')
    parser.add_argument('--min-height', type=int, default=3, help='Minimum note height in pixels')
    parser.add_argument('--merge-gap', type=int, default=5, help='Max gap to merge segments')
    
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
        
        # cv2.imread doesn't support non-ASCII paths on Windows
        # Use fromfile + imdecode
        try:
            with open(chunk_file, "rb") as f:
                file_bytes = np.frombuffer(f.read(), dtype=np.uint8)
                img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"Error reading chunk {chunk_file}: {e}")
            continue

        if img is None:
            continue
            
        height, width, _ = img.shape
        
        # Use Max-Channel brightness instead of weighted Grayscale
        # This ensures colored notes (like pink/red) retain high brightness.
        gray = np.max(img, axis=2)
        
        # --- Pass 1: Detect Bar Lines (Global Scanline) ---
        # Calculate mean brightness of each row across the whole image
        global_row_means = np.mean(gray, axis=1)
        
        # Bar lines are bright rows spanning most of the image
        is_bar_row = global_row_means > args.threshold
        
        padded_bar_mask = np.pad(is_bar_row, (1, 1), 'constant', constant_values=False)
        diff_bar = np.diff(padded_bar_mask.astype(int))
        starts_bar = np.where(diff_bar == 1)[0]
        ends_bar = np.where(diff_bar == -1)[0]
        
        for start, end in zip(starts_bar, ends_bar):
            h = end - start
            # Bar lines are thin (e.g. < 10px)
            if h < 10:
                # Verify fill ratio across the whole width
                bar_rows = gray[start:end, :]
                bright_pixels = np.sum(bar_rows > args.threshold)
                total_pixels = bar_rows.size
                fill_ratio = bright_pixels / total_pixels
                
                if fill_ratio > 0.8:
                    center_y = start + h/2
                    global_y = current_base_y + (height - center_y)
                    detected_bar_lines_y.append(global_y)

        # --- Pass 2: Detect Notes (Per Lane Scanline) ---
        current_x = 0.0
        for lane_idx in range(args.lanes):
            this_lane_width_ratio = normalized_ratios[lane_idx]
            this_lane_width_px = width * this_lane_width_ratio
            
            x_start = int(current_x)
            x_end = int(current_x + this_lane_width_px)
            current_x += this_lane_width_px
            
            # Extract lane strip
            lane_gray = gray[:, x_start:x_end]
            
            # --- Improved Detection Logic ---
            # Instead of segmenting first then validating, we validate PER ROW.
            # This allows us to "slice" the solid note bar out of a larger background icon.
            
            # 1. Brightness Check (Max Channel)
            # Lower threshold to catch dim colored notes (purple/blue)
            # User reported purple note missed -> likely too dim.
            detection_thresh = max(100, args.threshold - 50) 
            row_maxes = np.max(lane_gray, axis=1)
            is_bright = row_maxes > detection_thresh
            
            # 2. Width/Fill Check
            # The "Note" is a bar that spans the lane. Background icons are usually narrower or hollow.
            # We calculate how many pixels in the row are "bright enough".
            # We use a slightly lower threshold for fill calculation to include edges.
            fill_thresh = detection_thresh * 0.8
            row_bright_counts = np.sum(lane_gray > fill_thresh, axis=1)
            lane_w_px = x_end - x_start
            row_fill_ratios = row_bright_counts / lane_w_px
            is_wide = row_fill_ratios > 0.6 # Must span 60% of lane
            
            # 3. Solid Color Check (Variance)
            # The "Note" is usually a solid color. Icons have details/gradients.
            row_stds = np.std(lane_gray, axis=1)
            is_solid = row_stds < 80.0 # Allow some gradient but reject high noise
            
            # Combine checks
            is_note_row = is_bright & is_wide & is_solid
            
            # 4. Segment Detection on Valid Rows
            padded_mask = np.pad(is_note_row, (1, 1), 'constant', constant_values=False)
            diff = np.diff(padded_mask.astype(int))
            starts = np.where(diff == 1)[0]
            ends = np.where(diff == -1)[0]
            
            # Merge close segments
            merged_segments = []
            if len(starts) > 0:
                curr_start = starts[0]
                curr_end = ends[0]
                for i in range(1, len(starts)):
                    if starts[i] - curr_end < args.merge_gap:
                        curr_end = ends[i]
                    else:
                        merged_segments.append((curr_start, curr_end))
                        curr_start = starts[i]
                        curr_end = ends[i]
                merged_segments.append((curr_start, curr_end))
            
            for start, end in merged_segments:
                h = end - start
                
                # Filter tiny noise
                if h < args.min_height: continue
                
                # Extract segment for final verification (optional, but good for debugging)
                # segment_pixels = lane_gray[start:end, :]
                
                # Calculate centroid Y
                center_y = start + h / 2
                
                # D. Bar Line Check (Local)
                global_y = current_base_y + (height - center_y)
                
                # Check against detected bar lines
                is_bar_line = False
                for bar_y in detected_bar_lines_y:
                    if abs(bar_y - global_y) < 5: # 5px tolerance
                        is_bar_line = True
                        break
                if is_bar_line:
                    continue

                # Calculate Time
                time_sec = 0.0
                if 'speed' in metadata and 'fps' in metadata and 'start_time' in metadata:
                    time_sec = metadata['start_time'] + (global_y / metadata['speed']) / metadata['fps']

                detected_notes.append({
                    "chunk_index": chunk_idx,
                    "chunk_height": height,
                    "chunk_base_y": current_base_y,
                    "lane": lane_idx,
                    "y": float(center_y),
                    "h": float(h),
                    "global_y": float(global_y),
                    "time": float(time_sec),
                    "type": "hit"
                })
        
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
