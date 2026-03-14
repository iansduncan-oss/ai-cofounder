import { useState, useEffect } from "react";
import { useUpdatePattern } from "@/api/mutations";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { UserPattern } from "@ai-cofounder/api-client";

interface EditPatternDialogProps {
  open: boolean;
  onClose: () => void;
  pattern: UserPattern;
}

export function EditPatternDialog({ open, onClose, pattern }: EditPatternDialogProps) {
  const updateMutation = useUpdatePattern();

  const [description, setDescription] = useState(pattern.description);
  const [suggestedAction, setSuggestedAction] = useState(pattern.suggestedAction);
  const trigger = pattern.triggerCondition as Record<string, unknown> | null;
  const [dayOfWeek, setDayOfWeek] = useState<string>(
    trigger?.dayOfWeek !== undefined ? String(trigger.dayOfWeek) : "",
  );
  const hourRange = Array.isArray(trigger?.hourRange) ? trigger.hourRange as number[] : [];
  const [hourStart, setHourStart] = useState<string>(
    hourRange.length === 2 ? String(hourRange[0]) : "",
  );
  const [hourEnd, setHourEnd] = useState<string>(
    hourRange.length === 2 ? String(hourRange[1]) : "",
  );
  const [confidence, setConfidence] = useState(pattern.confidence);

  // Re-sync form when pattern changes
  useEffect(() => {
    setDescription(pattern.description);
    setSuggestedAction(pattern.suggestedAction);
    const t = pattern.triggerCondition as Record<string, unknown> | null;
    setDayOfWeek(t?.dayOfWeek !== undefined ? String(t.dayOfWeek) : "");
    const hr = Array.isArray(t?.hourRange) ? t.hourRange as number[] : [];
    setHourStart(hr.length === 2 ? String(hr[0]) : "");
    setHourEnd(hr.length === 2 ? String(hr[1]) : "");
    setConfidence(pattern.confidence);
  }, [pattern]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const triggerCondition: Record<string, unknown> = {};
    if (dayOfWeek !== "") triggerCondition.dayOfWeek = Number(dayOfWeek);
    if (hourStart !== "" && hourEnd !== "") {
      triggerCondition.hourRange = [Number(hourStart), Number(hourEnd)];
    }

    updateMutation.mutate(
      { id: pattern.id, description, suggestedAction, triggerCondition, confidence },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Edit Pattern</DialogTitle>
          <DialogDescription>
            Update pattern details and trigger conditions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Suggested Action</label>
            <input
              type="text"
              value={suggestedAction}
              onChange={(e) => setSuggestedAction(e.target.value)}
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Day of Week</label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              >
                <option value="">Any</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Hour Start</label>
              <input
                type="number"
                min={0}
                max={23}
                value={hourStart}
                onChange={(e) => setHourStart(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Hour End</label>
              <input
                type="number"
                min={0}
                max={23}
                value={hourEnd}
                onChange={(e) => setHourEnd(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Confidence: {confidence}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
