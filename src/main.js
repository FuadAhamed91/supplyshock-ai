import './styles.css';
import { MapView } from './scene/map.js';
import { App } from './ui/app.js';

const app = new App(new MapView());
window.__supplyshock = app; // handy for debugging in the console
app.boot().catch((err) => {
  console.error(err);
  document.getElementById('loader-text').textContent = 'Could not start the 3D view — try a browser with WebGL enabled.';
});
