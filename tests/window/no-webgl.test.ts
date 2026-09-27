// fresh
// flags: --disable-webgl --disable-webgl2
import { connect, sleep, check, done } from './lib.ts';
const { js, close } = await connect(); await sleep(2500);
// A browser without WebGL (a remote desktop, a virtual machine, no GPU driver) once got a black window: the orb's WebGL renderer threw,
// and React dropped the whole page. The orb is drawn flat instead, and everything else works.
check('without WebGL the window still shows: the welcome over the sidebar', await js("!!document.querySelector('.welcome') && !!document.querySelector('.sidebar')"));
check('the orb is drawn flat (the mark in its disc), not left empty', await js("!!document.querySelector('.orb-canvas .orb-flat') && !document.querySelector('.orb-canvas canvas')"));
await js("document.querySelector('.welcome-close').click()"); await sleep(600);
check('Skip still closes the welcome', !(await js("!!document.querySelector('.welcome')")));
done(close);
