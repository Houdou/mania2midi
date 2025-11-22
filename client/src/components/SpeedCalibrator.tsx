import { useState, useEffect } from 'react';
import { Modal, Button, Group, Text, Image, Stack, LoadingOverlay, Box, ScrollArea } from '@mantine/core';
import { useAtom } from 'jotai';
import { videoFilenameAtom, videoStartTimeAtom, scrollSpeedAtom } from '../store';

interface SpeedCalibratorProps {
  opened: boolean;
  onClose: () => void;
}

export function SpeedCalibrator({ opened, onClose }: SpeedCalibratorProps) {
  const [videoFilename] = useAtom(videoFilenameAtom);
  const [startTime] = useAtom(videoStartTimeAtom);
  const [, setScrollSpeed] = useAtom(scrollSpeedAtom);

  const [loading, setLoading] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState<string>('');
  const [interval, setInterval] = useState<number>(10);
  const [activeStep, setActiveStep] = useState(0);
  
  // Store clicks as { frameIndex: number, y: number }
  const [clicks, setClicks] = useState<{ [key: number]: number }>({});

  // Fetch frames when modal opens
  useEffect(() => {
    if (opened && videoFilename) {
      fetchFrames();
    } else {
        // Reset state on close
        setFrames([]);
        setClicks({});
        setActiveStep(0);
    }
  }, [opened, videoFilename]);

  const fetchFrames = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/extract-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFilename,
          startTime: startTime + 1, // Start 1 second after the range start to avoid intro static
          count: 5,
          interval: 5 // 5 frames apart
        })
      });
      const data = await res.json();
      if (data.status === 'completed') {
        setFrames(data.files);
        setOutputDir(data.outputDir);
        setInterval(data.interval);
        setClicks({});
        setActiveStep(0);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to fetch calibration frames');
    } finally {
      setLoading(false);
    }
  };

  const handleImageClick = (index: number, e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const scaleY = e.currentTarget.naturalHeight / rect.height;
    const actualY = y * scaleY;

    setClicks(prev => ({ ...prev, [index]: actualY }));
    
    // Auto advance
    if (activeStep < frames.length) {
        setActiveStep(prev => prev + 1);
    }
  };

  const calculateSpeed = () => {
    const indices = Object.keys(clicks).map(Number).sort((a, b) => a - b);
    if (indices.length < 2) return 0;

    let totalSpeed = 0;
    let count = 0;

    for (let i = 0; i < indices.length - 1; i++) {
      const idx1 = indices[i];
      const idx2 = indices[i+1];
      const y1 = clicks[idx1];
      const y2 = clicks[idx2];
      
      const frameDiff = (idx2 - idx1) * interval;
      const pixelDiff = y2 - y1;
      
      // Speed = pixels / frame
      const speed = pixelDiff / frameDiff;
      
      // Only count positive speeds (downward movement)
      if (speed > 0) {
          totalSpeed += speed;
          count++;
      }
    }

    return count > 0 ? totalSpeed / count : 0;
  };

  const calculatedSpeed = calculateSpeed();

  const handleApply = () => {
    if (calculatedSpeed > 0) {
      setScrollSpeed(parseFloat(calculatedSpeed.toFixed(2)));
      onClose();
    }
  };

  const handleBack = () => {
      setActiveStep(prev => Math.max(0, prev - 1));
  };

  const handleReset = () => {
      setClicks({});
      setActiveStep(0);
  };

  const isFinished = activeStep >= frames.length && frames.length > 0;

  return (
    <Modal opened={opened} onClose={onClose} title="Speed Calibration" size="fullScreen">
      <LoadingOverlay visible={loading} />
      <Stack h="100%">
        {!isFinished ? (
            <>
                <Group justify="space-between">
                    <Text size="sm">
                    Step {activeStep + 1} of {frames.length}: Click on a <b>distinct note or bar line</b>.
                    </Text>
                    <Group>
                        <Button variant="default" onClick={handleBack} disabled={activeStep === 0}>Back</Button>
                        <Button variant="subtle" color="red" onClick={handleReset}>Reset</Button>
                    </Group>
                </Group>
                
                <ScrollArea w="100%" style={{ flex: 1 }}>
                    {frames[activeStep] && (
                        <Box style={{ position: 'relative', display: 'inline-block' }}>
                            <Image
                                src={`/workspace/${outputDir}/${frames[activeStep]}`}
                                onClick={(e) => handleImageClick(activeStep, e)}
                                style={{ cursor: 'crosshair', maxWidth: 'none' }} // Ensure full size or controlled size
                            />
                             {clicks[activeStep] !== undefined && (
                                <div
                                    style={{
                                    position: 'absolute',
                                    top: `${(clicks[activeStep] / 1080) * 100}%`, 
                                    left: 0, right: 0,
                                    height: 2,
                                    backgroundColor: 'red',
                                    pointerEvents: 'none',
                                    }}
                                />
                            )}
                        </Box>
                    )}
                </ScrollArea>
            </>
        ) : (
            <Stack align="center" justify="center" style={{ flex: 1 }}>
                <Text size="xl" fw={700}>Calibration Complete</Text>
                <Text size="lg">Calculated Speed: <b>{calculatedSpeed.toFixed(2)}</b> px/frame</Text>
                
                <Group mt="xl">
                    <Button variant="default" onClick={handleReset}>Redo</Button>
                    <Button size="lg" onClick={handleApply} disabled={calculatedSpeed <= 0}>
                        Apply Speed
                    </Button>
                </Group>
            </Stack>
        )}
      </Stack>
    </Modal>
  );
}
