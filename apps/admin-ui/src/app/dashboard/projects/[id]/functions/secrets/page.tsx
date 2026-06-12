'use client'

import { useParams } from 'next/navigation'
import FunctionSecretsManager from '@/components/FunctionSecretsManager'

export default function ProjectSecretsPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <FunctionSecretsManager
      title="Edge Function Secrets"
      description="Manage encrypted values available to edge functions in this project"
      customSecretsDescription="Secrets scoped to this project"
      emptyStateTitle="No secrets created"
      emptyStateDescription="This project has no custom secrets yet."
      projectId={id}
    />
  )
}
