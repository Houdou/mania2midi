import { Modal, Button, Group, Stack, Text, Slider, ActionIcon, Box } from '@mantine/core';
import { useAtom } from 'jotai';
import { useState, useEffect, useRef, useMemo } from 'react';
import { videoFilenameAtom, scanLineYAtom, trackX1Atom, trackX2Atom, laneRatiosAtom, scrollSpeedAtom, hitLineYAtom, visualOffsetAtom } from '../store';
import { Play, Pause, Trash, Plus } from 'lucide-react';

interface Note {
  chunk_index: number;
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
}

export function NoteEditor({ opened, onClose, notes, setNotes, metadata }: NoteEditorProps) {
    const [videoFilename] = useAtom(videoFilenameAtom);
    const [scanLineY] = useAtom(scanLineYAtom);
    const [trackX1] = useAtom(trackX1Atom);
    const [trackX2] = useAtom(trackX2Atom);
    const [laneRatios] = useAtom(laneRatiosAtom);
    const [configScrollSpeed] = useAtom(scrollSpeedAtom); // px/frame
    const [hitLineY] = useAtom(hitLineYAtom);
    const [visualOffset, setVisualOffset] = useAtom(visualOffsetAtom);

    const videoRef = useRef<HTMLVideoElement>(null);
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

    // Animation Loop
    useEffect(() => {
        let animationFrameId: number;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        const render = () => {
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

            // Draw Notes
            // We want to visualize notes falling towards the HIT line.
            // Note Time = T_hit.
            // Current Time = T_now.
            // Delta T = T_hit - T_now.
            // If Delta T > 0, note is approaching (above line).
            // If Delta T < 0, note is past (below line).
            // Distance = Delta T * Speed (pixels/sec).
            const VISUAL_SPEED = visualSpeed; 

            const timeWindow = 2.0; // Show notes within +/- 2 seconds

            notes.forEach(note => {
                if (note.time === undefined) return;
                
                // Apply visual offset (ms -> s)
                const adjustedTime = note.time + (visualOffset / 1000);
                const deltaT = adjustedTime - video.currentTime;
                
                if (Math.abs(deltaT) > timeWindow) return;

                // Y position relative to SCAN line (where detection happened)
                // Y = scanLineY - (deltaT * VISUAL_SPEED)
                // This ensures the note overlay matches the video content at the scan line.
                const noteY = scanLineY - (deltaT * VISUAL_SPEED);
                
                const lane = lanePositions[note.lane];
                if (!lane) return;

                // Draw Note Rect
                ctx.fillStyle = deltaT > 0 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(0, 255, 0, 0.4)'; // Dim if past
                
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

            if (isPlaying) {
                if ('requestVideoFrameCallback' in video) {
                    animationFrameId = (video as any).requestVideoFrameCallback(render);
                } else {
                    animationFrameId = requestAnimationFrame(render);
                }
            }
        };

        if (isPlaying) {
            if (video && 'requestVideoFrameCallback' in video) {
                animationFrameId = (video as any).requestVideoFrameCallback(render);
            } else {
                animationFrameId = requestAnimationFrame(render);
            }
        } else {
            render(); // Render once when paused
        }

        return () => {
            if (video && 'cancelVideoFrameCallback' in video) {
                (video as any).cancelVideoFrameCallback(animationFrameId);
            } else {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [isPlaying, notes, scanLineY, hitLineY, trackX1, trackX2, laneRatios, visualSpeed, metadata, visualOffset]);

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
            const deltaT = note.time - videoRef.current!.currentTime;
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
            // Y = scanLineY - (deltaT * VISUAL_SPEED)
            // deltaT = (scanLineY - Y) / VISUAL_SPEED
            // time = currentTime + deltaT
            
            const deltaT = (scanLineY - y) / VISUAL_SPEED;
            const noteTime = videoRef.current.currentTime + deltaT;
            
            // Default height logic for new note?
            // We don't have 'h' (pixels in waterfall) for a new note easily.
            // We can set a default duration, e.g. 0.1s
            // h = duration * fps * speed
            // Let's just set a default h that results in ~20px visual height at current speed?
            // Or just set h=20 and let the render logic handle it (fallback).
            
            const newNote: Note = {
                chunk_index: -1, // Dummy
                lane: clickedLane,
                y: 0, // Dummy
                h: 20, // Default height
                time: noteTime,
                type: 'hit'
            };
            
            // Insert and sort
            const newNotes = [...notes, newNote].sort((a, b) => (a.time || 0) - (b.time || 0));
            setNotes(newNotes);
        }
    };

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
