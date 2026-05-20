type SourceSelectorProps = {
  selectedSource: string | undefined
  onSourceChange: (source: string | undefined) => void
  labels: {
    allSources: string
    sourceOpencode: string
    sourceHermes: string
  }
}

export function SourceSelector(props: SourceSelectorProps) {
  const { selectedSource, onSourceChange, labels } = props

  const sources: { value: string | undefined; label: string }[] = [
    { value: undefined, label: labels.allSources },
    { value: "opencode", label: labels.sourceOpencode },
    { value: "hermes", label: labels.sourceHermes },
  ]

  return (
    <div className="source-selector">
      {sources.map((s) => (
        <button
          key={s.label}
          className={`source-btn${selectedSource === s.value ? " active" : ""}`}
          type="button"
          onClick={() => onSourceChange(s.value)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
