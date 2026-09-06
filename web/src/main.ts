import './style.css';
import { App } from './app';
import { bytes } from './ui/format';

function boot(): void {
  const wasmLabel = document.getElementById('wasm');
  if (wasmLabel) wasmLabel.textContent = 'wasm ' + bytes(__WASM_BYTES__);
  try {
    new App().start();
  } catch (err) {
    const box = document.getElementById('stage-error');
    if (box) {
      box.textContent = err instanceof Error ? err.message : String(err);
      box.style.display = '';
    }
    console.error(err);
  }
}

boot();
