import { useEffect, useState } from "react";
import { File, Folder, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@opskat/ui";
import { SFTPProperties } from "../../../../wailsjs/go/ssh/SSH";
import { sftp_svc } from "../../../../wailsjs/go/models";
import { formatBytes, formatDate } from "./utils";
import { type PermissionTarget } from "./types";

interface PropertiesDialogProps {
  sessionId: string;
  target: PermissionTarget | null;
  onClose: () => void;
}

export function PropertiesDialog({ sessionId, target, onClose }: PropertiesDialogProps) {
  const [props, setProps] = useState<sftp_svc.FileProperties | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setProps(null);
    setError(null);
    SFTPProperties(sessionId, target.path)
      .then(setProps)
      .catch((e) => setError(String(e)));
  }, [sessionId, target]);

  const row = (label: string, value?: string | number | null) => (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="break-all font-mono text-xs">{value ?? "-"}</div>
    </div>
  );

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" /> Properties
          </DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md bg-muted/40 p-2">
              {target.entry.isDir ? <Folder className="h-4 w-4 text-primary" /> : <File className="h-4 w-4" />}
              <div className="min-w-0 truncate font-medium">{target.entry.name}</div>
            </div>
            {error && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
            {!error && !props && <div className="py-4 text-center text-sm text-muted-foreground">Loading...</div>}
            {props && (
              <div className="rounded-md border p-3">
                {row("Path", props.path)}
                {row("Type", props.isDir ? "Folder" : "File")}
                {row("Size", `${formatBytes(props.size)} (${props.size} bytes)`)}
                {props.isDir && row("Children", props.childCount ?? 0)}
                {row("Mode", props.mode)}
                {row("Owner", props.uid)}
                {row("Group", props.gid)}
                {row("Modified", formatDate(props.modTime))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
