import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IconContext } from '@phosphor-icons/react';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource-variable/source-sans-3';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import './tree.css';
import './archive.css';
import './family.css';
import Atlas from './components/Atlas';
import SiteError from './components/SiteError';

// Every icon is Phosphor's fine line. Icons are decorative; their buttons
// carry the words.
const icons = { weight: 'light', size: 24, 'aria-hidden': true } as const;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconContext.Provider value={icons}>
      <SiteError>
        <Atlas />
      </SiteError>
    </IconContext.Provider>
  </StrictMode>,
);
