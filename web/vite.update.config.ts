import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

// The coordinator copies non-data public assets and supplies its validated snapshot separately.
export default mergeConfig(base, defineConfig({ publicDir: false }));
