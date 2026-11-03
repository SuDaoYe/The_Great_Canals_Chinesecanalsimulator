import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'browser-tests',testMatch:'**/*.e2e.js', use:{baseURL:'http://127.0.0.1:4173',channel:'chrome'},webServer:{command:'npm run dev -- --port 4173 --strictPort',url:'http://127.0.0.1:4173'}});

