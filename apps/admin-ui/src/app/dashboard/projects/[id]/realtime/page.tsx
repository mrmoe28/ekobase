'use client'

import { Radio } from 'lucide-react'
import ComingSoonTab from '@/components/ComingSoonTab'

export default function ProjectRealtimePage() {
  return (
    <ComingSoonTab
      icon={Radio}
      title="Realtime"
      description="Monitor live database change events and channel connections for this project."
    />
  )
}
