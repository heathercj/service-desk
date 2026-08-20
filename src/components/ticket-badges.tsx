import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  DRAFT: "secondary",
  SUBMITTED: "secondary",
  IN_TRIAGE: "warning",
  WAITING_FOR_CUSTOMER: "warning",
  QUEUED: "secondary",
  ASSIGNED: "default",
  IN_PROGRESS: "default",
  PENDING: "warning",
  RESOLUTION_REVIEW: "warning",
  RESOLVED: "success",
  CLOSED: "secondary",
  REOPENED: "destructive",
  CANCELLED: "secondary",
};

const PRIORITY_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  LOW: "secondary",
  MEDIUM: "default",
  HIGH: "warning",
  URGENT: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "default"}>{titleCase(status)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority] ?? "default"}>
      {titleCase(priority)} priority
    </Badge>
  );
}

export function DepartmentBadge({ name }: { name: string }) {
  return <Badge variant="outline">{name}</Badge>;
}
