"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// Text typed (or autofilled by Safari / a password manager) into a server-rendered input before
// React hydrates stays in the DOM but never reaches the controlled state, so the next re-render
// silently wipes it. Replay it once as a normal change event so the form state keeps it.
function replayPrehydrationValue(node: HTMLInputElement, onChange: unknown, value: unknown) {
  if (typeof onChange !== "function" || value == null || String(value) !== "") return
  const typed = node.value
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (typed === "" || !nativeSetter) return

  // Assigning through the node makes React's value tracker record "", then the prototype setter
  // restores the text without touching the tracker, so the input event reads as a real change.
  node.value = ""
  nativeSetter.call(node, typed)
  node.dispatchEvent(new Event("input", { bubbles: true }))
}

function Input({ className, type, ref, ...props }: React.ComponentProps<"input">) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node
      if (typeof ref === "function") return ref(node)
      if (ref) ref.current = node
    },
    [ref]
  )
  const adoptPrehydrationValue = React.useEffectEvent((node: HTMLInputElement) => {
    if (type === "checkbox" || type === "radio" || type === "file") return
    replayPrehydrationValue(node, props.onChange, props.value)
  })

  React.useEffect(() => {
    if (inputRef.current) adoptPrehydrationValue(inputRef.current)
  }, [])

  return (
    <input
      ref={setRefs}
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
