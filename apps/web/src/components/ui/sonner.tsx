"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const [notificationsSheetOpen, setNotificationsSheetOpen] = useState(false)

  useEffect(() => {
    const handleNotificationsSheetState = (event: Event) => {
      const open =
        event instanceof CustomEvent &&
        typeof event.detail?.open === "boolean"
          ? event.detail.open
          : false

      setNotificationsSheetOpen(open)
    }

    window.addEventListener("tabu:notifications-sheet-state", handleNotificationsSheetState)
    return () => {
      window.removeEventListener("tabu:notifications-sheet-state", handleNotificationsSheetState)
    }
  }, [])

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      visibleToasts={1}
      expand={false}
      position="top-right"
      offset={notificationsSheetOpen ? { top: 72, right: 16 } : { top: 16, right: 16 }}
      mobileOffset={notificationsSheetOpen ? { top: 88, left: 12, right: 12 } : { top: 12, left: 12, right: 12 }}
      toastOptions={{
        duration: 2800,
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
