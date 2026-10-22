import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { TideProvider } from '@/lib/tide'
import Header from './header'
import './globals.css'


export const metadata: Metadata = {
  title: 'Leashed ID Agent',
  description: 'Hand ID paperwork to an AI agent on a leash the Tide network enforces.',
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        {/* TideCloakProvider in real mode, the simulated stand-in otherwise (lib/tide.tsx) */}
        <TideProvider>
          <Header />
          {children}
        </TideProvider>
      </body>
    </html>
  )
}
