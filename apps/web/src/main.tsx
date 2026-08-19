import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './styles.css';
import './ui-rebuild.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Web application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
