import { useState } from "react";
import { useCreatePattern } from "@/api/mutations";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CreatePatternDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePatternDialog({ open, onClose }: CreatePatternDialogProps) {
  const createMutation = useCreatePattern();

  const [patternType, setPatternType] = useState("time_preference");
  const [description, setDescription] = useState("");
  const [suggestedAction, setSuggestedAction] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [hourStart, setHourStart] = useState<string>("");
  const [hourEnd, setHourEnd] = useState<string>("");
  const [confidence, setConfidence] = useState(50);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description || !suggestedAction) return;

    const triggerCondition: Record<string, unknown> = {};
    if (dayOfWeek !== "") triggerCondition.dayOfWeek = Number(dayOfWeek);
    if (hourStart !== "" && hourEnd !== "") {
      triggerCondition.hourRange = [Number(hourStart), Number(hourEnd)];
    }

    createMutation.mutate(
      { patternType, description, suggestedAction, triggerCondition, confidence },
      {
        onSuccess: () => {
          onClose();
          resetForm();
        },
      },
    );
  }

  function resetForm() {
    setPatternType("time_preference");
    setDescription("");
    setSuggestedAction("");
    setDayOfWeek("");
    setHourStart("");
    setHourEnd("");
    setConfidence(50);
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Create Pattern</DialogTitle>
          <DialogDescription>
            Manually define a behavioral pattern for anticipatory suggestions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <div>
            <label htmlFor="pattern-type" className="mb-1 block text-sm font-medium">Type</label>
            <select
              id="pattern-type"
              value={patternType}
              onChange={(e) => setPatternType(e.target.value)}
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
            >
              <option value="time_preference">Time preference</option>
              <option value="sequence">Sequence</option>
              <option value="recurring_action">Recurring action</option>
            </select>
          </div>

          <div>
            <label htmlFor="pattern-description" className="mb-1 block text-sm font-medium">Description</label>
            <input
              id="pattern-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Usually deploys on Friday afternoons"
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="pattern-action" className="mb-1 block text-sm font-medium">Suggested Action</label>
            <input
              id="pattern-action"
              type="text"
              value={suggestedAction}
              onChange={(e) => setSuggestedAction(e.target.value)}
              placeholder="e.g., Run tests before deploying"
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="pattern-day" className="mb-1 block text-sm font-medium">Day of Week</label>
              <select
                id="pattern-day"
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
              <label htmlFor="pattern-hour-start" className="mb-1 block text-sm font-medium">Hour Start</label>
              <input
                id="pattern-hour-start"
                type="number"
                min={0}
                max={23}
                value={hourStart}
                onChange={(e) => setHourStart(e.target.value)}
                placeholder="0"
                className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="pattern-hour-end" className="mb-1 block text-sm font-medium">Hour End</label>
              <input
                id="pattern-hour-end"
                type="number"
                min={0}
                max={23}
                value={hourEnd}
                onChange={(e) => setHourEnd(e.target.value)}
                placeholder="23"
                className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="pattern-confidence" className="mb-1 block text-sm font-medium">
              Confidence: {confidence}%
            </label>
            <input
              id="pattern-confidence"
              type="range"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              aria-label={`Confidence: ${confidence}%`}
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
