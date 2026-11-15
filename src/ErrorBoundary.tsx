import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback?: ReactNode
  label?: string
}

type State = {
  error: Error | null
}

/** Keeps the rest of the app mounted when a child throws (e.g. MapLibre style races). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack)
  }

  private retry = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    return (
      <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-8 text-center">
        <p className="text-sm font-semibold text-neutral-100">
          {this.props.label ?? 'This section'} hit an error
        </p>
        <p className="max-w-md text-xs text-neutral-400">{this.state.error.message}</p>
        <button
          type="button"
          onClick={this.retry}
          className="rounded-full border border-slate-500 bg-neutral-950 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-neutral-800"
        >
          Try again
        </button>
      </div>
    )
  }
}
