import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { applyMotionLevel } from './motion/preference';
import { applyPalette } from './theme/palette';

applyPalette();
applyMotionLevel();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);