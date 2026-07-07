import { AlertCircle, Loader2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelStateProps {
  title?: string;
  message?: string;
  className?: string;
}

export function PanelLoading({ title = "Loading", message, className }: PanelStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-10 text-center",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}

export function PanelError({ title = "Something went wrong", message, className }: PanelStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center",
        className
      )}
      role="alert"
    >
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
      <div>
        <p className="font-medium text-destructive">{title}</p>
        {message && <p className="mt-1 text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}

export function PanelUnavailable({
  title = "Unavailable",
  message = "This panel needs additional configuration or live data credentials.",
  className,
}: PanelStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/30 p-10 text-center",
        className
      )}
      role="status"
    >
      <WifiOff className="h-8 w-8 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
