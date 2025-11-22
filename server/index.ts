import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import MidiWriter from 'midi-writer-js';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Static files
// Serve the workspace folder so the frontend can access generated images
app.use('/workspace', express.static(path.join(__dirname, '../workspace')));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Mania2Midi Server is running' });
});

// List videos in workspace
app.get('/api/videos', async (req, res) => {
  const workspaceDir = path.join(__dirname, '../workspace');
  try {
    const files = await fs.readdir(workspaceDir);
    const videos = files.filter(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi'));
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read workspace' });
  }
});

// Trigger Slit-Scan
app.post('/api/process/slit-scan', (req, res) => {
  const { videoFilename, y, x1, x2, startTime, endTime, speed } = req.body;
  
  if (!videoFilename || y === undefined || x1 === undefined || x2 === undefined) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const workspaceDir = path.join(__dirname, '../workspace');
  const videoPath = path.join(workspaceDir, videoFilename);
  const outputDir = path.join(workspaceDir, 'output_' + videoFilename);
  const scriptPath = path.join(__dirname, '../scripts/slit_scan.py');

  // Clear previous output
  fs.emptyDirSync(outputDir);

  console.log(`Starting Slit-Scan for ${videoFilename}...`);

  const args = [
    scriptPath,
    '--video', videoPath,
    '--output', outputDir,
    '--y', y.toString(),
    '--x1', x1.toString(),
    '--x2', x2.toString()
  ];

  if (startTime !== undefined) args.push('--start', startTime.toString());
  if (endTime !== undefined) args.push('--end', endTime.toString());
  if (speed !== undefined) args.push('--speed', speed.toString());

  // Use the virtual environment Python if available
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '../.venv/Scripts/python.exe')
    : path.join(__dirname, '../.venv/bin/python');
    
  const pythonExec = fs.existsSync(venvPython) ? venvPython : 'python';
  console.log(`Using Python executable: ${pythonExec}`);

  const pythonProcess = spawn(pythonExec, args);

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python]: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error]: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      // Scan output dir for chunks
      try {
        const chunks = fs.readdirSync(outputDir)
          .filter(f => f.startsWith('chunk_') && f.endsWith('.jpg'))
          .sort((a, b) => {
            // Sort by chunk index
            const idxA = parseInt(a.split('_')[1]);
            const idxB = parseInt(b.split('_')[1]);
            return idxA - idxB;
          });
          
        res.json({ 
          status: 'completed', 
          outputDir: 'output_' + videoFilename,
          chunks 
        });
      } catch (e) {
        res.status(500).json({ error: 'Failed to list output chunks' });
      }
    } else {
      res.status(500).json({ error: 'Python script failed', code });
    }
  });
});

// Extract frames for calibration
app.post('/api/extract-frames', (req, res) => {
  const { videoFilename, startTime, count = 5, interval = 10 } = req.body;

  if (!videoFilename) {
    return res.status(400).json({ error: 'Missing videoFilename' });
  }

  const workspaceDir = path.join(__dirname, '../workspace');
  const videoPath = path.join(workspaceDir, videoFilename);
  const outputDir = path.join(workspaceDir, 'calibration_' + videoFilename);
  const scriptPath = path.join(__dirname, '../scripts/extract_frames.py');

  // Ensure output dir exists and is clean-ish
  fs.ensureDirSync(outputDir);

  // Use the virtual environment Python if available
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '../.venv/Scripts/python.exe')
    : path.join(__dirname, '../.venv/bin/python');
    
  const pythonExec = fs.existsSync(venvPython) ? venvPython : 'python';

  const pythonProcess = spawn(pythonExec, [
    scriptPath,
    '--video', videoPath,
    '--output', outputDir,
    '--start', (startTime || 0).toString(),
    '--count', count.toString(),
    '--interval', interval.toString()
  ]);

  let outputData = '';

  pythonProcess.stdout.on('data', (data) => {
    outputData += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error]: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      try {
        // Find the JSON output in the stdout
        const lines = outputData.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const result = JSON.parse(jsonLine);
        
        res.json({
          status: 'completed',
          outputDir: 'calibration_' + videoFilename,
          files: result.files,
          fps: result.fps,
          interval: result.interval
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to parse python output' });
      }
    } else {
      res.status(500).json({ error: 'Python script failed', code });
    }
  });
});

