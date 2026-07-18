# POS ปั๊มน้ำมัน

## รันด้วย Docker (แนะนำ)

ต้องมี Docker / Docker Compose เท่านั้น ไม่ต้องลง Node.js หรือ MySQL เอง:

```bash
docker compose up --build
```

- เปิดใช้งานที่ http://localhost:3000
- ครั้งแรก container `app` จะ apply migrations (`drizzle-kit migrate`) และ seed ข้อมูลตัวอย่างให้อัตโนมัติ
- บัญชีเริ่มต้นจาก seed: `admin` / PIN `1234` (เจ้าของปั๊ม), `manager` / PIN `2222` (ผู้จัดการสาขา), `somchai` / PIN `0000` (พนักงาน)
- ปรับค่าได้ผ่าน `.env` (ดูตัวอย่างใน `.env.example`) เช่น `APP_SECRET`, `DB_ROOT_PASSWORD`, `APP_PORT`
- ข้อมูล MySQL เก็บใน volume `db_data` — ลบทิ้งทั้งหมดด้วย `docker compose down -v`

## Development (ไม่ใช้ Docker)

```bash
npm install
npm run dev          # dev server ที่ http://localhost:3000
npm run db:migrate   # apply migrations ไปยัง DATABASE_URL
```

## เปลี่ยนโครงสร้างฐานข้อมูล (schema)

ใช้ migration files ใน `db/migrations/` (commit เข้า git ด้วย) ไม่ใช้ `db:push` อีกต่อไป เพื่อไม่ให้ข้อมูลเดิมเสียหาย:

```bash
# 1. แก้ db/schema.ts แล้วสร้าง migration ใหม่
npm run db:generate   # สร้างไฟล์ SQL ใน db/migrations/
npm run db:migrate    # apply เข้า DB ที่กำลังใช้งาน
# 2. commit ทั้ง schema.ts และ db/migrations/ — container จะ migrate เองตอน start
```

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
# Kimi-Agent-POS
