import { Modal, Button, Group, Stack, Text, Slider, ActionIcon, Box } from '@mantine/core';
import { useAtom } from 'jotai';
import { useState, useEffect, useRef } from 'react';
import { videoFilenameAtom, scanLineYAtom, trackX1Atom, trackX2Atom, laneRatiosAtom, scrollSpeedAtom } from '../store';
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
}

export function NoteEditor({ opened, onClose, notes, setNotes }: NoteEditorProps) {
    const [videoFilename] = useAtom(videoFilenameAtom);
    const [scanLineY] = useAtom(scanLineYAtom);
    const [trackX1] = useAtom(trackX1Atom);
    const [trackX2] = useAtom(trackX2Atom);
    const [laneRatios] = useAtom(laneRatiosAtom);
    const [scrollSpeed] = useAtom(scrollSpeedAtom); // pixels per frame

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    
    // Visual Hit Line (defaults to Scan Line)
    const [hitLineY, setHitLineY] = useState(scanLineY);
    
    // Update hitLineY when scanLineY changes (initial load)
    useEffect(() => {
        setHitLineY(scanLineY);
    }, [scanLineY]);

    // Animation Loop
    useEffect(() => {
        let animationFrameId: number;

        const render = () => {
            if (!videoRef.current || !canvasRef.current) return;
            
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Sync canvas size
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
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
            ctx.setLineDash([]);

            // Draw Hit Line (Green - Target)
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, hitLineY);
            ctx.lineTo(canvas.width, hitLineY);
            ctx.stroke();

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
            const VISUAL_SPEED = 500; 

            const timeWindow = 2.0; // Show notes within +/- 2 seconds

            notes.forEach(note => {
                if (note.time === undefined) return;
                
                const deltaT = note.time - video.currentTime;
                
                if (Math.abs(deltaT) > timeWindow) return;

                // Y position relative to HIT line
                // Y = hitLineY - (deltaT * VISUAL_SPEED)
                const noteY = hitLineY - (deltaT * VISUAL_SPEED);
                
                const lane = lanePositions[note.lane];
                if (!lane) return;

                // Draw Note Rect
                ctx.fillStyle = deltaT > 0 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(0, 255, 0, 0.4)'; // Dim if past
                
                // Highlight if very close to hit (within 50ms)
                if (Math.abs(deltaT) < 0.05) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                }

                const noteH = note.h || 20; // Use detected height or default
                
                // Center the note vertically on the calculated Y
                ctx.fillRect(lane.x + 2, noteY - noteH/2, lane.w - 4, noteH);
            });

            if (isPlaying) {
                setCurrentTime(video.currentTime);
                animationFrameId = requestAnimationFrame(render);
            }
        };

        if (isPlaying) {
            animationFrameId = requestAnimationFrame(render);
        } else {
            render(); // Render once when paused
        }

        return () => cancelAnimationFrame(animationFrameId);
    }, [isPlaying, currentTime, notes, scanLineY, hitLineY, trackX1, trackX2, laneRatios]);

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
        
        const VISUAL_SPEED = 500;
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
            const noteY = hitLineY - (deltaT * VISUAL_SPEED);
            const noteH = note.h || 20;
            
            // Simple box check
            return Math.abs(y - noteY) < (noteH / 2 + 5); // +5 padding
        });

        if (hitNoteIndex !== -1) {
            // Delete note
            const newNotes = [...notes];
            newNotes.splice(hitNoteIndex, 1);
            setNotes(newNotes);
        } else {
            // Add note
            // Calculate time from Y
            // Y = hitLineY - (deltaT * VISUAL_SPEED)
            // deltaT = (hitLineY - Y) / VISUAL_SPEED
            // time = currentTime + deltaT
            
            const deltaT = (hitLineY - y) / VISUAL_SPEED;
            const noteTime = videoRef.current.currentTime + deltaT;
            
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
                <div style={{ position: 'relative', flex: 1, backgroundColor: '#000', overflow: 'hidden' }}>
                    <video
                        ref={videoRef}
                        src={`/workspace/${videoFilename}`}
                        style={{ 
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'contain', 
                            opacity: 0.5 // Dimmed background
                        }}
                        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                        onEnded={() => setIsPlaying(false)}
                    />
                    <canvas
                        ref={canvasRef}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
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
                    
                    <Text size="sm">Hit Line Y:</Text>
                    <Slider
                        w={100}
                        min={0}
                        max={canvasRef.current?.height || 1080}
                        value={hitLineY}
                        onChange={setHitLineY}
                    />
                </Group>
                <Text size="xs" c="dimmed">
                    Click on a note to DELETE. Click on an empty lane to ADD a note at that position.
                </Text>
            </Stack>
        </Modal>
    );
}
