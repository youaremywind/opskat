import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Button, Input } from "@opskat/ui";

interface NameDialogProps {
  open: boolean;
  title: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

export function NameDialog({ open, title, placeholder, onCancel, onSubmit }: NameDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={name}
          placeholder={placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("action.cancel")}
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            {t("action.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
