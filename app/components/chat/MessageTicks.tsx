import { CheckIcon, DoubleCheckIcon } from "../icons";

// WhatsApp-style delivery marks on your own messages: one tick sent, two
// delivered, and a plain-words note when the carrier rejected it.
export function MessageTicks({ status, onOpenInfo }: { status: string; onOpenInfo?: () => void }) {
  if (status === "failed" || status === "undelivered") {
    // Tappable: the carrier's actual rejection reason (e.g. "landline",
    // "filtered", "unregistered number") only shows up in message info,
    // since this label alone can't say why - jump straight there.
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpenInfo?.(); }} className="font-semibold text-amber-200 underline decoration-dotted underline-offset-2">
        Not delivered
      </button>
    );
  }
  if (status === "delivered" || status === "read") return <DoubleCheckIcon className="h-3.5 w-3.5" />;
  if (status === "sent" || status === "partially_delivered") return <CheckIcon className="h-3 w-3" />;
  return <CheckIcon className="h-3 w-3 opacity-50" />;
}
