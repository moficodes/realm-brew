import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { OverlayUxPrototype } from './prototype/OverlayUxPrototype';
import './index.css';

const showPrototype =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('prototype') !== 'off';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showPrototype ? <OverlayUxPrototype /> : <App />}
  </StrictMode>,
);
