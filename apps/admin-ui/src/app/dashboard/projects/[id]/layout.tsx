'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getProject, type Project } from '@/lib/api'
import { ProjectContext } from '@/contexts/project'
import ProjectSidebar from '@/components/ProjectSidebar'

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)

  useEffect(() => {
    getProject(id)
      .then(setProject)
      .catch(() => router.replace('/dashboard/projects'))
  }, [id, router])

  return (
    <ProjectContext.Provider value={project}>
      <div
        className="flex -mx-6 -my-6 lg:-mx-8 lg:-my-8"
        style={{ height: 'calc(100svh - 4rem)' }}
      >
        <ProjectSidebar projectId={id} projectName={project?.name ?? undefined} />
        <div className="flex-1 overflow-y-auto p-5 lg:p-6">
          {children}
        </div>
      </div>
    </ProjectContext.Provider>
  )
}