// Detect notes
app.post('/api/process/detect-notes', (req, res) => {
  const { videoFilename, threshold = 200, laneRatios } = req.body;

  if (!videoFilename) {
    return res.status(400).json({ error: 'Missing videoFilename' });
  }

  const workspaceDir = path.join(__dirname, '../workspace');
  const outputDir = path.join(workspaceDir, 'output_' + videoFilename);
  const scriptPath = path.join(__dirname, '../scripts/detect_notes.py');

  if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ error: 'Output directory not found. Run slit-scan first.' });
  }

  // Use the virtual environment Python if available
  const venvPython = process.platform === 'win32'
    ? path.join(__dirname, '../.venv/Scripts/python.exe')
    : path.join(__dirname, '../.venv/bin/python');
    
  const pythonExec = fs.existsSync(venvPython) ? venvPython : 'python';

  const args = [
    scriptPath,
    '--input', outputDir,
    '--threshold', threshold.toString()
  ];

  if (laneRatios && Array.isArray(laneRatios)) {
      args.push('--lane-ratios', laneRatios.join(','));
  }

  const pythonProcess = spawn(pythonExec, args);

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python Detect]: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Detect Error]: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      // Read the generated JSON
      const notesPath = path.join(outputDir, 'notes.json');
      if (fs.existsSync(notesPath)) {
          const notes = fs.readJsonSync(notesPath);
          res.json({ status: 'completed', notes });
      } else {
          res.status(500).json({ error: 'Notes file not generated' });
      }
    } else {
      res.status(500).json({ error: 'Python script failed', code });
    }
  });
});

// Export MIDI
app.post('/api/process/export-midi', (req, res) => {
    const { videoFilename } = req.body;

    if (!videoFilename) {
        return res.status(400).json({ error: 'Missing videoFilename' });
    }

    const workspaceDir = path.join(__dirname, '../workspace');
    const outputDir = path.join(workspaceDir, 'output_' + videoFilename);
    const notesPath = path.join(outputDir, 'notes.json');
    const metadataPath = path.join(outputDir, 'metadata.json');

    if (!fs.existsSync(notesPath) || !fs.existsSync(metadataPath)) {
        return res.status(404).json({ error: 'Notes or metadata not found. Run detection first.' });
    }

    try {
        const notesData = fs.readJsonSync(notesPath);
        // Handle both old format (array) and new format (object with notes, bpm)
        const notes = Array.isArray(notesData) ? notesData : notesData.notes;
        const detectedBpm = !Array.isArray(notesData) && notesData.bpm ? notesData.bpm : 120;

        const metadata = fs.readJsonSync(metadataPath);
        
        const { fps, speed, chunk_size, start_time } = metadata;
        
        // Create MIDI track
        const track = new MidiWriter.Track();
        track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 })); // Acoustic Grand Piano
        
        // Set Tempo
        track.setTempo(detectedBpm, 0);
        const ticksPerBeat = 128; // Default in MidiWriter is 128
        const ticksPerSecond = (ticksPerBeat * detectedBpm) / 60; 
        
        // Calculate absolute time for each note and convert to MIDI events
        // We need to sort notes by time to calculate delta times (waits)
        
        const notesWithTime = notes.map((note: any) => {
            // Time Calculation
            // BaseFrame = chunk_index * (chunk_size / speed)
            // Note: We assume previous chunks are full size (chunk_size).
            // If detect_notes.py runs on all chunks, we can trust chunk_index order.
            
            const baseFrame = note.chunk_index * (chunk_size / speed);
            
            // Frame within chunk
            // Top (y=0) is Late. Bottom (y=H) is Early.
            // Frame = BaseFrame + (ChunkHeight - y) / speed
            const chunkHeight = note.chunk_height || chunk_size; // Fallback if missing
            const frameOffset = (chunkHeight - note.y) / speed;
            
            const totalFrame = baseFrame + frameOffset;
            const timeSeconds = (totalFrame / fps) + start_time;
            
            return {
                ...note,
                time: timeSeconds,
                tick: Math.round(timeSeconds * ticksPerSecond)
            };
        });
        
        // Sort by time
        notesWithTime.sort((a: any, b: any) => a.time - b.time);
        
        // Generate MIDI events
        // MidiWriter uses 'wait' (delta ticks) from previous event.
        let lastTick = 0;
        
        notesWithTime.forEach((note: any) => {
            const deltaTicks = Math.max(0, note.tick - lastTick);
            
            // Map lane to pitch
            // Lane 0 -> 36 (C2), Lane 1 -> 37 ...
            const pitch = 36 + note.lane;
            
            const noteEvent = new MidiWriter.NoteEvent({
                pitch: [pitch],
                duration: '16', // Short duration
                wait: `T${deltaTicks}`,
                velocity: 100
            });
            
            track.addEvent(noteEvent);
            lastTick = note.tick;
        });
        
        const write = new MidiWriter.Writer(track);
        const midiData = write.buildFile();
        const midiPath = path.join(outputDir, 'output.mid');
        
        fs.writeFileSync(midiPath, midiData);
        
        res.json({ status: 'completed', path: midiPath });
        
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Export failed' });
    }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Ensure workspace directory exists
  fs.ensureDirSync(path.join(__dirname, '../workspace'));
  console.log('Workspace directory ready');
});
