import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme, getThemePref } from './theme.ts';
import './styles.css';

applyTheme(getThemePref()); // avant le premier rendu, pour éviter un éclair de mauvais thème

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
