import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
          background: '#0f0f10',
          color: '#e2e2e4',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32 }}>⚠</div>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          CodeBuilders encountered an error
        </h1>
        <p style={{ fontSize: 13, color: '#888', maxWidth: 480, lineHeight: 1.6, margin: 0 }}>
          An unexpected error occurred. This is likely a bug. Please restart the app.
          If the problem persists, report it on GitHub.
        </p>
        <pre
          style={{
            fontSize: 11,
            background: '#1a1a1c',
            border: '1px solid #2a2a2e',
            borderRadius: 8,
            padding: '12px 16px',
            maxWidth: 560,
            overflowX: 'auto',
            color: '#f87171',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {error.message}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            height: 32,
            padding: '0 20px',
            borderRadius: 6,
            border: '1px solid #3a3a3e',
            background: '#1e1e22',
            color: '#e2e2e4',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Try to recover
        </button>
      </div>
    )
  }
}
