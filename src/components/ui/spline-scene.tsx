import { Component, Suspense, lazy, type ReactNode } from "react";

const Spline = lazy(() => import("@splinetool/react-spline"));

export const LANDING_SPLINE_SCENE = "/scenes/stand-in.splinecode";
export const LANDING_SPLINE_WASM = "/scenes/wasm";
export const SPLINE_MIN_WIDTH_QUERY = "(min-width: 900px)";

interface SplineSceneProps {
  scene: string;
  className?: string;
  onUnavailable?: () => void;
}

class SplineSceneBoundary extends Component<
  { children: ReactNode; onUnavailable?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onUnavailable?.();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

export function canShowSplineScene() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (!window.matchMedia(SPLINE_MIN_WIDTH_QUERY).matches) return false;
  return hasWebGL();
}

export function SplineScene({ scene, className, onUnavailable }: SplineSceneProps) {
  return (
    <SplineSceneBoundary onUnavailable={onUnavailable}>
      <Suspense fallback={null}>
        <Spline scene={scene} className={className} wasmPath={LANDING_SPLINE_WASM} />
      </Suspense>
    </SplineSceneBoundary>
  );
}
