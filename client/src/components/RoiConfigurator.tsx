import { useEffect, useRef, useState } from 'react';
import { Box, Button, Group, Paper, Text, Stack, Loader, RangeSlider, Slider, ActionIcon, Tooltip, Select, TextInput } from '@mantine/core';
import { Play, Pause, Flag, Settings } from 'lucide-react';
import { useAtom } from 'jotai';
import { videoFilenameAtom, scanLineYAtom, trackX1Atom, trackX2Atom, isProcessingAtom, processingResultAtom, videoStartTimeAtom, videoEndTimeAtom, scrollSpeedAtom, laneRatiosAtom, lanePresetsAtom, hitLineYAtom } from '../store';
import { SpeedCalibrator } from './SpeedCalibrator';
import { LaneConfigurator } from './LaneConfigurator';

export function RoiConfigurator() {
  const [videoFilename] = useAtom(videoFilenameAtom);
  const [scanLineY, setScanLineY] = useAtom(scanLineYAtom);
  const [hitLineY, setHitLineY] = useAtom(hitLineYAtom);
  const [trackX1, setTrackX1] = useAtom(trackX1Atom);
  const [trackX2, setTrackX2] = useAtom(trackX2Atom);
  const [startTime, setStartTime] = useAtom(videoStartTimeAtom);
  const [endTime, setEndTime] = useAtom(videoEndTimeAtom);
  const [scrollSpeed, setScrollSpeed] = useAtom(scrollSpeedAtom);
  const [laneRatios, setLaneRatios] = useAtom(laneRatiosAtom);
  const [lanePresets] = useAtom(lanePresetsAtom);
  const [isProcessing, setIsProcessing] = useAtom(isProcessingAtom);
  const [, setProcessingResult] = useAtom(processingResultAtom);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [preset, setPreset] = useState<string>('custom');
  const [ratiosString, setRatiosString] = useState(laneRatios.join(', '));

  // Sync string when atom changes (e.g. from storage or preset)
  useEffect(() => {
      setRatiosString(laneRatios.join(', '));
  }, [laneRatios]);

  // Calibration Modal State
  const [calibrationOpened, setCalibrationOpened] = useState(false);
  const [laneConfigOpened, setLaneConfigOpened] = useState(false);

  // Handle video load to set canvas size
  const onVideoLoaded = () => {
    if (videoRef.current) {
      setVideoSize({
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight
      });
      const vidDuration = videoRef.current.duration;
      setDuration(vidDuration);
      setEndTime(vidDuration);
      
      // Set default values if not set
      if (trackX2 === 500) setTrackX2(videoRef.current.videoWidth - 100);
    }
  };

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

  const handleSetStart = () => {
      setStartTime(currentTime);
  };

  const handleSetEnd = () => {
      setEndTime(currentTime);
  };

  const onTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Sync video time when slider changes (preview)
  const handleTimeChange = (value: [number, number]) => {
    // Determine which value changed to seek to that point
    if (videoRef.current) {
      if (Math.abs(value[0] - startTime) > 0.1) {
        videoRef.current.currentTime = value[0];
      } else if (Math.abs(value[1] - endTime) > 0.1) {
        videoRef.current.currentTime = value[1];
      }
    }
    setStartTime(value[0]);
    setEndTime(value[1]);
  };

  // Mouse interaction for dragging lines
  const [dragging, setDragging] = useState<'y' | 'hitY' | 'x1' | 'x2' | null>(null);

  const handleMouseDown = (type: 'y' | 'hitY' | 'x1' | 'x2') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(type);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = videoSize.width / rect.width;
    const scaleY = videoSize.height / rect.height;
    const videoY = Math.floor(y * scaleY);

    if (!dragging) return;

    if (dragging === 'y') setScanLineY(Math.max(0, Math.min(videoSize.height, videoY)));
    if (dragging === 'hitY') setHitLineY(Math.max(0, Math.min(videoSize.height, videoY)));
    if (dragging === 'x1') setTrackX1(Math.max(0, Math.min(trackX2 - 10, Math.floor(x * scaleX))));
    if (dragging === 'x2') setTrackX2(Math.max(trackX1 + 10, Math.min(videoSize.width, Math.floor(x * scaleX))));
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const handlePresetChange = (val: string | null) => {
    if (!val) return;
    setPreset(val);
    if (lanePresets[val]) {
        setLaneRatios(lanePresets[val]);
    } else if (val === 'custom') {
        // Do nothing, keep current
    }
  };

  const handleRatiosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRatiosString(val);
    setPreset('custom');
    
    const parts = val.split(',').map(s => parseFloat(s.trim()));
    if (parts.length > 0 && parts.every(n => !isNaN(n) && n > 0)) {
        setLaneRatios(parts);
    }
  };

  const handleProcess = async () => {
    if (!videoFilename) return;
    setIsProcessing(true);
    try {
      const res = await fetch('/api/process/slit-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFilename,
          y: scanLineY,
          x1: trackX1,
          x2: trackX2,
          startTime,
          endTime,
          speed: scrollSpeed
        })
      });
      const data = await res.json();
      if (data.status === 'completed') {
        setProcessingResult({ ...data, timestamp: Date.now() });
      } else {
        alert('Processing failed: ' + JSON.stringify(data));
      }
    } catch (e) {
      console.error(e);
      alert('Error triggering processing');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!videoFilename) return <Text>Please select a video first.</Text>;

  return (
    <Stack>
      <Paper p="md" withBorder>
        <Group justify="space-between" mb="xs">
            <Text fw={700}>ROI Configuration</Text>
        </Group>

        <Text size="sm" mb="md">
        Drag the <span style={{ color: 'red' }}>Red Line</span> to set the Scan Line (Y).<br/>
        Drag the <span style={{ color: '#00ff00' }}>Green Line</span> to set the Hit Line (Y).<br/>
        Drag the <span style={{ color: 'cyan' }}>Blue Lines</span> to set the Track Bounds (X1, X2).
        </Text>
        
        <div 
          ref={containerRef}
          style={{ position: 'relative', display: 'inline-block', cursor: dragging ? 'grabbing' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <video
            ref={videoRef}
            src={`/workspace/${videoFilename}`}
            controls={false}
            onLoadedMetadata={onVideoLoaded}
            onTimeUpdate={onTimeUpdate}
            style={{ maxWidth: '100%', display: 'block' }}
          />
          
          {/* Overlays */}
          {videoSize.width > 0 && (
            <>
              {/* Scan Line Y */}
              <div
                style={{
                  position: 'absolute',
                  top: `${(scanLineY / videoSize.height) * 100}%`,
                  left: 0,
                  right: 0,
                  height: 2,
                  backgroundColor: 'red',
                  cursor: 'ns-resize',
                  zIndex: 10,
                }}
                onMouseDown={handleMouseDown('y')}
              />

              {/* Hit Line Y */}
              <div
                style={{
                  position: 'absolute',
                  top: `${(hitLineY / videoSize.height) * 100}%`,
                  left: 0,
                  right: 0,
                  height: 2,
                  backgroundColor: '#00ff00',
                  cursor: 'ns-resize',
                  zIndex: 10,
                }}
                onMouseDown={handleMouseDown('hitY')}
              />
              
              {/* Track X1 */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(trackX1 / videoSize.width) * 100}%`,
                  width: 2,
                  backgroundColor: 'cyan',
                  cursor: 'ew-resize',
                  zIndex: 10,
                }}
                onMouseDown={handleMouseDown('x1')}
              />

              {/* Track X2 */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(trackX2 / videoSize.width) * 100}%`,
                  width: 2,
                  backgroundColor: 'cyan',
                  cursor: 'ew-resize',
                  zIndex: 10,
                }}
                onMouseDown={handleMouseDown('x2')}
              />
              
              {/* Visual Guide for Lanes */}
              <div style={{
                position: 'absolute',
                top: `${(scanLineY / videoSize.height) * 100}%`,
                left: `${(trackX1 / videoSize.width) * 100}%`,
                width: `${((trackX2 - trackX1) / videoSize.width) * 100}%`,
                height: '20px',
                display: 'flex',
                pointerEvents: 'none',
                opacity: 0.5
              }}>
                {laneRatios.map((ratio, i) => (
                  <div key={i} style={{ 
                      flex: ratio, 
                      borderRight: '1px solid yellow', 
                      borderLeft: i === 0 ? '1px solid yellow' : 'none',
                      backgroundColor: 'rgba(255, 255, 0, 0.1)'
                  }} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Custom Controls */}
        <Group mt="xs" align="center">
            <ActionIcon onClick={togglePlay} variant="filled" size="lg">
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </ActionIcon>
            
            <Slider 
                style={{ flex: 1 }}
                min={0}
                max={duration}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                label={(val) => val.toFixed(1) + 's'}
            />
            <Text size="xs" style={{ minWidth: 80, textAlign: 'right' }}>
                {currentTime.toFixed(1)} / {duration.toFixed(1)}s
            </Text>

            <Group gap="xs">
                <Tooltip label="Set Start Time">
                    <ActionIcon onClick={handleSetStart} color="green" variant="light">
                        <Flag size={16} />
                    </ActionIcon>
                </Tooltip>
                <Tooltip label="Set End Time">
                    <ActionIcon onClick={handleSetEnd} color="red" variant="light">
                        <Flag size={16} />
                    </ActionIcon>
                </Tooltip>
            </Group>
        </Group>

        <Group mt="md">
          <Text size="xs">Scan Y: {scanLineY}</Text>
          <Text size="xs">Hit Y: {hitLineY}</Text>
          <Text size="xs">X1: {trackX1}</Text>
          <Text size="xs">X2: {trackX2}</Text>
        </Group>

        {duration > 0 && (
          <Box mt="md">
            <Text size="sm" mb="xs">Video Range (Start - End)</Text>
            <RangeSlider
              min={0}
              max={duration}
              step={0.1}
              minRange={1}
              value={[startTime, endTime]}
              onChange={handleTimeChange}
              label={(val) => val.toFixed(1) + 's'}
            />
            <Group justify="space-between" mt="xs">
              <Text size="xs">{startTime.toFixed(1)}s</Text>
              <Text size="xs">{endTime.toFixed(1)}s</Text>
            </Group>
          </Box>
        )}

        <Box mt="md">
          <Text size="sm" mb="xs">Lane Configuration</Text>
          <Group>
              <Select 
                  data={[
                      ...Object.keys(lanePresets).map(k => ({ value: k, label: k })),
                      { value: 'custom', label: 'Custom' }
                  ]}
                  value={preset}
                  onChange={handlePresetChange}
                  w={200}
              />
              <TextInput 
                  placeholder="1, 1.5, 1, ..." 
                  value={ratiosString}
                  onChange={handleRatiosChange}
                  style={{ flex: 1 }}
              />
              <Tooltip label="Interactive Editor">
                  <ActionIcon variant="light" size="lg" onClick={() => setLaneConfigOpened(true)}>
                      <Settings size={20} />
                  </ActionIcon>
              </Tooltip>
          </Group>
        </Box>

        <Box mt="md">
          <Group justify="space-between" mb="xs">
              <Text size="sm">Scroll Speed (px/frame) - Adjust to match note speed</Text>
              <Button variant="outline" size="xs" onClick={() => setCalibrationOpened(true)}>Calibrate Speed</Button>
          </Group>
          <Slider
            min={1}
            max={50}
            step={0.1}
            value={scrollSpeed}
            onChange={setScrollSpeed}
            label={(val) => val.toFixed(1)}
          />
        </Box>

        <Button mt="md" onClick={handleProcess} disabled={isProcessing}>
          {isProcessing ? <Loader size="xs" mr="xs" /> : null}
          Generate Waterfall Chart
        </Button>
      </Paper>

      <SpeedCalibrator opened={calibrationOpened} onClose={() => setCalibrationOpened(false)} />
      <LaneConfigurator 
        opened={laneConfigOpened} 
        onClose={() => setLaneConfigOpened(false)} 
        videoElement={videoRef.current}
      />
    </Stack>
  );
}
