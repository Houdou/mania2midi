import { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { processingResultAtom, videoFilenameAtom, laneRatiosAtom } from '../store';
import { Image, Paper, Text, Button, Group, Slider, Box, Loader, ActionIcon, Tooltip, NumberInput, Popover } from '@mantine/core';
import { Play, Settings } from 'lucide-react';
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
  const [metadata, setMetadata] = useState<any>(null);

  useEffect(() => {
      if (result && result.outputDir) {
          fetch(`/workspace/${result.outputDir}/metadata.json`)
              .then(res => res.json())
              .then(data => setMetadata(data))
              .catch(err => console.error("Failed to load metadata", err));
      }
  }, [result]);
  
  // BPM Config
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [barsPerLine, setBarsPerLine] = useState(4);

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
          laneRatios,
          beatsPerBar,
          barsPerLine
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

  const handleSave = async () => {
    if (!videoFilename) return;
    try {
        await fetch('/api/process/save-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                videoFilename,
                notes,
                bpm
            })
        });
    } catch (e) {
        console.error("Failed to save notes", e);
    }
  };

  const handleExport = async () => {
    if (!videoFilename || notes.length === 0) return;
    setExporting(true);
    try {
        // Save first
        await handleSave();

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

  const handleChunkClick = (e: React.MouseEvent<HTMLDivElement>, chunkIndex: number) => {
      // Prevent default to avoid selecting text etc
      e.preventDefault();
      
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const xPercent = (x / rect.width) * 100;
      const yPercent = (y / rect.height) * 100;
      
      // Determine Lane
      let currentLeft = 0;
      let clickedLane = -1;
      for (let i = 0; i < laneRatios.length; i++) {
          const w = getLaneWidth(i);
          if (xPercent >= currentLeft && xPercent < currentLeft + w) {
              clickedLane = i;
              break;
          }
          currentLeft += w;
      }
      
      if (clickedLane === -1) return;
      
      // Try to find chunk height from existing notes in this chunk
      const existingNoteInChunk = notes.find(n => n.chunk_index === chunkIndex);
      const chunkHeight = existingNoteInChunk?.chunk_height || 2000;

      // Determine Y in chunk pixels
      const clickY = (yPercent / 100) * chunkHeight;
      
      // Check for existing note to delete
      // We check if the click is within the vertical bounds of an existing note
      // plus a small padding for easier clicking on thin notes.
      const paddingPx = 10; // 10 pixels padding
      
      const existingNoteIndex = notes.findIndex(n => {
          if (n.chunk_index !== chunkIndex || n.lane !== clickedLane) return false;
          
          const noteTop = n.y - (n.h / 2);
          const noteBottom = n.y + (n.h / 2);
          
          return clickY >= (noteTop - paddingPx) && clickY <= (noteBottom + paddingPx);
      });
      
      if (existingNoteIndex !== -1) {
          // Delete
          const newNotes = [...notes];
          newNotes.splice(existingNoteIndex, 1);
          setNotes(newNotes);
      } else {
          // Add
          const newNote: Note = {
              chunk_index: chunkIndex,
              chunk_height: chunkHeight,
              lane: clickedLane,
              y: clickY,
              h: 10,
              type: 'hit'
          };
          setNotes([...notes, newNote]);
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
            
            <Popover width={300} position="bottom" withArrow shadow="md">
                <Popover.Target>
                    <ActionIcon variant="light" size="lg">
                        <Settings size={20} />
                    </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown>
                    <Text size="sm" fw={700} mb="xs">BPM Detection Settings</Text>
                    <NumberInput
                        label="Beats per Bar (Time Sig)"
                        description="Numerator of time signature (e.g. 4 for 4/4)"
                        value={beatsPerBar}
                        onChange={(v) => setBeatsPerBar(Number(v))}
                        min={1}
                        max={16}
                        mb="xs"
                    />
                    <NumberInput
                        label="Bars per Line"
                        description="How many bars does one detected line represent? (Use 4 if lines are sparse)"
                        value={barsPerLine}
                        onChange={(v) => setBarsPerLine(Number(v))}
                        min={1}
                        max={16}
                    />
                </Popover.Dropdown>
            </Popover>

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
          {bpm !== null && <span style={{ marginLeft: 20, fontWeight: 'bold', color: 'cyan' }}>Detected BPM: {bpm}</span>}
          <span style={{ marginLeft: 20, color: 'gray', fontSize: '0.8em' }}>(Click chart to add/remove notes)</span>
      </Text>
      
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {[...result.chunks].reverse().map((chunk) => {
          // Extract original index from filename "chunk_N.jpg"
          const chunkIndex = parseInt(chunk.split('_')[1]);
          
          return (
            <Box 
                key={chunk} 
                style={{ position: 'relative', width: `${zoom}%`, cursor: 'crosshair' }}
                onClick={(e) => handleChunkClick(e, chunkIndex)}
            >
                <Image
                src={`/workspace/${result.outputDir}/${chunk}?t=${result.timestamp}`}
                alt={chunk}
                w="100%"
                fit="contain"
                style={{ display: 'block', pointerEvents: 'none' }}
                />
                {/* Overlay Notes for this chunk */}
                {notes.filter(n => n.chunk_index === chunkIndex).map((note, i) => {
                    const chunkH = note.chunk_height || 2000; // Fallback to default chunk size if missing
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
        metadata={metadata}
      />
    </Paper>
  );
}

