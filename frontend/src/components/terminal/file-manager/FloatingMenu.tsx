import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Clipboard,
  Copy,
  Download,
  Edit3,
  FilePlus,
  FolderDown,
  FolderOpen,
  FolderPlus,
  Info,
  KeyRound,
  RefreshCw,
  Scissors,
  Terminal,
  Trash2,
} from "lucide-react";
import { cn } from "@opskat/ui";
import { type CtxMenuState } from "./types";

interface FloatingMenuProps {
  canPaste: boolean;
  ctx: CtxMenuState;
  onAction: (action: string) => void;
  onClose: () => void;
}

export function FloatingMenu({ canPaste, ctx, onAction, onClose }: FloatingMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);
  const [interactive, setInteractive] = useState(false);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = ctx.x + 2;
    let top = ctx.y + 2;
    if (left + rect.width > vw) left = ctx.x - rect.width - 2;
    if (top + rect.height > vh) top = ctx.y - rect.height - 2;
    left = Math.max(4, Math.min(left, vw - rect.width - 4));
    top = Math.max(4, Math.min(top, vh - rect.height - 4));
    setPos({ top, left });
    setVisible(true);
  }, [ctx.x, ctx.y]);

  useEffect(() => {
    const timer = setTimeout(() => setInteractive(true), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handlePointer = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", handlePointer, true);
    }, 50);
    document.addEventListener("keydown", handleKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handlePointer, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const item = (
    action: string,
    icon: ReactNode,
    label: string,
    opts: { destructive?: boolean; disabled?: boolean } = {}
  ) => (
    <div
      key={action}
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-default select-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        opts.disabled && "pointer-events-none opacity-40",
        opts.destructive
          ? "text-destructive hover:bg-destructive/10 [&_svg]:text-destructive"
          : "hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground"
      )}
      onClick={() => !opts.disabled && onAction(action)}
    >
      {icon}
      {label}
    </div>
  );

  const separator = <div className="-mx-1 my-1 h-px bg-border" />;
  const multiCount = ctx.selectedEntries.length;
  const multi = multiCount > 1;

  return createPortal(
    <div
      ref={ref}
      className={cn(
        "z-50 min-w-[13rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        visible && "animate-in fade-in-0 zoom-in-95"
      )}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      {multi ? (
        <>
          {item("downloadSelected", <Download />, `Download Selected (${multiCount} items)`)}
          {separator}
          {item("cutSelected", <Scissors />, `Cut Selected (${multiCount} items)`)}
          {item("copySelected", <Copy />, `Copy Selected (${multiCount} items)`)}
          {item("paste", <Clipboard />, "Paste", { disabled: !canPaste })}
          {separator}
          {item("deleteSelected", <Trash2 />, `Delete Selected (${multiCount} items)`, { destructive: true })}
        </>
      ) : ctx.entry ? (
        ctx.entry.isDir ? (
          <>
            {item("open", <FolderOpen />, "Open")}
            {item("openTerminal", <Terminal />, "Open in Terminal")}
            {item("downloadDir", <FolderDown />, "Download Folder")}
            {separator}
            {item("cut", <Scissors />, "Cut")}
            {item("copy", <Copy />, "Copy")}
            {item("paste", <Clipboard />, "Paste", { disabled: !canPaste })}
            {separator}
            {item("rename", <Edit3 />, "Rename")}
            {item("permission", <KeyRound />, "Permission")}
            {item("properties", <Info />, "Properties")}
            {separator}
            {item("delete", <Trash2 />, "Delete", { destructive: true })}
          </>
        ) : (
          <>
            {item("download", <Download />, "Download File")}
            {separator}
            {item("cut", <Scissors />, "Cut")}
            {item("copy", <Copy />, "Copy")}
            {item("paste", <Clipboard />, "Paste", { disabled: !canPaste })}
            {separator}
            {item("rename", <Edit3 />, "Rename")}
            {item("permission", <KeyRound />, "Permission")}
            {item("properties", <Info />, "Properties")}
            {separator}
            {item("delete", <Trash2 />, "Delete", { destructive: true })}
          </>
        )
      ) : (
        <>
          {item("refresh", <RefreshCw />, "Refresh")}
          {separator}
          {item("newFolder", <FolderPlus />, "New Folder")}
          {item("newFile", <FilePlus />, "New File")}
          {item("paste", <Clipboard />, "Paste", { disabled: !canPaste })}
          {item("copyCurrentPath", <Copy />, "Copy Current Path")}
        </>
      )}
    </div>,
    document.body
  );
}
