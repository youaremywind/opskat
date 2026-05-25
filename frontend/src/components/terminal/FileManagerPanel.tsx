import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn, ConfirmDialog } from "@opskat/ui";
import { SFTPCreateFile, SFTPDelete, SFTPMkdir, SFTPPaste, SFTPRename, SFTPGetwd } from "../../../wailsjs/go/ssh/SSH";
import { sftp_svc } from "../../../wailsjs/go/models";
import { useSFTPStore } from "@/stores/sftpStore";
import { FileList } from "./file-manager/FileList";
import { FloatingMenu } from "./file-manager/FloatingMenu";
import { NameDialog } from "./file-manager/NameDialog";
import { PathToolbar } from "./file-manager/PathToolbar";
import { PermissionDialog } from "./file-manager/PermissionDialog";
import { PropertiesDialog } from "./file-manager/PropertiesDialog";
import { TransferSection } from "./file-manager/TransferSection";
import { type ClipboardState, type DeleteTarget, type CtxMenuState, type PermissionTarget } from "./file-manager/types";
import { useFileManagerDirectory } from "./file-manager/useFileManagerDirectory";
import { useNativeFileDrop } from "./file-manager/useNativeFileDrop";
import { useResizeHandle } from "./file-manager/useResizeHandle";
import { useTerminalDirectorySync } from "./file-manager/useTerminalDirectorySync";
import {
  canMovePathToDirectory,
  formatBytes,
  getEntryPath,
  getParentPath,
  getPathBaseName,
  HANDLE_PX,
  joinRemotePath,
} from "./file-manager/utils";

interface FileManagerPanelProps {
  tabId: string;
  sessionId: string;
  isActive?: boolean;
  isOpen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}

let globalClipboard: ClipboardState | null = null;
const clipboardListeners = new Set<() => void>();
function setGlobalClipboard(next: ClipboardState | null) {
  globalClipboard = next;
  clipboardListeners.forEach((listener) => listener());
}
function useClipboardState() {
  const [clipboard, setClipboard] = useState(globalClipboard);
  useEffect(() => {
    const listener = () => setClipboard(globalClipboard);
    clipboardListeners.add(listener);
    return () => {
      clipboardListeners.delete(listener);
    };
  }, []);
  return clipboard;
}

