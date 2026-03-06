import { useEffect, useRef, useCallback } from "react";

/**
 * Detects barcode scanner input by identifying rapid sequential keystrokes
 * and routes them to the target input ref. Scanners typically send 8+
 * characters within 150ms, which is distinguishable from human typing.
 *
 * Does NOT intercept paste events — only raw keystrokes.
 */
export function useBarcodeScanner(
  targetRef: React.RefObject<HTMLInputElement | null>,
  onScan: (value: string) => void,
  opts?: { minLength?: number; maxIntervalMs?: number }
) {
  const minLength = opts?.minLength ?? 8;
  const maxInterval = opts?.maxIntervalMs ?? 150;

  const buffer = useRef("");
  const lastKeyTime = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const value = buffer.current.trim();
    buffer.current = "";
    if (value.length >= minLength) {
      // Scanner detected — route to target and trigger callback
      if (targetRef.current) {
        targetRef.current.value = value;
        targetRef.current.focus();
      }
      onScan(value);
    }
  }, [minLength, onScan, targetRef]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore modifier keys, function keys, and non-printable keys
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return; // Only single printable characters

      // Check if the active element is the target input — let it handle normally
      if (document.activeElement === targetRef.current) return;

      const now = Date.now();
      const elapsed = now - lastKeyTime.current;

      if (elapsed > maxInterval) {
        // Too slow — reset buffer (this was human typing)
        buffer.current = "";
      }

      buffer.current += e.key;
      lastKeyTime.current = now;

      // If we've accumulated enough characters rapidly, this is likely a scanner
      if (buffer.current.length >= minLength) {
        // Prevent the characters from going into whatever field has focus
        e.preventDefault();
        e.stopPropagation();
      }

      // Reset flush timer — wait for scanner to finish sending
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, maxInterval + 50);
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [flush, maxInterval, minLength, targetRef]);
}
