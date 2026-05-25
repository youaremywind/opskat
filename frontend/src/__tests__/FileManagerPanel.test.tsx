import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileManagerPanel } from "../components/terminal/FileManagerPanel";
import { useTerminalStore, type TerminalDirectorySyncState } from "../stores/terminalStore";
import { useSFTPStore, type SFTPTransfer } from "../stores/sftpStore";
import { ChangeSSHDirectory } from "../../wailsjs/go/ssh/SSH";
import { SFTPListDir } from "../../wailsjs/go/ssh/SSH";
import { SFTPRename } from "../../wailsjs/go/ssh/SSH";

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
  },
}));

function makeSyncState(partial: Partial<TerminalDirectorySyncState> = {}): TerminalDirectorySyncState {
  return {
    sessionId: "s1",
    cwd: "/srv/app",
    cwdKnown: true,
    shell: "/bin/bash",
    shellType: "bash",
    supported: true,
    promptReady: true,
    promptClean: true,
    busy: false,
    status: "ready",
    ...partial,
  };
}

function makeTransfer(
  partial: Partial<SFTPTransfer> & Pick<SFTPTransfer, "transferId" | "tabId" | "sessionId">
): SFTPTransfer {
  return {
    direction: "upload",
    currentFile: "test.txt",
    filesCompleted: 0,
    filesTotal: 1,
    bytesDone: 100,
    bytesTotal: 100,
    speed: 0,
    status: "active",
    ...partial,
  };
}

function createDragDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    dropEffect: "move",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((type?: string) => {
      if (type) data.delete(type);
      else data.clear();
    }),
    getData: vi.fn((type: string) => data.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

describe("FileManagerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({
      tabData: {
        tab1: {
          splitTree: { type: "terminal", sessionId: "s1" },
          activePaneId: "s1",
          panes: { s1: { sessionId: "s1", transport: "ssh", connected: true, connectedAt: Date.now() } },
          directoryFollowMode: "off",
        },
        tab2: {
          splitTree: { type: "terminal", sessionId: "s2" },
          activePaneId: "s2",
          panes: { s2: { sessionId: "s2", transport: "ssh", connected: true, connectedAt: Date.now() } },
          directoryFollowMode: "off",
        },
      },
      sessionSync: {
        s1: makeSyncState(),
        s2: makeSyncState({ sessionId: "s2", cwd: "/srv/www" }),
      },
      connections: {},
      connectingAssetIds: new Set(),
    });
    useSFTPStore.setState({
      transfers: {},
      fileManagerOpenTabs: { tab1: true, tab2: true },
      fileManagerPaths: { tab1: "/srv/app", tab2: "/srv/www" },
      fileManagerWidth: 280,
    });
    vi.mocked(SFTPListDir).mockResolvedValue([]);
  });

  it("syncs the file manager to the active terminal cwd", async () => {
    const user = userEvent.setup();
    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await waitFor(() => expect(SFTPListDir).toHaveBeenCalledWith("s1", "/srv/app"));
    vi.clearAllMocks();

    useTerminalStore.getState().setSessionSyncState("s1", makeSyncState({ cwd: "/srv/releases" }));

    await user.click(screen.getByRole("button", { name: "sftp.sync.panelFromTerminal" }));

    await waitFor(() => expect(SFTPListDir).toHaveBeenCalledWith("s1", "/srv/releases"));
    expect(useSFTPStore.getState().fileManagerPaths.tab1).toBe("/srv/releases");
  });

  it("changes the active terminal directory to the current file manager path", async () => {
    const user = userEvent.setup();
    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await waitFor(() => expect(SFTPListDir).toHaveBeenCalledWith("s1", "/srv/app"));
    vi.clearAllMocks();

    await user.click(screen.getByRole("button", { name: "sftp.sync.terminalFromPanel" }));

    expect(ChangeSSHDirectory).toHaveBeenCalledWith("s1", "/srv/app");
  });

  it("keeps panel navigation aligned with the terminal when follow mode is enabled", async () => {
    const user = userEvent.setup();
    vi.mocked(SFTPListDir)
      .mockResolvedValueOnce([
        {
          name: "logs",
          isDir: true,
          size: 0,
          modTime: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    useTerminalStore.getState().setDirectoryFollowMode("tab1", "always");

    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("logs")).toBeInTheDocument());
    vi.clearAllMocks();

    await user.dblClick(screen.getByText("logs"));

    await waitFor(() => {
      expect(ChangeSSHDirectory).toHaveBeenCalledWith("s1", "/srv/app/logs");
      expect(SFTPListDir).toHaveBeenCalledWith("s1", "/srv/app/logs");
    });
  });

  it("does not enable follow mode while the active pane is busy", async () => {
    const user = userEvent.setup();
    useTerminalStore.getState().setSessionSyncState("s1", makeSyncState({ busy: true, promptClean: false }));

    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "sftp.sync.followToggle" }));

    expect(toastError).toHaveBeenCalledWith("sftp.sync.busy");
    expect(useTerminalStore.getState().tabData.tab1.directoryFollowMode).toBe("off");
  });

  it("renders only transfers owned by the current tab", async () => {
    useSFTPStore.setState({
      transfers: {
        t1: makeTransfer({ transferId: "t1", tabId: "tab1", sessionId: "s1", currentFile: "file-one.txt" }),
        t2: makeTransfer({ transferId: "t2", tabId: "tab2", sessionId: "s2", currentFile: "file-two.txt" }),
      },
    });

    render(<FileManagerPanel tabId="tab2" sessionId="s2" isOpen width={280} onWidthChange={vi.fn()} />);

    expect(screen.queryByText("file-one.txt")).not.toBeInTheDocument();
    expect(screen.getByText("file-two.txt")).toBeInTheDocument();
  });

  it("refreshes only when an upload owned by the current tab completes", async () => {
    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await waitFor(() => expect(SFTPListDir).toHaveBeenCalledWith("s1", "/srv/app"));
    vi.clearAllMocks();

    useSFTPStore.setState({
      transfers: {
        t2: makeTransfer({
          transferId: "t2",
          tabId: "tab2",
          sessionId: "s2",
          currentFile: "other-tab.txt",
          status: "done",
        }),
      },
    });
    await Promise.resolve();
    expect(SFTPListDir).not.toHaveBeenCalled();

    useSFTPStore.setState({
      transfers: {
        t1: makeTransfer({
          transferId: "t1",
          tabId: "tab1",
          sessionId: "s1",
          currentFile: "current-tab.txt",
          status: "done",
        }),
      },
    });

    await waitFor(() => expect(SFTPListDir).toHaveBeenCalledWith("s1", "/srv/app"));
  });

  it("moves a dragged file into a dropped folder", async () => {
    vi.mocked(SFTPListDir).mockResolvedValue([
      { name: "logs", isDir: true, size: 0, modTime: 0 },
      { name: "app.log", isDir: false, size: 42, modTime: 0 },
    ]);

    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("app.log")).toBeInTheDocument());

    const fileRow = screen.getByText("app.log").closest("[data-sftp-entry-row]");
    const folderRow = screen.getByText("logs").closest("[data-sftp-entry-row]");
    expect(fileRow).toBeTruthy();
    expect(folderRow).toBeTruthy();

    const dataTransfer = createDragDataTransfer();
    fireEvent.dragStart(fileRow!, { dataTransfer });
    fireEvent.dragOver(folderRow!, { dataTransfer });
    fireEvent.drop(folderRow!, { dataTransfer });

    await waitFor(() => {
      expect(SFTPRename).toHaveBeenCalledWith("s1", "/srv/app/app.log", "/srv/app/logs/app.log");
    });
  });

  it("moves a file when pointer-dragged onto a folder row", async () => {
    vi.mocked(SFTPListDir).mockResolvedValue([
      { name: "logs", isDir: true, size: 0, modTime: 0 },
      { name: "app.log", isDir: false, size: 42, modTime: 0 },
    ]);

    render(<FileManagerPanel tabId="tab1" sessionId="s1" isOpen width={280} onWidthChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("app.log")).toBeInTheDocument());

    const fileRow = screen.getByText("app.log").closest("[data-sftp-entry-row]");
    const folderRow = screen.getByText("logs").closest("[data-sftp-entry-row]");
    expect(fileRow).toBeTruthy();
    expect(folderRow).toBeTruthy();

    const elementFromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(folderRow as Element);

    try {
      fireEvent.pointerDown(fileRow!, { button: 0, buttons: 1, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(fileRow!, { buttons: 1, clientX: 48, clientY: 48, pointerId: 1 });
      fireEvent.pointerUp(fileRow!, { button: 0, clientX: 48, clientY: 48, pointerId: 1 });

      await waitFor(() => {
        expect(SFTPRename).toHaveBeenCalledWith("s1", "/srv/app/app.log", "/srv/app/logs/app.log");
      });
    } finally {
      elementFromPoint.mockRestore();
    }
  });
});
