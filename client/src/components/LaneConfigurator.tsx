import { Modal, Button, Group, Stack, Text, TextInput, NumberInput } from '@mantine/core';
import { useAtom } from 'jotai';
import { useState, useEffect, useRef } from 'react';
import { laneRatiosAtom, lanePresetsAtom, trackX1Atom, trackX2Atom } from '../store';
import { Save, RotateCcw } from 'lucide-react';

interface LaneConfiguratorProps {
    opened: boolean;
    onClose: () => void;
    videoElement: HTMLVideoElement | null;
}

export function LaneConfigurator({ opened, onClose, videoElement }: LaneConfiguratorProps) {
    const [laneRatios, setLaneRatios] = useAtom(laneRatiosAtom);
    const [, setPresets] = useAtom(lanePresetsAtom);
    const [trackX1] = useAtom(trackX1Atom);
    const [trackX2] = useAtom(trackX2Atom);

    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [dividers, setDividers] = useState<number[]>([]); // Percentages 0-100 within the track width
    const [presetName, setPresetName] = useState('');
    const [laneCount, setLaneCount] = useState(9);
    
    const containerRef = useRef<HTMLDivElement>(null);
    const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

    // Capture frame when opened
    useEffect(() => {
        if (opened && videoElement) {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                setImageSrc(canvas.toDataURL());
            }
            
            // Initialize dividers from current ratios
            const total = laneRatios.reduce((a, b) => a + b, 0);
            let current = 0;
            const newDividers = [];
            // We need N-1 dividers for N lanes
            for (let i = 0; i < laneRatios.length - 1; i++) {
                current += laneRatios[i];
                newDividers.push((current / total) * 100);
            }
            setDividers(newDividers);
            setLaneCount(laneRatios.length);
        }
    }, [opened, videoElement]); // eslint-disable-line react-hooks/exhaustive-deps

    // Update lane count
    const handleLaneCountChange = (val: number | string) => {
        const newCount = typeof val === 'number' ? val : parseInt(val);
        if (isNaN(newCount) || newCount < 1) return;
        
        setLaneCount(newCount);
        
        // Resample dividers to be equal width for new count
        const newDividers = [];
        for (let i = 1; i < newCount; i++) {
            newDividers.push((i / newCount) * 100);
        }
        setDividers(newDividers);
    };

    // Handle Dragging
    const handleMouseMove = (e: React.MouseEvent) => {
        if (draggingIdx === null || !containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        // The container displays the FULL video image.
        // But the dividers are relative to the TRACK area (trackX1 to trackX2).
        // We need to map mouse X to percentage within track area.
        
        // Calculate Track bounds in screen coordinates
        // We assume the image fills the container width-wise (or we need to handle aspect ratio)
        // To keep it simple, let's assume the image is displayed with width=100%
        
        const scaleX = videoElement ? videoElement.videoWidth / rect.width : 1;
        
        // Mouse X relative to container
        const mouseX = (e.clientX - rect.left) * scaleX;
        
        // Mouse X relative to Track Start
        const trackRelX = mouseX - trackX1;
        const trackWidth = trackX2 - trackX1;
        
        let newPct = (trackRelX / trackWidth) * 100;
        newPct = Math.max(0, Math.min(100, newPct));
        
        // Constrain against neighbors
        const prevLimit = draggingIdx > 0 ? dividers[draggingIdx - 1] : 0;
        const nextLimit = draggingIdx < dividers.length - 1 ? dividers[draggingIdx + 1] : 100;
        
        // Add a small buffer so they don't overlap completely
        newPct = Math.max(prevLimit + 1, Math.min(nextLimit - 1, newPct));
        
        const newDividers = [...dividers];
        newDividers[draggingIdx] = newPct;
        setDividers(newDividers);
    };

    const handleMouseUp = () => {
        setDraggingIdx(null);
    };

    const handleSave = () => {
        // Convert dividers to ratios
        const ratios: number[] = [];
        let lastPos = 0;
        for (const pos of dividers) {
            ratios.push(pos - lastPos);
            lastPos = pos;
        }
        ratios.push(100 - lastPos);
        
        // Normalize? Not strictly necessary as they sum to 100, but let's keep them as is.
        setLaneRatios(ratios);
        onClose();
    };

    const handleSavePreset = () => {
        if (!presetName) return;
        
        // Convert dividers to ratios
        const ratios: number[] = [];
        let lastPos = 0;
        for (const pos of dividers) {
            ratios.push(pos - lastPos);
            lastPos = pos;
        }
        ratios.push(100 - lastPos);
        
        setPresets(prev => ({
            ...prev,
            [presetName]: ratios
        }));
        alert(`Preset "${presetName}" saved!`);
    };

    return (
        <Modal opened={opened} onClose={onClose} title="Interactive Lane Configuration" size="xl">
            <Stack>
                <Text size="sm">
                    Adjust the number of lanes and drag the dividers to match the video.
                </Text>
                
                <Group>
                    <NumberInput 
                        label="Lane Count" 
                        value={laneCount} 
                        onChange={handleLaneCountChange} 
                        min={1} 
                        max={20} 
                        w={100}
                    />
                    <Button variant="light" onClick={() => handleLaneCountChange(laneCount)} leftSection={<RotateCcw size={16}/>}>
                        Reset to Equal
                    </Button>
                </Group>

                <div 
                    ref={containerRef}
                    style={{ position: 'relative', userSelect: 'none' }}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {imageSrc && (
                        <img src={imageSrc} style={{ width: '100%', display: 'block' }} alt="Frame" />
                    )}
                    
                    {/* Track Area Highlight */}
                    {videoElement && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${(trackX1 / videoElement.videoWidth) * 100}%`,
                            width: `${((trackX2 - trackX1) / videoElement.videoWidth) * 100}%`,
                            backgroundColor: 'rgba(0, 255, 255, 0.1)',
                            borderLeft: '2px solid cyan',
                            borderRight: '2px solid cyan',
                            pointerEvents: 'none'
                        }} />
                    )}

                    {/* Dividers */}
                    {videoElement && dividers.map((pct, i) => {
                        // Calculate absolute left percentage for the divider
                        // Pct is relative to track width
                        const trackWidthPct = ((trackX2 - trackX1) / videoElement.videoWidth) * 100;
                        const trackLeftPct = (trackX1 / videoElement.videoWidth) * 100;
                        const absLeft = trackLeftPct + (pct / 100 * trackWidthPct);
                        
                        return (
                            <div
                                key={i}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: `calc(${absLeft}% - 2px)`, // Center the 4px hit area
                                    width: 4,
                                    cursor: 'ew-resize',
                                    zIndex: 10,
                                    display: 'flex',
                                    justifyContent: 'center'
                                }}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setDraggingIdx(i);
                                }}
                            >
                                <div style={{ width: 2, height: '100%', backgroundColor: 'yellow' }} />
                            </div>
                        );
                    })}
                </div>

                <Group align="end">
                    <TextInput 
                        label="Save as Preset" 
                        placeholder="Preset Name" 
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                    />
                    <Button onClick={handleSavePreset} disabled={!presetName} variant="outline" leftSection={<Save size={16}/>}>
                        Save Preset
                    </Button>
                    <div style={{ flex: 1 }} />
                    <Button onClick={handleSave}>Apply Changes</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
