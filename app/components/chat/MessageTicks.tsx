import { CheckIcon, DoubleCheckIcon } from "../icons";

// WhatsApp-style delivery marks on your own messages: one tick sent, two
// delivered, and a plain-words note when the carrier rejected it.
export function MessageTicks({ status }: { status: string }) {
  if (status === "failed" || status === "undelivered") {
    return <span className="font-semibold text-amber-200">Not delivered</span>;
  }
  if (status === "delivered" || status === "read") return <DoubleCheckIcon className="h-3.5 w-3.5" />;
  if (status === "sent" || status === "partially_delivered") return <CheckIcon className="h-3 w-3" />;
  return <CheckIcon className="h-3 w-3 opacity-50" />;
}
