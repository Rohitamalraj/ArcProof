"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || "Unexpected error" };
  }

  componentDidCatch() {
    // Intentionally silent in UI.
  }

  private reset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-red-900/50 bg-red-950/30 p-6 text-red-200">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="mt-2 text-sm text-red-200/90">{this.state.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 rounded-lg border border-red-700 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-900/30"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
