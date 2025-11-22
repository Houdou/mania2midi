import cv2
import argparse
import os
import sys
import json

def main():
    parser = argparse.ArgumentParser(description='Extract frames for calibration')
    parser.add_argument('--video', required=True, help='Path to input video file')
    parser.add_argument('--output', required=True, help='Directory to save output images')
    parser.add_argument('--start', type=float, default=0.0, help='Start time in seconds')
    parser.add_argument('--count', type=int, default=5, help='Number of frames to extract')
    parser.add_argument('--interval', type=int, default=5, help='Interval in frames between extractions')
    
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: Could not open video {args.video}")
        sys.exit(1)

    # Seek to start time
    fps = cap.get(cv2.CAP_PROP_FPS)
    start_frame = int(args.start * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    if not os.path.exists(args.output):
        os.makedirs(args.output)

    extracted_files = []
    
    for i in range(args.count):
        ret, frame = cap.read()
        if not ret:
            break
            
        filename = f"calib_{i}.jpg"
        filepath = os.path.join(args.output, filename)
        cv2.imwrite(filepath, frame)
        extracted_files.append(filename)
        
        # Skip frames for interval
        # We already read 1, so skip interval-1
        # But cap.read() advances 1.
        # If interval is 5, we want frame 0, 5, 10...
        # current is 0. next read is 1.
        # we want to jump to 0 + 5 = 5.
        # so we need to skip 4 frames.
        if i < args.count - 1:
            for _ in range(args.interval - 1):
                cap.grab()

    cap.release()
    
    # Output JSON for the server to parse
    print(json.dumps({
        "files": extracted_files,
        "fps": fps,
        "interval": args.interval
    }))

if __name__ == "__main__":
    main()
