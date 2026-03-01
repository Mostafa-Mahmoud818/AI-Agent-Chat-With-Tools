import { Component } from 'react'
import SparkIcon from './SparkIcon'
import './ErrorBoundary.css'

class ErrorBoundary extends Component {
    state = { hasError: false }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error, info) {
        console.error('Uncaught error:', error, info)
    }

    handleRetry = () => {
        this.setState({ hasError: false })
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="error-boundary">
                    <div className="error-boundary-content glass">
                        <SparkIcon size={48} withCircle />
                        <h2>Something went wrong</h2>
                        <p>An unexpected error occurred. Please try again.</p>
                        <button className="error-boundary-btn" onClick={this.handleRetry}>
                            Try Again
                        </button>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}

export default ErrorBoundary
