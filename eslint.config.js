import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    '.cache',
    'supabase/functions/pos-api/app.bundle.*',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // อนุญาต destructure ทิ้งเพื่อตัด field ออก เช่น ({ pin: _pin, ...rest }) และตัวแปรขึ้นต้นด้วย _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // ไฟล์ shadcn/ui ที่ generate มา + provider/hook ที่ export ฟังก์ชันคู่กับ component โดยเจตนา
    files: ['web/src/components/ui/**', 'web/src/providers/**', 'web/src/hooks/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // shadcn/ui sidebar ใช้ Math.random ใน useMemo ทำ skeleton width (generated code)
    files: ['web/src/components/ui/**'],
    rules: {
      'react-hooks/purity': 'off',
    },
  },
])
