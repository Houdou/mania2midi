import { Container, Title, Text, Group } from '@mantine/core'
import { VideoSelector } from './components/VideoSelector'
import { RoiConfigurator } from './components/RoiConfigurator'
import { WaterfallViewer } from './components/WaterfallViewer'

function App() {
  return (
    <Container size="xl" py="xl">
      <Title order={1}>Mania2Midi</Title>
      <Text c="dimmed" mb="lg">Rhythm Game Video to MIDI Converter</Text>
      
      <VideoSelector />
      <RoiConfigurator />
      <WaterfallViewer />
    </Container>
  )
}

export default App
