import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { StaffProvider } from "@/hooks/useStaff"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <StaffProvider>
          <App />
        </StaffProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
