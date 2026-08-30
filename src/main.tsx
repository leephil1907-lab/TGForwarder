import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './AppV2.tsx';
import './index.css';
import { installAuthenticatedFetch } from './lib/authToken';

installAuthenticatedFetch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
