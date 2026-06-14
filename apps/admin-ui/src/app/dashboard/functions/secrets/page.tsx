'use client'

import FunctionSecretsManager from '@/components/FunctionSecretsManager'

export default function SecretsPage() {
  return (
    <FunctionSecretsManager
      description="Manage encrypted values available to functions across your instance"
      customSecretsDescription="Secrets you have defined for every project in this instance"
      emptyStateDescription="This instance has no custom secrets yet."
    />
  )
}