export function FileManagerPanel({
  tabId,
  sessionId,
  isActive = true,
  isOpen,
  width,
  onWidthChange,
}: FileManagerPanelProps) {
  const { t } = useTranslation();
  const {
    currentPath,
    currentPathRef,
    entries,
    error,
    loading,
    loadDir,
    pathInput,
    selected,
    setError,
    setPathInput,
    setSelected,
    storedPath,
  } = useFileManagerDirectory(tabId, sessionId);

  const {
    directoryFollowMode,
    navigateToPath,
    paneConnected,
    sessionSync,
    syncPanelFromTerminal,
    syncTerminalToPath,
    toggleFollowMode,
  } = useTerminalDirectorySync({ currentPathRef, loadDir, sessionId, tabId });

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<PermissionTarget | null>(null);
  const [propertiesTarget, setPropertiesTarget] = useState<PermissionTarget | null>(null);
  const [nameDialog, setNameDialog] = useState<null | "file" | "folder">(null);
  const clipboard = useClipboardState();
  const loadedRef = useRef(false);
  const lastSessionRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const startUpload = useSFTPStore((s) => s.startUpload);
  const startUploadDir = useSFTPStore((s) => s.startUploadDir);
  const startUploadFile = useSFTPStore((s) => s.startUploadFile);
  const startDownload = useSFTPStore((s) => s.startDownload);
  const startDownloadDir = useSFTPStore((s) => s.startDownloadDir);
  const allTransfers = useSFTPStore((s) => s.transfers);

  const transferTarget = useMemo(() => ({ tabId, sessionId }), [tabId, sessionId]);
  const tabTransfers = useMemo(
    () => Object.values(allTransfers).filter((transfer) => transfer.tabId === tabId),
    [allTransfers, tabId]
  );
  const entryByPath = useMemo(() => {
    const map = new Map<string, sftp_svc.FileEntry>();
    for (const entry of entries) map.set(getEntryPath(currentPath, entry), entry);
    return map;
  }, [currentPath, entries]);
  const selectedEntries = useMemo(
    () => selected.map((path) => entryByPath.get(path)).filter(Boolean) as sftp_svc.FileEntry[],
    [entryByPath, selected]
  );
  const clipboardCutPaths = useMemo(() => {
    if (clipboard?.mode !== "cut") return new Set<string>();
    return new Set(clipboard.items.filter((item) => item.sessionId === sessionId).map((item) => item.path));
  }, [clipboard, sessionId]);

  const isDragOver = useNativeFileDrop({
    currentPathRef,
    isActive,
    isOpen,
    panelRef,
    sessionId,
    startUploadFile,
    tabId,
  });
  const { handleResizeStart, isResizing, outerRef } = useResizeHandle({ onWidthChange, panelRef, width });

  useEffect(() => {
    if (!sessionId) return;
    if (lastSessionRef.current !== sessionId) {
      lastSessionRef.current = sessionId;
      loadedRef.current = false;
    }
    if (!isOpen || loadedRef.current) return;
    loadedRef.current = true;
    if (directoryFollowMode === "always" && sessionSync?.cwdKnown && sessionSync.cwd) {
      void loadDir(sessionSync.cwd);
      return;
    }
    if (storedPath) {
      void loadDir(storedPath);
      return;
    }
    SFTPGetwd(sessionId)
      .then((home) => loadDir(home || "/"))
      .catch(() => loadDir("/"));
  }, [sessionId, isOpen, directoryFollowMode, sessionSync?.cwdKnown, sessionSync?.cwd, storedPath, loadDir]);

  useEffect(() => {
    if (!isOpen || directoryFollowMode !== "always") return;
    if (!sessionSync?.cwdKnown || !sessionSync.cwd) return;
    if (sessionSync.cwd === currentPath) return;
    void loadDir(sessionSync.cwd);
  }, [currentPath, directoryFollowMode, isOpen, loadDir, sessionSync?.cwd, sessionSync?.cwdKnown]);

  const doneUploadCount = tabTransfers.filter(
    (transfer) => transfer.status === "done" && transfer.direction === "upload"
  ).length;
  const prevDoneCount = useRef(0);
  useEffect(() => {
    if (doneUploadCount > prevDoneCount.current) void loadDir(currentPathRef.current);
    prevDoneCount.current = doneUploadCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneUploadCount]);

  useEffect(() => {
    const handler = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path;
      if (path) setRenamePath(path);
    };
    window.addEventListener("sftp:rename-request", handler);
    return () => window.removeEventListener("sftp:rename-request", handler);
  }, []);

  const getFullPath = useCallback((entry: sftp_svc.FileEntry) => getEntryPath(currentPath, entry), [currentPath]);
  const selectedItems = useCallback(() => {
    const paths = selected.length ? selected : [];
    return paths
      .map((path) => {
        const entry = entryByPath.get(path);
        if (!entry) return null;
        return { sessionId, path, name: entry.name, isDir: entry.isDir, size: entry.size };
      })
      .filter(Boolean) as ClipboardState["items"];
  }, [entryByPath, selected, sessionId]);

  const copyOrCut = useCallback(
    (mode: "copy" | "cut", paths?: string[]) => {
      const sourcePaths = paths ?? selected;
      const items = sourcePaths
        .map((path) => {
          const entry = entryByPath.get(path);
          if (!entry) return null;
          return { sessionId, path, name: entry.name, isDir: entry.isDir, size: entry.size };
        })
        .filter(Boolean) as ClipboardState["items"];
      if (!items.length) return;
      setGlobalClipboard({ mode, items });
    },
    [entryByPath, selected, sessionId]
  );

  const paste = useCallback(async () => {
    if (!clipboard?.items.length) return;
    try {
      await SFTPPaste(
        new sftp_svc.PasteRequest({
          targetSessionId: sessionId,
          targetDir: currentPathRef.current,
          mode: clipboard.mode,
          items: clipboard.items,
        })
      );
      if (clipboard.mode === "cut") setGlobalClipboard(null);
      await loadDir(currentPathRef.current);
    } catch (e) {
      toast.error(String(e));
    }
  }, [clipboard, currentPathRef, loadDir, sessionId]);

  const goUp = useCallback(() => {
    if (currentPath === "/") return;
    void navigateToPath(getParentPath(currentPath));
  }, [currentPath, navigateToPath]);

  const goHome = useCallback(() => {
    SFTPGetwd(sessionId)
      .then((home) => navigateToPath(home || "/"))
      .catch(() => navigateToPath("/"));
  }, [navigateToPath, sessionId]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      for (const item of deleteTarget.paths) await SFTPDelete(sessionId, item.path, item.isDir);
      await loadDir(currentPathRef.current);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteTarget(null);
    }
  }, [currentPathRef, deleteTarget, loadDir, sessionId, setError]);

  const startRename = useCallback(
    (path?: string) => {
      const targetPath = path ?? selected[0];
      if (targetPath) setRenamePath(targetPath);
    },
    [selected]
  );

  const commitRename = useCallback(
    async (oldPath: string, nextName: string) => {
      const entry = entryByPath.get(oldPath);
      if (!entry || nextName === entry.name) {
        setRenamePath(null);
        return;
      }
      try {
        await SFTPRename(sessionId, oldPath, joinRemotePath(getParentPath(oldPath), nextName));
        setRenamePath(null);
        await loadDir(currentPathRef.current);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [currentPathRef, entryByPath, loadDir, sessionId]
  );

  const moveEntriesToDirectory = useCallback(
    async (sourcePaths: string[], targetDirPath: string) => {
      const moves = sourcePaths
        .filter((path) => canMovePathToDirectory(path, targetDirPath))
        .map((path) => {
          const entry = entryByPath.get(path);
          const name = entry?.name || getPathBaseName(path);
          if (!name) return null;
          return {
            from: path,
            to: joinRemotePath(targetDirPath, name),
          };
        })
        .filter((item): item is { from: string; to: string } => !!item && item.from !== item.to);

      if (!moves.length) return;

      try {
        for (const move of moves) {
          await SFTPRename(sessionId, move.from, move.to);
        }
        setSelected([]);
        await loadDir(currentPathRef.current);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [currentPathRef, entryByPath, loadDir, sessionId, setSelected]
  );

  const openPermission = useCallback(
    (path: string) => {
      const entry = entryByPath.get(path);
      if (entry) setPermissionTarget({ entry, path });
    },
    [entryByPath]
  );

  const openProperties = useCallback(
    (path: string) => {
      const entry = entryByPath.get(path);
      if (entry) setPropertiesTarget({ entry, path });
    },
    [entryByPath]
  );

  const handleCtxAction = useCallback(
    (action: string) => {
      if (!ctxMenu) return;
      const entry = ctxMenu.entry;
      const targetPath = entry ? getFullPath(entry) : selected[0];
      const multiPaths = selected.length > 1 ? selected : targetPath ? [targetPath] : [];
      setCtxMenu(null);
      switch (action) {
        case "open":
          if (entry?.isDir) void navigateToPath(getFullPath(entry));
          break;
        case "openTerminal":
          if (entry?.isDir) void syncTerminalToPath(getFullPath(entry));
          break;
        case "download":
          if (entry) startDownload(transferTarget, getFullPath(entry));
          break;
        case "downloadDir":
          if (entry) startDownloadDir(transferTarget, getFullPath(entry));
          break;
        case "downloadSelected":
          selectedItems().forEach((item) =>
            item.isDir ? startDownloadDir(transferTarget, item.path) : startDownload(transferTarget, item.path)
          );
          break;
        case "cut":
        case "cutSelected":
          copyOrCut("cut", multiPaths);
          break;
        case "copy":
        case "copySelected":
          copyOrCut("copy", multiPaths);
          break;
        case "paste":
          void paste();
          break;
        case "copyCurrentPath":
          void navigator.clipboard
            .writeText(currentPathRef.current)
            .then(() => toast.success("Current path copied"))
            .catch((e) => toast.error(String(e)));
          break;
        case "rename":
          if (targetPath) startRename(targetPath);
          break;
        case "permission":
          if (targetPath) openPermission(targetPath);
          break;
        case "properties":
          if (targetPath) openProperties(targetPath);
          break;
        case "upload":
          startUpload(transferTarget, currentPath.endsWith("/") ? currentPath : currentPath + "/");
          break;
        case "uploadDir":
          startUploadDir(transferTarget, currentPath.endsWith("/") ? currentPath : currentPath + "/");
          break;
        case "newFile":
          setNameDialog("file");
          break;
        case "newFolder":
          setNameDialog("folder");
          break;
        case "delete":
        case "deleteSelected":
          setDeleteTarget({
            paths: multiPaths
              .map((path) => {
                const item = entryByPath.get(path);
                return item ? { path, name: item.name, isDir: item.isDir } : null;
              })
              .filter(Boolean) as DeleteTarget["paths"],
          });
          break;
        case "refresh":
          void loadDir(currentPathRef.current);
          break;
      }
    },
    [
      ctxMenu,
      currentPath,
      currentPathRef,
      copyOrCut,
      entryByPath,
      getFullPath,
      loadDir,
      navigateToPath,
      openPermission,
      openProperties,
      paste,
      selected,
      selectedItems,
      startDownload,
      startDownloadDir,
      startRename,
      startUpload,
      startUploadDir,
      syncTerminalToPath,
      transferTarget,
    ]
  );

  const submitNewName = async (name: string) => {
    try {
      const path = joinRemotePath(currentPathRef.current, name);
      if (nameDialog === "file") await SFTPCreateFile(sessionId, path);
      if (nameDialog === "folder") await SFTPMkdir(sessionId, path);
      setNameDialog(null);
      await loadDir(currentPathRef.current);
    } catch (e) {
      toast.error(String(e));
    }
  };

  useEffect(() => {
    if (!isOpen || !isActive) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (editable) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "c") {
        e.preventDefault();
        copyOrCut("copy");
      } else if ((e.ctrlKey || e.metaKey) && key === "x") {
        e.preventDefault();
        copyOrCut("cut");
      } else if ((e.ctrlKey || e.metaKey) && key === "v") {
        e.preventDefault();
        void paste();
      } else if (e.key === "F2") {
        e.preventDefault();
        startRename();
      } else if (e.key === "Delete" && selected.length) {
        e.preventDefault();
        setDeleteTarget({
          paths: selected
            .map((path) => {
              const item = entryByPath.get(path);
              return item ? { path, name: item.name, isDir: item.isDir } : null;
            })
            .filter(Boolean) as DeleteTarget["paths"],
        });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [copyOrCut, entryByPath, isActive, isOpen, paste, selected, startRename]);

  const totalWidth = width + HANDLE_PX;
  const selectedTotalSize = selectedEntries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size), 0);

  return (
    <>
      <div
        ref={outerRef}
        className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: isOpen ? totalWidth : 0, pointerEvents: isOpen ? "auto" : "none" }}
      >
        <div className="flex h-full" style={{ minWidth: totalWidth }}>
          <div
            className={cn(
              "w-1 cursor-col-resize hover:bg-primary/20 transition-colors shrink-0",
              isResizing && "bg-primary/30"
            )}
            onMouseDown={handleResizeStart}
          />
          <div
            ref={panelRef}
            className="flex flex-col border-l bg-background relative overflow-hidden"
            style={{ width, "--wails-drop-target": isOpen ? "drop" : undefined } as CSSProperties}
          >
            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary/30 rounded animate-in fade-in-0 duration-150">
                <div className="flex flex-col items-center gap-1 text-primary/60">
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">{t("sftp.dropToUpload")}</span>
                </div>
              </div>
            )}
            <PathToolbar
              currentPath={currentPath}
              directoryFollowMode={directoryFollowMode}
              onFollowToggle={() => void toggleFollowMode()}
              onGoHome={goHome}
              onGoUp={goUp}
              onPathInputChange={setPathInput}
              onPathSubmit={(nextPath) => void navigateToPath(nextPath)}
              onRefresh={() => void loadDir(currentPathRef.current)}
              onNewFolder={() => setNameDialog("folder")}
              onSyncPanelFromTerminal={() => void syncPanelFromTerminal()}
              onSyncTerminalToPath={() => void syncTerminalToPath(currentPath)}
              paneConnected={paneConnected}
              pathInput={pathInput}
            />
            <FileList
              clipboardCutPaths={clipboardCutPaths}
              currentPath={currentPath}
              entries={entries}
              error={error}
              loading={loading}
              onGoUp={goUp}
              onMoveEntriesToDirectory={moveEntriesToDirectory}
              onNavigate={(path) => void navigateToPath(path)}
              onOpenContextMenu={(x, y, entry) => {
                if (x < 0 || y < 0) return;
                if (!entry) {
                  setSelected([]);
                  setCtxMenu({ x, y, entry: null, selectedEntries: [] });
                  return;
                }
                const menuSelectedEntries = selected
                  .map((path) => entryByPath.get(path))
                  .filter(Boolean) as sftp_svc.FileEntry[];
                setCtxMenu({ x, y, entry, selectedEntries: menuSelectedEntries });
              }}
              onRenameCancel={() => setRenamePath(null)}
              onRenameCommit={commitRename}
              onRetry={() => void loadDir(currentPathRef.current)}
              renamePath={renamePath}
              selected={selected}
              setSelected={setSelected}
            />
            <div className="border-t px-2 py-1 text-[11px] text-muted-foreground">
              {selected.length > 1
                ? t("sftp.selectedItems", { count: selected.length, size: formatBytes(selectedTotalSize) })
                : clipboard?.items.length
                  ? clipboard.mode === "cut"
                    ? t("sftp.clipboardCut", { count: clipboard.items.length })
                    : t("sftp.clipboardCopy", { count: clipboard.items.length })
                  : t("sftp.ready")}
            </div>
            <TransferSection tabId={tabId} transfers={tabTransfers} />
          </div>
        </div>
      </div>

      {ctxMenu && (
        <FloatingMenu
          canPaste={!!clipboard?.items.length}
          ctx={ctxMenu}
          onAction={handleCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("sftp.deleteConfirmTitle")}
        description={
          deleteTarget?.paths.length === 1
            ? t("sftp.deleteConfirmDesc", { name: deleteTarget.paths[0]?.name ?? "" })
            : t("sftp.deleteMultiDesc", { count: deleteTarget?.paths.length ?? 0 })
        }
        cancelText={t("action.cancel")}
        confirmText={t("action.delete")}
        onConfirm={handleDelete}
      />
      <NameDialog
        open={!!nameDialog}
        title={nameDialog === "folder" ? t("sftp.newFolder") : t("sftp.newFile")}
        placeholder={nameDialog === "folder" ? t("sftp.folderNamePlaceholder") : t("sftp.filenamePlaceholder")}
        onCancel={() => setNameDialog(null)}
        onSubmit={submitNewName}
      />
      <PermissionDialog
        sessionId={sessionId}
        target={permissionTarget}
        onClose={() => setPermissionTarget(null)}
        onSaved={() => void loadDir(currentPathRef.current)}
      />
      <PropertiesDialog sessionId={sessionId} target={propertiesTarget} onClose={() => setPropertiesTarget(null)} />
    </>
  );
}
