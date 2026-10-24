import { useState } from 'react';
import { Dashboard } from './screens/Dashboard';
import { Connections } from './screens/Connections';
import { SongStudio } from './screens/SongStudio';
import { VideoStudio } from './screens/VideoStudio';
import { Releases } from './screens/Releases';
import { Shorts } from './screens/Shorts';
import { Mixes } from './screens/Mixes';
import { SettingsScreen } from './screens/Settings';

export type Screen = 'dashboard' | 'connections' | 'song' | 'video' | 'shorts' | 'mixes' | 'releases' | 'settings';

const NAV: Array<[Screen, string]> = [
  ['dashboard', 'Dashboard'],
  ['connections', 'Connections'],
  ['song', 'Song Studio'],
  ['video', 'Video Studio'],
  ['shorts', 'Shorts'],
  ['mixes', 'Mixes'],
  ['releases', 'Releases'],
  ['settings', 'Settings'],
];

export function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [projectId, setProjectId] = useState<string | null>(null);
  const open = (s: Screen, id?: string) => {
    if (id) setProjectId(id);
    setScreen(s);
  };
  const props = { projectId, setProjectId, open };

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          Friday
          <br />
          <span>Music Studio</span>
        </div>
        {NAV.map(([id, label]) => (
          <button key={id} className={screen === id ? 'nav active' : 'nav'} onClick={() => setScreen(id)}>
            {label}
          </button>
        ))}
        <div className="phase">Phase 1 build · local only</div>
      </nav>
      <main className="content">
        {screen === 'dashboard' && <Dashboard {...props} />}
        {screen === 'connections' && <Connections />}
        {screen === 'song' && <SongStudio {...props} />}
        {screen === 'video' && <VideoStudio {...props} />}
        {screen === 'shorts' && <Shorts {...props} />}
        {screen === 'mixes' && <Mixes {...props} />}
        {screen === 'releases' && <Releases {...props} />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}

export interface ScreenProps {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  open: (s: Screen, id?: string) => void;
}
