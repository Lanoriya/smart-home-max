import 'leaflet/dist/leaflet.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, currentTheme } from './App';
import './styles.css';

// Set the theme before the first paint so a dark page does not flash white.
document.documentElement.dataset.theme = currentTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
