import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Download,
  ExternalLink,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStaff } from "@/hooks/useStaff";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { downloadBase64, XLSX_MIME } from "@/lib/download";
import type { AssistantAction } from "@contracts/assistant";

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  includeInContext: boolean;
  actions?: AssistantAction[];
};

function localId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function welcomeMessage(): LocalMessage {
  return {
    id: "welcome",
    role: "assistant",
    content:
      "สวัสดีครับ ผมช่วยสรุปยอดขาย ตรวจสถานะกะ เช็กสต๊อก และเตรียมเอกสารตามสิทธิ์ของคุณได้ โดยจะไม่แก้ไขข้อมูลในระบบ",
    includeInContext: false,
  };
}

export default function AssistantChat() {
  const { staff } = useStaff();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([welcomeMessage()]);
  const [runningAction, setRunningAction] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const chat = trpc.assistant.chat.useMutation();

  const quickPrompts = useMemo(() => {
    if (!staff) return [];
    const prompts: string[] = [];
    if (staff.role === "admin") {
      prompts.push("สรุปภาพรวมธุรกิจทุกโมดูล");
      prompts.push("ขอเอกสารทั้งหมดที่มีในระบบ");
    }
    if (
      staff.menuPermissions.some(permission =>
        ["dashboard", "sales", "reports"].includes(permission)
      )
    ) {
      prompts.push("สรุปยอดขายวันนี้ให้หน่อย");
    }
    if (staff.menuPermissions.includes("stock")) {
      if (staff.role === "admin") {
        prompts.push("แสดงปริมาณน้ำมันคงเหลือทุกถัง");
      }
      prompts.push("ตอนนี้มีถังหรือสินค้าอะไรต่ำกว่าเกณฑ์บ้าง");
    }
    if (
      staff.menuPermissions.includes("dashboard") ||
      staff.menuPermissions.includes("shifts")
    ) {
      prompts.push("ตอนนี้มีกะเปิดอยู่หรือไม่");
    }
    prompts.push("แนะนำขั้นตอนการขายหน้าลานแบบสั้น ๆ");
    return prompts.slice(0, 6);
  }, [staff]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const sendMessage = async (preset?: string) => {
    const content = (preset ?? draft).trim();
    if (!content || chat.isPending) return;

    const userMessage: LocalMessage = {
      id: localId(),
      role: "user",
      content: content.slice(0, 2_000),
      includeInContext: true,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");

    const contextMessages = nextMessages
      .filter(message => message.includeInContext)
      .slice(-12)
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }));

    try {
      const result = await chat.mutateAsync({ messages: contextMessages });
      setMessages(current => [
        ...current,
        {
          id: localId(),
          role: "assistant",
          content: result.answer,
          includeInContext: result.includeInModelContext,
          actions: result.actions,
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง";
      setMessages(current => [
        ...current,
        {
          id: localId(),
          role: "assistant",
          content: message,
          includeInContext: false,
        },
      ]);
    }
  };

  const clearChat = () => {
    setMessages([welcomeMessage()]);
    setDraft("");
    chat.reset();
  };

  const handleAction = async (action: AssistantAction) => {
    const actionId = `${action.kind}:${action.label}`;
    if (runningAction) return;
    if (action.kind === "navigate") {
      setOpen(false);
      navigate(action.path);
      return;
    }

    setRunningAction(actionId);
    try {
      const file =
        action.kind === "download_daily_report"
          ? await utils.reports.exportDailyExcel.fetch({ date: action.date })
          : await utils.reports.exportRangeExcel.fetch({
              from: action.from,
              to: action.to,
            });
      downloadBase64(file.fileName, file.contentBase64, XLSX_MIME);
    } catch (error) {
      setMessages(current => [
        ...current,
        {
          id: localId(),
          role: "assistant",
          content:
            error instanceof Error
              ? `ดาวน์โหลดเอกสารไม่สำเร็จ: ${error.message}`
              : "ดาวน์โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่",
          includeInContext: false,
        },
      ]);
    } finally {
      setRunningAction("");
    }
  };

  if (!staff) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="เปิดผู้ช่วย AI"
          className="group fixed bottom-[calc(5.4rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-13 items-center gap-2 rounded-2xl border border-white/80 bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(79,70,229,0.38)] ring-1 ring-violet-300/40 transition hover:-translate-y-1 hover:shadow-[0_22px_55px_rgba(79,70,229,0.48)] lg:bottom-6 lg:right-7"
        >
          <span className="relative grid size-8 place-items-center rounded-xl bg-white/15">
            <Sparkles className="size-[18px] transition-transform group-hover:rotate-12 group-hover:scale-110" />
            <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-indigo-600 bg-emerald-400" />
          </span>
          <span>ผู้ช่วย AI</span>
        </button>
      </DialogTrigger>

      <DialogContent className="flex h-[min(780px,calc(100dvh-env(safe-area-inset-top)-0.5rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-2rem))] sm:max-w-[560px]">
        <DialogHeader className="shrink-0 border-b border-slate-200/80 bg-gradient-to-r from-violet-50 via-white to-cyan-50 px-5 py-4 pr-14 text-left">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20">
              <Bot className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base text-slate-900">
                ผู้ช่วย PumpPOS
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  อ่านอย่างเดียว
                </span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                DeepSeek ช่วยตีความคำถาม · ข้อมูลระบบตอบจาก backend เท่านั้น
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
            <span className="truncate">ผลข้อมูลระบบไม่ถูกส่งให้ DeepSeek</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearChat}
            className="h-8 shrink-0 px-2 text-xs text-slate-500"
          >
            <Trash2 className="size-3.5" /> ล้างแชต
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1 bg-slate-50/70">
          <div className="space-y-4 p-4 sm:p-5">
            {messages.map(message => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-2.5",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                    <Bot className="size-3.5" />
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[84%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm",
                    message.role === "user"
                      ? "rounded-br-md bg-gradient-to-br from-violet-600 to-indigo-700 text-white"
                      : "rounded-bl-md border border-slate-200/80 bg-white text-slate-700"
                  )}
                >
                  {message.content}
                  {message.role === "assistant" &&
                    message.actions &&
                    message.actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        {message.actions.map(action => {
                          const actionId = `${action.kind}:${action.label}`;
                          const downloading = runningAction === actionId;
                          return (
                            <button
                              key={actionId}
                              type="button"
                              disabled={Boolean(runningAction)}
                              onClick={() => void handleAction(action)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-left text-xs font-semibold leading-4 text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 disabled:opacity-50"
                            >
                              {downloading ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : action.kind === "navigate" ? (
                                <ExternalLink className="size-3.5" />
                              ) : (
                                <Download className="size-3.5" />
                              )}
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>
              </div>
            ))}
            {chat.isPending && (
              <div className="flex items-center gap-2.5 text-sm text-slate-500">
                <span className="grid size-7 place-items-center rounded-xl bg-violet-100 text-violet-700">
                  <Bot className="size-3.5" />
                </span>
                <span className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-sm">
                  <LoaderCircle className="size-3.5 animate-spin" />{" "}
                  กำลังตรวจข้อมูล...
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>

        {messages.length === 1 && (
          <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              คำถามแนะนำ
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 station-scrollbar">
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessage(prompt)}
                  className="shrink-0 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-slate-200/80 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 transition focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-100/60">
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value.slice(0, 2_000))}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              rows={1}
              placeholder="ถามเรื่องยอดขาย กะ สต๊อก หรือวิธีใช้งาน..."
              aria-label="ข้อความถึงผู้ช่วย AI"
              disabled={chat.isPending}
              className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60"
            />
            <Button
              type="button"
              size="icon"
              aria-label="ส่งข้อความ"
              disabled={!draft.trim() || chat.isPending}
              onClick={() => void sendMessage()}
              className="size-10 rounded-xl"
            >
              {chat.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-400">
            AI อาจตอบผิดได้ · ห้ามพิมพ์ข้อมูลส่วนบุคคลหรือรหัสลับ ·
            ตรวจสอบก่อนใช้งาน
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
