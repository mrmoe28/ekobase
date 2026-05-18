'use client'

import { Plug } from 'lucide-react'
import ComingSoonTab from '@/components/ComingSoonTab'

export default function ProjectIntegrationsPage() {
  return (
    <ComingSoonTab
      icon={Plug}
      title="Integrations"
      description="Connect third-party services and webhooks to this project."
    />
  )
}
