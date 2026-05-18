'use client'

import { createContext, useContext } from 'react'
import type { Project } from '@/lib/api'

export const ProjectContext = createContext<Project | null>(null)

export const useProject = () => useContext(ProjectContext)
