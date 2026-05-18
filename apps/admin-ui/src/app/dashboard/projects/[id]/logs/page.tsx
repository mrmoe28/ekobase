'use client'

import { ScrollText } from 'lucide-react'
import ComingSoonTab from '@/components/ComingSoonTab'

export default function ProjectLogsPage() {
  return (
    <ComingSoonTab
      icon={ScrollText}
      title="Logs"
      description="View API request logs, function invocations, and database query logs for this project."
    />
  )
}
