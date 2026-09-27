"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";

const PRESET_COLORS = [
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#64748b",
];

export function AddDatabaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { setDatabases, selectDatabase } = useStore();
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName("");
    setFilePath("");
    setColor(PRESET_COLORS[0]);
  };

  const submit = async () => {
    if (!filePath.trim()) {
      toast.error("Please provide a file path");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          filePath: filePath.trim(),
          color,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add database");
      toast.success(`Added database "${data.database.name}"`);
      // Refresh list & select the new DB.
      const listRes = await fetch("/api/databases");
      const listData = await listRes.json();
      setDatabases(listData.databases);
      selectDatabase(data.database.id);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Connect a SQLite database
          </DialogTitle>
          <DialogDescription>
            Register an existing <code className="font-mono text-xs">.db</code> /
            <code className="font-mono text-xs">.sqlite</code> file, or create a new
            one by pointing to a path that doesn&apos;t exist yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="db-name">Display name</Label>
            <Input
              id="db-name"
              placeholder="e.g. My Project DB"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="db-path">File path</Label>
            <div className="flex gap-2">
              <Input
                id="db-path"
                placeholder="/home/user/data/app.sqlite"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
                title="Use demo path"
                onClick={() =>
                  setFilePath("/home/z/my-project/db/demo.sqlite")
                }
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Absolute path on the server. A new empty database is created if the
              file doesn&apos;t exist.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Color tag</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-md ring-2 ring-offset-2 ring-offset-background transition-all ${
                    color === c ? "ring-foreground" : "ring-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
