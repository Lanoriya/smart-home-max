import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@maxhub/max-ui/dist/styles.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { App } from './App';
import { readLinkToken } from './bridge';

// Take the sign-in token out of the address bar before anything renders.
readLinkToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
