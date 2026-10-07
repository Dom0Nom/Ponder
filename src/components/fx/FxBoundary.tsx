import { Component, type ReactNode } from "react";

export class FxBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("visual effect failed", e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
