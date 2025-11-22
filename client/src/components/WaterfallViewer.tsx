import { useState } from 'react';
import { useAtom } from 'jotai';
import { processingResultAtom, videoFilenameAtom, laneRatiosAtom } from '../store';
import { Image, Paper, Text, Button, Group, Slider, Box, Loader, ActionIcon, Tooltip } from '@mantine/core';
import { Play } from 'lucide-react';
import { NoteEditor } from './NoteEditor';

interface Note {
  chunk_index: number;
  chunk_height?: number;
  lane: number;
  y: number;
  h: number;
  time?: number;
  type: string;
}

export function WaterfallViewer() {
  const [result] = useAtom(processingResultAtom);
  const [videoFilename] = useAtom(videoFilenameAtom);
  const [laneRatios] = useAtom(laneRatiosAtom);
  
  const [notes, setNotes] = useState<Note[]>([]);
  const [bpm, setBpm] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [threshold, setThreshold] = useState(200);
  const [zoom, setZoom] = useState(50);
  const [editorOpened, setEditorOpened] = useState(false);

  if (!result) return null;

  const handleDetect = async () => {
    if (!videoFilename) return;
    setDetecting(true);
    setNotes([]); // Clear previous results
    try {
      const res = await fetch('/api/process/detect-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFilename,
          threshold,
          laneRatios
        })
      });
      const data = await res.json();
      if (data.status === 'completed') {
        // Handle new format { notes, bpm, bar_lines } or old format [notes]
        if (Array.isArray(data.notes)) {
            setNotes(data.notes);
            setBpm(null);
        } else {
            setNotes(data.notes.notes);
            setBpm(data.notes.bpm);
        }
      } else {
        alert('Detection failed: ' + JSON.stringify(data));
      }
    } catch (e) {
      console.error(e);
      alert('Error triggering detection');
    } finally {
      setDetecting(false);
    }
  };

  const totalRatio = laneRatios.reduce((a, b) => a + b, 0);
  const getLaneLeft = (laneIdx: number) => {
      let left = 0;
      for (let i = 0; i < laneIdx; i++) left += (laneRatios[i] || 0);
      return (left / totalRatio) * 100;
  };
  const getLaneWidth = (laneIdx: number) => {
      return ((laneRatios[laneIdx] || 0) / totalRatio) * 100;
  };

  const handleExport = async () => {
    if (!videoFilename || notes.length === 0) return;
    setExporting(true);
    try {
        const res = await fetch('/api/process/export-midi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoFilename })
        });
        const data = await res.json();
        if (data.status === 'completed') {
            alert(`MIDI Exported successfully to: ${data.path}`);
        } else {
            alert('Export failed: ' + JSON.stringify(data));
        }
    } catch (e) {
        console.error(e);
        alert('Error exporting MIDI');
    } finally {
        setExporting(false);
    }
  };

  return (
    <Paper p="md" withBorder mt="xl">
      <Group justify="space-between" mb="md">
        <Text fw={700}>Generated Waterfall Chart</Text>
        <Group>
            <Text size="sm">Zoom:</Text>
            <Slider 
                w={100} 
                min={10} max={100} 
                value={zoom} 
                onChange={setZoom} 
            />
            <Text size="sm">Threshold: {threshold}</Text>
            <Slider 
                w={100} 
                min={0} max={255} 
                value={threshold} 
                onChange={setThreshold} 
            />
            <Button size="xs" onClick={handleDetect} disabled={detecting}>
                {detecting ? <Loader size="xs" mr="xs"/> : null}
                Detect Notes
            </Button>
            <Tooltip label="Preview & Edit">
                <ActionIcon variant="light" size="lg" onClick={() => setEditorOpened(true)} disabled={notes.length === 0}>
                    <Play size={20} />
                </ActionIcon>
            </Tooltip>
            <Button size="xs" color="green" onClick={handleExport} disabled={exporting || notes.length === 0}>
                {exporting ? <Loader size="xs" mr="xs"/> : null}
                Export MIDI
            </Button>
        </Group>
      </Group>
      
      <Text size="sm" mb="md">
          Chunks: {result.chunks.length} | Notes: {notes.length} 
          {bpm && <span style={{ marginLeft: 20, fontWeight: 'bold', color: 'cyan' }}>Detected BPM: {bpm}</span>}
      </Text>
      
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {[...result.chunks].reverse().map((chunk) => {
          // Extract original index from filename "chunk_N.jpg"
          const chunkIndex = parseInt(chunk.split('_')[1]);
          
          return (
            <Box key={chunk} style={{ position: 'relative', width: `${zoom}%` }}>
                <Image
                src={`/workspace/${result.outputDir}/${chunk}`}
                alt={chunk}
                w="100%"
                fit="contain"
                style={{ display: 'block' }}
                />
                {/* Overlay Notes for this chunk */}
                {notes.filter(n => n.chunk_index === chunkIndex).map((note, i) => {
                    const chunkH = note.chunk_height || 5000; // Fallback to default chunk size if missing
                    return (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                top: `${((note.y - (note.h / 2)) / chunkH) * 100}%`,
                                left: `${getLaneLeft(note.lane)}%`,
                                width: `${getLaneWidth(note.lane)}%`,
                                height: `${(note.h / chunkH) * 100}%`,
                                border: '2px solid lime',
                                backgroundColor: 'rgba(0, 255, 0, 0.3)',
                                pointerEvents: 'none'
                            }}
                        />
                    );
                })}
            </Box>
          );
        })}
      </div>

      <NoteEditor 
        opened={editorOpened} 
        onClose={() => setEditorOpened(false)} 
        notes={notes}
        setNotes={setNotes}
      />
    </Paper>
  );
}

