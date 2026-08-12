import { cn } from "@/lib/utils";
import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  createSwapy,
  type Config,
  type SlotItemMapArray,
  type SwapEvent,
} from "swapy";

type SwapyLayoutProps = {
  id: string;
  enable?: boolean;
  onSwap?: (event: { newSlotItemMap: { asArray: SlotItemMapArray } }) => void;
  config?: Partial<Config>;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
};

/**
 * Thin Swapy container. When `enable` is false (e.g. prefers-reduced-motion),
 * children render as a static layout with no drag runtime.
 */
export function SwapyLayout({
  id,
  enable = true,
  onSwap,
  config,
  className,
  "aria-label": ariaLabel,
  children,
}: SwapyLayoutProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swapyRef = useRef<ReturnType<typeof createSwapy> | null>(null);
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!enable) return;
    const container = containerRef.current;
    if (!container) return;

    const instance = createSwapy(container, {
      animation: "dynamic",
      swapMode: "hover",
      manualSwap: true,
      autoScrollOnDrag: true,
      ...configRef.current,
    });
    swapyRef.current = instance;

    instance.onSwap((event: SwapEvent) => {
      onSwapRef.current?.({
        newSlotItemMap: { asArray: event.newSlotItemMap.asArray },
      });
    });

    return () => {
      instance.destroy();
      swapyRef.current = null;
    };
  }, [enable, id]);

  useEffect(() => {
    if (!enable) return;
    swapyRef.current?.update();
  }, [children, enable]);

  return (
    <div
      id={id}
      ref={containerRef}
      className={className}
      role="list"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function SwapySlot({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} data-swapy-slot={id} role="listitem">
      {children}
    </div>
  );
}

export function SwapyItem({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(className)} data-swapy-item={id}>
      {children}
    </div>
  );
}

/** Visible grip; only this node starts a drag (`data-swapy-handle`). */
export function SwapyHandle({
  className,
  label = "Drag to rearrange",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      data-swapy-handle
      className={cn("swapy-handle", className)}
      aria-label={label}
      role="button"
      tabIndex={-1}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 256 256"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="92" cy="60" r="14" />
        <circle cx="164" cy="60" r="14" />
        <circle cx="92" cy="128" r="14" />
        <circle cx="164" cy="128" r="14" />
        <circle cx="92" cy="196" r="14" />
        <circle cx="164" cy="196" r="14" />
      </svg>
    </span>
  );
}
