# Mania2Midi

## Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Python (v3.8+)
- FFmpeg (optional, but good to have)

### 2. Installation

**Backend:**
```bash
yarn install
```

**Python Environment:**
```bash
yarn setup:python
```

**Frontend:**
```bash
cd client
yarn install
```

### 3. Setup Workspace
Create a `workspace` folder in the root and place your video files there.
```bash
mkdir workspace
# Copy your video (e.g., inside_identity.mp4) into workspace/
```

### 4. Running the App

**Start the Server (Backend):**
```bash
yarn dev
```

**Start the Client (Frontend):**
```bash
yarn client:dev
```

Open http://localhost:5173 to use the tool.
