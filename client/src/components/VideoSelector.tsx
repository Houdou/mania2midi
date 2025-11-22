import { useEffect, useState } from 'react';
import { Select } from '@mantine/core';
import { useAtom } from 'jotai';
import { videoFilenameAtom } from '../store';

export function VideoSelector() {
  const [videos, setVideos] = useState<string[]>([]);
  const [selectedVideo, setSelectedVideo] = useAtom(videoFilenameAtom);

  useEffect(() => {
    fetch('/api/videos')
      .then(res => res.json())
      .then(data => setVideos(data))
      .catch(err => console.error('Failed to fetch videos', err));
  }, []);

  return (
    <Select
      label="Select Video"
      placeholder="Pick a video from workspace"
      data={videos}
      value={selectedVideo}
      onChange={setSelectedVideo}
      mb="md"
    />
  );
}
