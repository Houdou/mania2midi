# AGENTS.md - Project Instructions & Architecture

## Project Goal
Build a tool to convert 9-lane falling-note rhythm game gameplay videos (specifically drum games) into MIDI files.
The tool uses a "Slit-Scan" computer vision approach to reconstruct the note chart into a static image, allowing for visual verification and manual correction before MIDI export.

## Architecture
**Hybrid Stack:**
- **Node.js (Express)**: Main application controller, API server, and file orchestrator. Handles MIDI generation.
- **React (Vite + TS + Mantine)**: Frontend UI for configuration, interactive chart editing, and visualization.
- **Python (OpenCV)**: Heavy-lifting scripts for image processing (Slit-Scan generation, Note Detection).

## Core Workflow
1.  **Setup & Config**: User uploads/selects video. User draws "Scan Line" (ROI) and 9 "Lane Dividers" on a video frame in the UI.
2.  **Slit-Scan Generation (Python)**:
    - Read video frame-by-frame.
    - Extract the pixel row at the "Scan Line".
    - Stack rows to create a "Waterfall" image.
    - **CRITICAL**: The Waterfall image is extremely tall. It MUST be sliced into smaller chunks (tiles) (e.g., 2000px height) to be loadable in the web browser.
3.  **Note Detection (Python)**:
    - Analyze the Waterfall image.
    - Detect notes based on color/contrast in each of the 9 lanes.
    - Output raw JSON data: `[{ time_px: 1234, lane: 0, type: 'hit' }, ...]`.
4.  **Interactive Editing (React)**:
    - Display the tiled Waterfall images.
    - Overlay detected notes as interactive objects.
    - User can add, delete, or move notes.
    - User can adjust the "Grid" (BPM/Offset) to align with the visual bars.
5.  **MIDI Export (Node.js)**:
    - Convert the final JSON (pixel coordinates) into MIDI timestamps.
    - Map lanes to MIDI notes (General MIDI Drum map).
    - Export `.mid` file.

## Directory Structure
- `/server`: Node.js backend code.
- `/client`: React frontend code.
- `/scripts`: Python CV scripts.
- `/workspace`: Temp storage for uploaded videos, generated waterfall chunks, and JSON data.

## Key Constraints
- **Performance**: Always handle the waterfall image as tiled chunks in the UI.
- **Clarity**: Python code must be heavily commented for educational purposes.
- **State**: The `AGENTS.md` file serves as the source of truth for the project direction.
- **Package Manager**: Prefer **Yarn** over NPM for all Node.js tasks.
