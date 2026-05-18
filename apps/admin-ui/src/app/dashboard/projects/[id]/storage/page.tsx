'use client'

import { HardDrive } from 'lucide-react'
import ComingSoonTab from '@/components/ComingSoonTab'

export default function ProjectStoragePage() {
  return (
    <ComingSoonTab
      icon={HardDrive}
      title="Storage"
      description="Browse and manage project files, buckets, and objects."
    />
  )
}
