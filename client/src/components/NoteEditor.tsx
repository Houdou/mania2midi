import { Modal, Button, Group, Stack, Text, Slider, ActionIcon, Box } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { useAtom } from 'jotai';
import { useState, useEffect, useRef, useMemo } from 'react';
import { videoFilenameAtom, scanLineYAtom, trackX1Atom, trackX2Atom, laneRatiosAtom, scrollSpeedAtom, hitLineYAtom, visualOffsetAtom } from '../store';
import { Play, Pause, Trash, Plus } from 'lucide-react';

interface Note {
  chunk_index: number;
  chunk_height?: number;
  lane: number;
  y: number;
  h: number;
  time?: number;
  type: string;
}

interface NoteEditorProps {
    opened: boolean;
    onClose: () => void;
    notes: Note[];
    setNotes: (notes: Note[]) => void;
    metadata?: any;
    bpm?: number | null;
    barLines?: number[];
}

export function NoteEditor({ opened, onClose, notes, setNotes, metadata, bpm, barLines }: NoteEditorProps) {
    const [videoFilename] = useAtom(videoFilenameAtom);
    const [scanLineY] = useAtom(scanLineYAtom);
    const [trackX1] = useAtom(trackX1Atom);
    const [trackX2] = useAtom(trackX2Atom);
    const [laneRatios] = useAtom(laneRatiosAtom);
    const [configScrollSpeed] = useAtom(scrollSpeedAtom); // px/frame
    const [hitLineY] = useAtom(hitLineYAtom);
    const [visualOffset, setVisualOffset] = useAtom(visualOffsetAtom);

    const videoRef = useRef<HTMLVideoElement>(null);
    const initialSeekDone = useRef(false);

    useEffect(() => {
        if (opened) {
            initialSeekDone.current = false;
        }
    }, [opened]);
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
    
    // Calculate visual speed (px/sec) for preview
    const visualSpeed = useMemo(() => {
        if (metadata && metadata.speed && metadata.fps) {
            return metadata.speed * metadata.fps;
        }
        // Fallback: assume 60fps if unknown
        return configScrollSpeed * 60;
    }, [metadata, configScrollSpeed]);

    const updateLayout = () => {
        if (!containerRef.current || !videoRef.current) return;
        const container = containerRef.current;
        const video = videoRef.current;
        
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        
        if (!vw || !vh) return;
        
        const va = vw / vh;
        const ca = cw / ch;
        
        let targetW, targetH, targetL, targetT;
        
        if (ca > va) {
            // Container is wider (Pillarbox)
            targetH = ch;
            targetW = ch * va;
            targetL = (cw - targetW) / 2;
            targetT = 0;
        } else {
            // Container is taller (Letterbox)
            targetW = cw;
            targetH = cw / va;
            targetL = 0;
            targetT = (ch - targetH) / 2;
        }
        
        setVideoRect({ left: targetL, top: targetT, width: targetW, height: targetH });
    };

    useEffect(() => {
        const observer = new ResizeObserver(updateLayout);
        if (containerRef.current) observer.observe(containerRef.current);
        window.addEventListener('resize', updateLayout);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateLayout);
        };
    }, []);

    const renderCanvas = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Sync canvas size to internal video resolution
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            updateLayout(); // Ensure layout is updated when video loads
        }

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Scan Line (Red - Source)
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, scanLineY);
        ctx.lineTo(canvas.width, scanLineY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.font = '10px Arial';
        ctx.fillText('SCAN', 5, scanLineY - 5);
        ctx.setLineDash([]);

        // Draw Hit Line (Green - Target)
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, hitLineY);
        ctx.lineTo(canvas.width, hitLineY);
        ctx.stroke();
        ctx.fillStyle = '#00ff00';
        ctx.font = '10px Arial';
        ctx.fillText('HIT', 5, hitLineY - 5);

        // Draw Track Bounds
        ctx.strokeStyle = 'cyan';
        ctx.beginPath();
        ctx.moveTo(trackX1, 0);
        ctx.lineTo(trackX1, canvas.height);
        ctx.moveTo(trackX2, 0);
        ctx.lineTo(trackX2, canvas.height);
        ctx.stroke();

        // Draw Lanes
        const trackWidth = trackX2 - trackX1;
        const totalRatio = laneRatios.reduce((a, b) => a + b, 0);
        let currentX = trackX1;
        
        // Pre-calculate lane X positions
        const lanePositions: {x: number, w: number}[] = [];
        for (const ratio of laneRatios) {
            const w = (ratio / totalRatio) * trackWidth;
            lanePositions.push({ x: currentX, w });
            
            // Draw divider
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
            ctx.beginPath();
            ctx.moveTo(currentX, 0); // Draw full height
            ctx.lineTo(currentX, canvas.height); 
            ctx.stroke();
            
            currentX += w;
        }

        // Draw Bar Lines (Grid)
        // const VISUAL_SPEED = visualSpeed; // Already defined below, let's move definition up or reuse
        const VISUAL_SPEED = visualSpeed; 

        if (barLines && barLines.length > 0 && metadata && metadata.speed && metadata.fps && metadata.start_time !== undefined) {
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)'; // Dimmed green
            ctx.lineWidth = 1;
            
            // We only want to draw lines that are visible on screen.
            // Visible time range:
            // Top of screen (y=0): deltaT = scanLineY / VISUAL_SPEED
            // Bottom of screen (y=H): deltaT = (scanLineY - H) / VISUAL_SPEED
            // time = currentTime + deltaT - offset
            
            // Actually, simpler: Iterate all bar lines, calculate Y, check bounds.
            // Optimization: Binary search for start index if list is huge.
            
            barLines.forEach(global_y => {
                // Convert global_y to time
                const lineTime = metadata.start_time + (global_y / metadata.speed) / metadata.fps;
                
                // Apply visual offset
                const adjustedTime = lineTime + (visualOffset / 1000);
                const deltaT = adjustedTime - video.currentTime;
                
                // Y = scanLineY - (deltaT * VISUAL_SPEED)
                const lineY = scanLineY - (deltaT * VISUAL_SPEED);
                
                if (lineY >= 0 && lineY <= canvas.height) {
                    ctx.beginPath();
                    ctx.moveTo(trackX1, lineY);
                    ctx.lineTo(trackX2, lineY);
                    ctx.stroke();
                }
            });
        }

        // Draw Notes
        // We want to visualize notes falling towards the HIT line.
        // Note Time = T_hit.
        // Current Time = T_now.
        // Delta T = T_hit - T_now.
        // If Delta T > 0, note is approaching (above line).
        // If Delta T < 0, note is past (below line).
        // Distance = Delta T * Speed (pixels/sec).
        // const VISUAL_SPEED = visualSpeed; // Removed redeclaration 

        const timeWindow = 2.0; // Show notes within +/- 2 seconds
        let passedCount = 0;

        notes.forEach(note => {
            if (note.time === undefined) return;
            
            // Apply visual offset (ms -> s)
            const adjustedTime = note.time + (visualOffset / 1000);
            const deltaT = adjustedTime - video.currentTime;
            
            // Check if passed for stats (regardless of visibility)
            // noteY > hitLineY <=> deltaT < (scanLineY - hitLineY) / VISUAL_SPEED
            // But simpler: noteY is calculated below.
            // Let's calculate noteY for check.
            const noteY_check = scanLineY - (deltaT * VISUAL_SPEED);
            if (noteY_check > hitLineY) {
                passedCount++;
            }

            if (Math.abs(deltaT) > timeWindow) return;

            // Y position relative to SCAN line (where detection happened)
            // Y = scanLineY - (deltaT * VISUAL_SPEED)
            // This ensures the note overlay matches the video content at the scan line.
            const noteY = noteY_check;
            
            const lane = lanePositions[note.lane];
            if (!lane) return;

            // Draw Note Rect
            // Dim only if it has passed the HIT line (not the scan line)
            // Note is falling down. Hit line is at bottom (hitLineY).
            // If noteY > hitLineY, it has passed.
            const hasPassedHitLine = noteY > hitLineY;
            ctx.fillStyle = hasPassedHitLine ? 'rgba(0, 255, 0, 0.4)' : 'rgba(0, 255, 0, 0.8)';
            
            // Highlight if crossing the HIT line (visual guide)
            // Time to hit line = (hitLineY - scanLineY) / VISUAL_SPEED
            // We can check if noteY is close to hitLineY
            if (Math.abs(noteY - hitLineY) < 10) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            }

            // Calculate visual height based on duration
            let noteH = 20;
            if (metadata && metadata.speed && metadata.fps && note.h) {
                const duration = (note.h / metadata.speed) / metadata.fps;
                noteH = duration * VISUAL_SPEED;
            } else if (note.h) {
                // Fallback if metadata missing, just scale it arbitrarily or use raw
                // If we assume note.h was at 1x speed, and we are at scrollSpeed...
                // Let's just use note.h if we can't calc duration
                noteH = note.h;
            }
            
            // Center the note vertically on the calculated Y?
            // No, note.time usually refers to the START (Hit) of the note (bottom edge).
            // If it's a falling note, the "Hit" time is when the bottom reaches the line.
            // So Y is the bottom edge.
            // The top edge is Y - H.
            // Wait, in slit scan, y is the center? Or top?
            // In slit scan, y is the pixel row.
            // Usually we treat the timestamp as the "Hit" moment.
            // For a falling note, the "Hit" is the leading edge (bottom).
            // So we should draw the rect ABOVE noteY.
            // Rect: [x, noteY - noteH, w, noteH]
            
            ctx.fillRect(lane.x + 2, noteY - noteH, lane.w - 4, noteH);
        });

        // Draw Stats
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(5, 5, 220, 30);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px monospace';
        ctx.fillText(`Passed: ${passedCount} / ${notes.length}`, 15, 26);
    };

    // Animation Loop
    useEffect(() => {
        let animationFrameId: number;
        
        const loop = () => {
            renderCanvas();
            if (isPlaying) {
                animationFrameId = requestAnimationFrame(loop);
            }
        };

        if (isPlaying) {
            loop();
        } else {
            renderCanvas();
        }

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isPlaying, notes, scanLineY, hitLineY, trackX1, trackX2, laneRatios, visualSpeed, metadata, visualOffset]);

    // Update on seek/time change when paused
    useEffect(() => {
        if (!isPlaying) {
            renderCanvas();
        }
    }, [currentTime, isPlaying]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleSeek = (val: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = val;
            setCurrentTime(val);
        }
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (!canvasRef.current || !videoRef.current) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = canvasRef.current.width / rect.width;
        const scaleY = canvasRef.current.height / rect.height;
        
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // Check if clicked on a note
        // We need to re-calculate note positions to hit-test
        // This duplicates render logic, ideally refactor.
        
        const VISUAL_SPEED = visualSpeed;
        const trackWidth = trackX2 - trackX1;
        const totalRatio = laneRatios.reduce((a, b) => a + b, 0);
        
        // Find clicked lane
        let clickedLane = -1;
        let currentX = trackX1;
        for (let i = 0; i < laneRatios.length; i++) {
            const w = (laneRatios[i] / totalRatio) * trackWidth;
            if (x >= currentX && x < currentX + w) {
                clickedLane = i;
                break;
            }
            currentX += w;
        }

        if (clickedLane === -1) return;

        // Check for existing note click (Delete)
        const hitNoteIndex = notes.findIndex(note => {
            if (note.lane !== clickedLane || note.time === undefined) return false;
            
            // Apply visual offset for hit testing
            const adjustedTime = note.time + (visualOffset / 1000);
            const deltaT = adjustedTime - videoRef.current!.currentTime;
            
            const noteY = scanLineY - (deltaT * VISUAL_SPEED);
            
            let noteH = 20;
            if (metadata && metadata.speed && metadata.fps && note.h) {
                const duration = (note.h / metadata.speed) / metadata.fps;
                noteH = duration * VISUAL_SPEED;
            } else if (note.h) {
                noteH = note.h;
            }
            
            // Box check: Rect is [lane.x, noteY - noteH, lane.w, noteH]
            // Check Y with padding
            return y >= (noteY - noteH - 5) && y <= (noteY + 5);
        });

        if (hitNoteIndex !== -1) {
            // Delete note
            const newNotes = [...notes];
            newNotes.splice(hitNoteIndex, 1);
            setNotes(newNotes);
        } else {
            // Add note
            // Calculate time from Y
            // Y = scanLineY - (deltaT_visual * VISUAL_SPEED)
            // deltaT_visual = (scanLineY - Y) / VISUAL_SPEED
            // deltaT_visual = (note.time + offset) - currentTime
            // note.time = currentTime + deltaT_visual - offset
            
            // Center the note on the cursor
            // The user clicked 'y', which should be the center.
            // The note bottom (hit time) is at y + h/2.
            const defaultH = 20;
            const yBottom = y + (defaultH / 2);

            const deltaT_visual = (scanLineY - yBottom) / VISUAL_SPEED;
            let noteTime = videoRef.current.currentTime + deltaT_visual - (visualOffset / 1000);
            
            // Quantize if barLines are available
            let finalNoteTime = noteTime;
            let finalGlobalY = 0;
            
            if (metadata && metadata.speed && metadata.fps && metadata.start_time !== undefined) {
                // Calculate raw global_y
                let global_y = (noteTime - metadata.start_time) * metadata.fps * metadata.speed;
                
                if (barLines && barLines.length > 1) {
                    // Find grid segment
                    // barLines is sorted
                    // Find index where barLines[i] <= global_y
                    let idx = -1;
                    for (let i = 0; i < barLines.length; i++) {
                        if (barLines[i] <= global_y) {
                            idx = i;
                        } else {
                            break;
                        }
                    }
                    
                    if (idx >= 0 && idx < barLines.length - 1) {
                        const grid_start = barLines[idx];
                        const grid_end = barLines[idx+1];
                        const segment_height = grid_end - grid_start;
                        
                        const relative_y = global_y - grid_start;
                        const fraction = relative_y / segment_height;
                        
                        // Snap to 1/192
                        const subdivisions = 192;
                        const snapped_fraction = Math.round(fraction * subdivisions) / subdivisions;
                        
                        global_y = grid_start + (snapped_fraction * segment_height);
                        
                        // Convert back to time
                        finalNoteTime = metadata.start_time + (global_y / metadata.speed) / metadata.fps;
                    }
                }
                finalGlobalY = global_y;
            }

            // Calculate Chunk Index and Y for WaterfallViewer
            // Assuming 2000px chunks (standard)
            const CHUNK_HEIGHT_STD = 2000;
            const chunk_index = Math.floor(finalGlobalY / CHUNK_HEIGHT_STD);
            
            // Try to find height of this chunk from existing notes to handle non-standard chunks (e.g. last one)
            const existingNoteInChunk = notes.find(n => n.chunk_index === chunk_index);
            const actual_chunk_height = existingNoteInChunk?.chunk_height || CHUNK_HEIGHT_STD;

            // In waterfall, y=0 is top (latest), y=H is bottom (earliest).
            // global_y increases with time (latest).
            // global_y = base + (H - y)
            // y = H - (global_y - base)
            // base = chunk_index * CHUNK_HEIGHT_STD (Assuming standard slicing)
            
            const base_y = chunk_index * CHUNK_HEIGHT_STD;
            const offset_in_chunk = finalGlobalY - base_y;
            
            const chunk_y = actual_chunk_height - offset_in_chunk;

            const newNote: Note = {
                chunk_index: chunk_index,
                chunk_height: actual_chunk_height,
                lane: clickedLane,
                y: chunk_y,
                h: defaultH, 
                time: finalNoteTime,
                type: 'hit'
            };
            
            // Insert and sort
            const newNotes = [...notes, newNote].sort((a, b) => (a.time || 0) - (b.time || 0));
            setNotes(newNotes);
        }
    };

    const jumpAmount = useMemo(() => {
        if (visualSpeed <= 0 || videoRect.height <= 0) return 2.0;
        return (videoRect.height / visualSpeed) / 2;
    }, [visualSpeed, videoRect.height]);

    const handleJump = (direction: -1 | 1) => {
        if (!videoRef.current) return;
        const current = videoRef.current.currentTime;
        const target = current + (direction * jumpAmount);
        handleSeek(Math.max(0, Math.min(duration, target)));
    };

    useHotkeys([
        ['Space', togglePlay],
        ['ArrowLeft', () => handleJump(-1)],
        ['ArrowRight', () => handleJump(1)],
        ['A', () => handleJump(-1)],
        ['D', () => handleJump(1)],
    ]);

    return (
        <Modal opened={opened} onClose={onClose} title="Preview & Edit" size="100%" fullScreen>
            <Stack h="90vh">
                <div ref={containerRef} style={{ position: 'relative', flex: 1, backgroundColor: '#000', overflow: 'hidden' }}>
                    <video
                        ref={videoRef}
                        src={`/workspace/${videoFilename}`}
                        style={{ 
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'contain', 
                            opacity: 0.5 // Dimmed background
                        }}
                        onLoadedMetadata={() => {
                            setDuration(videoRef.current?.duration || 0);
                            updateLayout();

                            if (!initialSeekDone.current && notes.length > 0) {
                                const firstNoteTime = notes[0].time || 0;
                                const startTime = Math.max(0, firstNoteTime - 1.0);
                                if (videoRef.current) {
                                    videoRef.current.currentTime = startTime;
                                    setCurrentTime(startTime);
                                }
                                initialSeekDone.current = true;
                            }
                        }}
                        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                        onEnded={() => setIsPlaying(false)}
                    />
                    <canvas
                        ref={canvasRef}
                        style={{
                            position: 'absolute',
                            left: videoRect.left,
                            top: videoRect.top,
                            width: videoRect.width,
                            height: videoRect.height,
                            cursor: 'pointer'
                        }}
                        onClick={handleCanvasClick}
                    />
                </div>

                <Group>
                    <ActionIcon onClick={togglePlay} variant="filled" size="xl">
                        {isPlaying ? <Pause /> : <Play />}
                    </ActionIcon>
                    
                    <Slider 
                        style={{ flex: 1 }}
                        min={0}
                        max={duration}
                        step={0.01}
                        value={currentTime}
                        onChange={handleSeek}
                        label={(val) => val.toFixed(2) + 's'}
                    />
                    
                    <Text size="sm">{currentTime.toFixed(2)} / {duration.toFixed(2)}s</Text>
                    
                    <Text size="sm">Speed:</Text>
                    <Slider
                        w={100}
                        min={0.1}
                        max={2.0}
                        step={0.1}
                        value={playbackRate}
                        onChange={(val) => {
                            setPlaybackRate(val);
                            if (videoRef.current) videoRef.current.playbackRate = val;
                        }}
                    />

                    <Text size="sm">Offset (ms):</Text>
                    <Slider
                        w={100}
                        min={-200}
                        max={200}
                        step={1}
                        value={visualOffset}
                        onChange={setVisualOffset}
                    />
                </Group>
                <Text size="xs" c="dimmed">
                    Click on a note to DELETE. Click on an empty lane to ADD a note at that position.
                </Text>
            </Stack>
        </Modal>
    );
}
