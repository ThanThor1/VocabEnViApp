import React from 'react'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; error?: Error | null; info?: React.ErrorInfo | null }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log for debugging
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught', error, info)
    this.setState({ error, info })
  }

  reset = () => this.setState({ hasError: false, error: null, info: null })

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <h2 className="text-lg font-bold text-red-700">Đã có lỗi xảy ra</h2>
          <div className="mt-2 text-sm text-red-600">
            {this.state.error?.toString()}
          </div>
          {this.state.info?.componentStack && (
            <pre className="mt-2 text-xs text-gray-700 max-h-40 overflow-auto">{this.state.info.componentStack}</pre>
          )}
          <div className="mt-3">
            <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={this.reset}>Thử lại</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
