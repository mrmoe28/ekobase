import type { LucideIcon } from 'lucide-react'

export default function ComingSoonTab({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}
      >
        <Icon size={22} style={{ color: 'var(--accent)' }} />
      </div>
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text)' }}>
          {title}
        </h2>
        <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
        <span
          className="inline-block mt-3 text-xs px-3 py-1 rounded-full font-medium"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
          }}
        >
          Coming soon
        </span>
      </div>
    </div>
  )
}
