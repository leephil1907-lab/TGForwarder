import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAuthenticatedFetch } from './lib/authToken';

// Must run before App renders so every fetch('/api/...') call the app makes
// carries the stored access token automatically.
installAuthenticatedFetch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
