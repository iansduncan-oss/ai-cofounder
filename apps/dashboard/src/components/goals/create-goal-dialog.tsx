import { useState } from "react";
import { useNavigate } from "react-router";
import { useCreateGoal } from "@/api/mutations";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { GoalPriority } from "@ai-cofounder/api-client";

interface CreateGoalDialogProps {
  open: boolean;
  onClose: () => void;
  defaultConversationId?: string;
}

export function CreateGoalDialog({
  open,
  onClose,
  defaultConversationId = "default",
}: CreateGoalDialogProps) {
  const navigate = useNavigate();
  const createGoal = useCreateGoal();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<GoalPriority>("medium");
  const [conversationId, setConversationId] = useState(defaultConversationId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createGoal.mutate(
      {
        conversationId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
      },
      {
        onSuccess: (goal) => {
          onClose();
          setTitle("");
          setDescription("");
          setPriority("medium");
          navigate(`/dashboard/goals/${goal.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>Create Goal</DialogTitle>
          <DialogDescription>
            Define a new goal for agents to work on.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="goal-title" className="mb-1.5 block text-sm font-medium">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="goal-title"
              placeholder="e.g. Build user authentication system"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="goal-description" className="mb-1.5 block text-sm font-medium">
              Description
            </label>
            <Textarea
              id="goal-description"
              placeholder="Describe the goal in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="goal-priority" className="mb-1.5 block text-sm font-medium">Priority</label>
              <Select
                id="goal-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as GoalPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>

            <div>
              <label htmlFor="goal-conversation-id" className="mb-1.5 block text-sm font-medium">
                Conversation ID
              </label>
              <Input
                id="goal-conversation-id"
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || createGoal.isPending}>
            {createGoal.isPending ? "Creating..." : "Create Goal"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
