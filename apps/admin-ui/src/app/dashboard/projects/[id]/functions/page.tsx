'use client'

import { Zap } from 'lucide-react'
import ComingSoonTab from '@/components/ComingSoonTab'

export default function ProjectFunctionsPage() {
  return (
    <ComingSoonTab
      icon={Zap}
      title="Edge Functions"
      description="Deploy and manage project-scoped serverless edge functions."
    />
  )
}
