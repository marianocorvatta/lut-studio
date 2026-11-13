import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'cpu',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.gpu.test.ts'],
          environment: 'node',
        },
      },
      {
        // Tests que necesitan WebGL2 real: corren en Chromium headless.
        extends: true,
        test: {
          name: 'gpu',
          include: ['src/**/*.gpu.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
            }),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
})
