import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { Mini } from './App';
import Mobile from './Mobile';
import './styles.css';
import { installWebDesktop } from './webDesktop';

// In a browser (the web version, electron/web.ts) there is no preload: the window gets its bridge to the server here.
if (!('desktop' in window)) installWebDesktop();

const mini = location.hash === '#mini';
if (mini) document.documentElement.classList.add('is-mini');
// /mobile (the web version only): the phone's screen, in the look of MARK Mobile (Mobile.tsx)
const mobile = location.pathname === '/mobile';
createRoot(document.getElementById('root')!).render(<StrictMode>{mobile ? <Mobile /> : mini ? <Mini /> : <App />}</StrictMode>);
