import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Settings as SettingsIcon,
  Store,
  Fuel,
  UserCog,
  UsersRound,
  Plus,
  Pencil,
  Gift,
  Trash2,
  Gauge,
  FileText,
  ImagePlus,
  Database,
  History,
  Save,
  Printer,
  Network,
  Copy,
  Cloud,
  Download,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  BrainCircuit,
  KeyRound,
  Wallet,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppConfirm } from "@/components/AppConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { useDesktopSync } from "@/hooks/useDesktopSync";
import {
  fmtMoney,
  fmtNum,
  fmtDateTime,
  categoryLabel,
  roleLabel,
} from "@/lib/format";
import {
  createInitialSettingsForm,
  createProductUpdatePatch,
  resolveManagedBackupHealth,
  staffMutationErrorMessage,
  staffPasswordValidationMessage,
  type EditableProductValues,
} from "./settingsForm";
import type { Product } from "@db/schema";
import {
  MENU_PERMISSION_DEFINITIONS,
  MENU_PERMISSION_GROUP_LABELS,
  getRoleMenuPermissions,
  isRoleEligibleForMenu,
  normalizeMenuPermissions,
  type MenuPermissionGroup,
  type MenuPermissionKey,
  type StaffRole,
} from "@contracts/menuPermissions";

function staffMenuPermissions(
  role: StaffRole,
  value: unknown
): MenuPermissionKey[] {
  const stored = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
  return normalizeMenuPermissions(role, stored);
}

const emptyProduct = {
  code: "",
  name: "",
  category: "other" as "fuel" | "lubricant" | "other",
  unit: "ชิ้น",
  price: 0,
  cost: 0,
  stockQty: 0,
  lowStockAt: 0,
};

const INTERNAL_SETTING_KEYS = new Set([
  "product_display_order",
  "tank_display_order",
  "backup_restore_drill_v1",
]);

function SortableProductRow({
  id,
  label,
  active,
  enabled,
  saving,
  children,
}: {
  id: number;
  label: string;
  active: boolean;
  enabled: boolean;
  saving: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled || saving });

  return (
    <TableRow
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 30 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
      className={`${!active ? "opacity-50" : ""} ${
        isDragging ? "bg-background shadow-lg" : ""
      }`}
    >
      {enabled && (
        <TableCell className="w-12 px-2">
          <button
            ref={setActivatorNodeRef}
            type="button"
            disabled={saving}
            className="grid size-8 touch-none place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-wait disabled:opacity-50 md:cursor-grab"
            aria-label={`ลากเพื่อย้ายตำแหน่ง ${label}`}
            title="กดค้างแล้วลากเพื่อสลับตำแหน่ง"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        </TableCell>
      )}
      {children}
    </TableRow>
  );
}

function fmtFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupTriggerLabel(
  trigger: "manual" | "scheduled" | "monthly"
): string {
  if (trigger === "manual") return "สั่งสำรองเอง";
  if (trigger === "monthly") return "สำเนารายเดือน";
  return "อัตโนมัติ";
}

type BackupSelection = {
  objectName: string;
  fileName: string;
  sha256: string;
  trigger: "manual" | "scheduled" | "monthly";
};

type RestoreDrillCheckKey =
  "login" | "dashboard" | "shifts" | "sales" | "stock" | "credit" | "audit";

type RestoreDrillForm = {
  performedAt: string;
  result: "passed" | "failed";
  rpoMinutes: string;
  rtoMinutes: string;
  targetProject: string;
  backupReference: string;
  notes: string;
  checks: Record<RestoreDrillCheckKey, boolean>;
};

const RESTORE_DRILL_CHECKS: Array<{
  key: RestoreDrillCheckKey;
  label: string;
}> = [
  { key: "login", label: "เข้าสู่ระบบ" },
  { key: "dashboard", label: "Dashboard และยอดรวม" },
  { key: "shifts", label: "ข้อมูลกะ" },
  { key: "sales", label: "รายการขาย" },
  { key: "stock", label: "สต๊อกสินค้าและถังน้ำมัน" },
  { key: "credit", label: "ลูกหนี้และเครดิต" },
  { key: "audit", label: "Audit log" },
];

function dateTimeLocalValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialRestoreDrillForm(): RestoreDrillForm {
  return {
    performedAt: dateTimeLocalValue(),
    result: "passed",
    rpoMinutes: "",
    rtoMinutes: "",
    targetProject: "",
    backupReference: "",
    notes: "",
    checks: {
      login: false,
      dashboard: false,
      shifts: false,
      sales: false,
      stock: false,
      credit: false,
      audit: false,
    },
  };
}

function restoreDrillIsOverdue(
  performedAt: string | undefined,
  cadenceDays: number
): boolean {
  if (!performedAt) return true;
  const performed = new Date(performedAt).getTime();
  return (
    !Number.isFinite(performed) ||
    Date.now() - performed > cadenceDays * 24 * 60 * 60 * 1_000
  );
}

type AiProvider = "ollama" | "deepseek";

type AccessGroupForm = {
  id?: number;
  name: string;
  description: string;
  role: "manager" | "cashier";
  menuPermissions: MenuPermissionKey[];
};

type BranchOption = {
  id: number;
  code: string;
  name: string;
};

function StaffBranchSelector({
  branches,
  value,
  onChange,
}: {
  branches: readonly BranchOption[];
  value: readonly number[];
  onChange: (branchIds: number[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border bg-slate-50/70 p-3">
      <Label>สาขาที่เข้าใช้งานได้</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {branches.map(branch => {
          const checked = value.includes(branch.id);
          return (
            <label
              key={branch.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? value.filter(id => id !== branch.id)
                      : [...value, branch.id]
                  )
                }
                className="size-4 accent-violet-600"
              />
              <span className="font-medium">{branch.code}</span>
              <span className="truncate text-muted-foreground">
                {branch.name}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function MenuPermissionEditor({
  role,
  value,
  onChange,
}: {
  role: StaffRole;
  value: MenuPermissionKey[];
  onChange: (permissions: MenuPermissionKey[]) => void;
}) {
  if (role === "admin") {
    return (
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4" /> ผู้ดูแลระบบใช้ได้ทุกเมนู
        </div>
        <p className="mt-1 text-xs text-violet-700/80">
          สิทธิ์ของ admin จะเปิดครบเสมอเพื่อป้องกันระบบไม่มีผู้ดูแล
        </p>
      </div>
    );
  }

  const eligible = MENU_PERMISSION_DEFINITIONS.filter(item =>
    isRoleEligibleForMenu(role, item.key)
  );
  const selected = new Set(value);
  const groups: MenuPermissionGroup[] = [
    "station",
    "customer",
    "document",
    "system",
  ];

  return (
    <div className="space-y-3 rounded-2xl border bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">เมนูที่อนุญาตให้ใช้งาน</div>
          <div className="text-xs text-muted-foreground">
            เมนูที่ปิดจะไม่แสดงและเปิดด้วย URL โดยตรงไม่ได้
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange(eligible.map(item => item.key))}
          >
            เปิดทั้งหมด
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange([])}
          >
            ปิดทั้งหมด
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map(group => {
          const items = eligible.filter(item => item.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="rounded-xl border bg-white p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">
                {MENU_PERMISSION_GROUP_LABELS[group]}
              </div>
              <div className="space-y-2.5">
                {items.map(item => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                  >
                    <span>{item.label}</span>
                    <Switch
                      checked={selected.has(item.key)}
                      onCheckedChange={checked =>
                        onChange(
                          checked
                            ? [...value, item.key]
                            : value.filter(key => key !== item.key)
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {value.length === 0 && (
        <p className="text-xs font-medium text-destructive">
          กรุณาเปิดอย่างน้อย 1 เมนูก่อนบันทึก
        </p>
      )}
    </div>
  );
}

type AccessGroupOption = {
  id: number;
  name: string;
  role: "manager" | "cashier";
  menuPermissions: MenuPermissionKey[];
};

function StaffGroupBadge({
  groupId,
  groups,
}: {
  groupId: unknown;
  groups: AccessGroupOption[];
}) {
  const group =
    typeof groupId === "number"
      ? groups.find(item => item.id === groupId)
      : null;
  return group ? (
    <span className="rounded-full bg-violet-50 px-1.5 py-0.5 font-medium">
      กลุ่ม {group.name}
    </span>
  ) : null;
}

function StaffAccessSelector({
  role,
  accessGroupId,
  menuPermissions,
  groups,
  onGroupChange,
  onPermissionsChange,
}: {
  role: StaffRole;
  accessGroupId: number | null;
  menuPermissions: MenuPermissionKey[];
  groups: AccessGroupOption[];
  onGroupChange: (groupId: number | null) => void;
  onPermissionsChange: (permissions: MenuPermissionKey[]) => void;
}) {
  if (role === "admin") {
    return (
      <MenuPermissionEditor
        role={role}
        value={menuPermissions}
        onChange={onPermissionsChange}
      />
    );
  }

  const eligibleGroups = groups.filter(group => group.role === role);
  const selectedGroup = eligibleGroups.find(
    group => group.id === accessGroupId
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>กลุ่มสิทธิ์</Label>
        <Select
          value={accessGroupId ? String(accessGroupId) : "individual"}
          onValueChange={value =>
            onGroupChange(value === "individual" ? null : Number(value))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="individual">กำหนดเฉพาะผู้ใช้คนนี้</SelectItem>
            {eligibleGroups.map(group => (
              <SelectItem key={group.id} value={String(group.id)}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          เมื่อเลือกกลุ่ม ผู้ใช้จะรับการเปลี่ยนแปลงสิทธิ์ของกลุ่มโดยอัตโนมัติ
        </p>
      </div>

      {selectedGroup ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
            <UsersRound className="size-4" /> รับสิทธิ์จากกลุ่ม{" "}
            {selectedGroup.name}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MENU_PERMISSION_DEFINITIONS.filter(item =>
              selectedGroup.menuPermissions.includes(item.key)
            ).map(item => (
              <span
                key={item.key}
                className="rounded-full bg-white px-2 py-1 text-[11px] text-violet-700 ring-1 ring-violet-100"
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <MenuPermissionEditor
          role={role}
          value={menuPermissions}
          onChange={onPermissionsChange}
        />
      )}
    </div>
  );
}

export default function Settings() {
  const confirmAction = useAppConfirm();
  const { staff } = useStaff();
  const {
    status: desktopSyncStatus,
    exportRecovery,
    importRecovery,
  } = useDesktopSync();
  const utils = trpc.useUtils();
  const isAdmin = staff?.role === "admin";
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;
  // RealtimeProvider refreshes active queries when another station changes
  // data. A five-second poll made this large settings screen reload even while
  // idle, so keep one cached query and refresh explicitly after writes.
  const {
    data: settingMap,
    isPending: settingsPending,
    isError: settingsError,
    error: settingsQueryError,
    refetch: refetchSettings,
  } = trpc.catalog.getSettings.useQuery();
  const { data: shopLogo } = trpc.catalog.getShopLogo.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const productSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const { data: publicStaffList } = trpc.auth.listStaff.useQuery();
  const { data: staffAccessList } = trpc.auth.listStaffAccess.useQuery(
    undefined,
    {
      enabled: isAdmin,
    }
  );
  const { data: allBranches } = trpc.auth.listAllBranches.useQuery(undefined, {
    enabled: isAdmin,
  });
  const { data: accessGroups } = trpc.auth.listAccessGroups.useQuery(
    undefined,
    {
      enabled: isAdmin,
    }
  );
  const staffList = isAdmin ? staffAccessList : publicStaffList;
  const { data: rewards } = trpc.membership.listRewards.useQuery();
  const { data: pumps } = trpc.catalog.listPumps.useQuery();
  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const { data: lanInfo } = trpc.catalog.lanInfo.useQuery();
  const { data: currentShift } = trpc.pos.currentShift.useQuery();
  const {
    data: aiConfig,
    isPending: aiConfigPending,
    isError: aiConfigError,
    error: aiConfigQueryError,
    refetch: refetchAiConfig,
  } = trpc.assistant.config.useQuery(undefined, {
    enabled: isAdmin,
  });

  // Layout เรียก getSettings ไว้ก่อนแล้วบ่อยครั้ง query จึงมีข้อมูลใน cache ตั้งแต่ render แรก
  // ต้องนำ cache มาเป็นค่าเริ่มต้นทันที ไม่เช่นนั้น prevSettingMap จะเท่ากันและฟอร์มจะค้างเป็น {}
  const [form, setForm] = useState<Record<string, string>>(() =>
    createInitialSettingsForm(settingMap)
  );
  const [logoData, setLogoData] = useState<string | null>(null); // null=ไม่เปลี่ยน, ""=ลบโลโก้, อื่นๆ=data URL ใหม่
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [editP, setEditP] = useState<
    (Partial<Product> & typeof emptyProduct) | null
  >(null);
  const [initialEditP, setInitialEditP] =
    useState<EditableProductValues | null>(null);
  const [histP, setHistP] = useState<Product | null>(null); // สินค้าที่กำลังดูประวัติเปลี่ยนราคา
  const { data: priceHist } = trpc.catalog.priceHistory.useQuery(
    { productId: histP?.id ?? 0 },
    { enabled: histP != null }
  );
  const [showStaff, setShowStaff] = useState(false);
  const [showBranch, setShowBranch] = useState(false);
  const [newBranch, setNewBranch] = useState({
    code: "",
    name: "",
    address: "",
    phone: "",
    taxId: "",
    cloneCurrentSetup: true,
  });
  const [editAccessGroup, setEditAccessGroup] =
    useState<AccessGroupForm | null>(null);
  const [newStaff, setNewStaff] = useState({
    username: "",
    password: "",
    name: "",
    role: "cashier" as "admin" | "manager" | "cashier",
    accessGroupId: null as number | null,
    menuPermissions: getRoleMenuPermissions("cashier"),
    branchIds: staff?.branch.id ? [staff.branch.id] : ([] as number[]),
  });
  const [editS, setEditS] = useState<{
    id: number;
    username: string;
    name: string;
    role: "admin" | "manager" | "cashier";
    accessGroupId: number | null;
    password: string;
    menuPermissions: MenuPermissionKey[];
    branchIds: number[];
  } | null>(null);
  const [editPump, setEditPump] = useState<{
    id?: number;
    name: string;
  } | null>(null);
  const [editN, setEditN] = useState<{
    id?: number;
    pumpId: number;
    label: string;
    productId: number;
    tankId: number | null;
    meter: number;
    money: number;
  } | null>(null);
  const [editR, setEditR] = useState<{
    id?: number;
    name: string;
    pointsRequired: number;
    stock: number;
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [downloadingBackup, setDownloadingBackup] = useState("");
  const [restoreBackupTarget, setRestoreBackupTarget] =
    useState<BackupSelection | null>(null);
  const [deleteBackupTarget, setDeleteBackupTarget] =
    useState<BackupSelection | null>(null);
  const [deleteBackupConfirmation, setDeleteBackupConfirmation] = useState("");
  const [restoreDrillOpen, setRestoreDrillOpen] = useState(false);
  const [restoreDrillForm, setRestoreDrillForm] = useState<RestoreDrillForm>(
    initialRestoreDrillForm
  );
  const [aiProvider, setAiProvider] = useState<AiProvider>(
    () => aiConfig?.provider ?? "ollama"
  );
  const [aiOllamaModel, setAiOllamaModel] = useState(
    () => aiConfig?.ollamaModel ?? "qwen3:4b-instruct"
  );
  const [aiDeepseekModel, setAiDeepseekModel] = useState(
    () => aiConfig?.deepseekModel ?? "deepseek-v4-flash"
  );
  const [aiDeepseekApiKey, setAiDeepseekApiKey] = useState("");

  // sync ฟอร์มจาก settingMap ด้วย pattern adjust-state-during-render (แทน useEffect เพื่อเลี่ยง cascading render)
  // merge แบบเก็บ keys ที่แก้ค้างไว้ (ค่าต่างจาก snapshot รอบก่อนและยังไม่ตรง server รอบใหม่)
  // — กัน refetch (TanStack refetch ตอน window focus) ล้างค่าที่ยังไม่บันทึก
  const [prevSettingMap, setPrevSettingMap] = useState(settingMap);
  if (settingMap !== prevSettingMap) {
    setPrevSettingMap(settingMap);
    if (settingMap) {
      setForm(f => {
        const merged = { ...settingMap };
        for (const k of Object.keys(f)) {
          // ยังไม่เคยโหลด settingMap — ทุก key ในฟอร์มคือการแก้ของผู้ใช้ เก็บไว้ทั้งหมด
          if (!prevSettingMap) {
            merged[k] = f[k];
            continue;
          }
          if (
            f[k] !== (prevSettingMap[k] ?? "") &&
            f[k] !== (settingMap[k] ?? "")
          )
            merged[k] = f[k];
        }
        return merged;
      });
    }
  }

  const [prevAiConfig, setPrevAiConfig] = useState(aiConfig);
  if (aiConfig !== prevAiConfig) {
    setPrevAiConfig(aiConfig);
    if (aiConfig) {
      setAiProvider(aiConfig.provider);
      setAiOllamaModel(aiConfig.ollamaModel);
      setAiDeepseekModel(aiConfig.deepseekModel);
      setAiDeepseekApiKey("");
    }
  }

  const ok = (m: string) => {
    setMsg(m);
    setErr("");
    setTimeout(() => setMsg(""), 3000);
  };
  const fail = (m: string) => {
    setErr(m);
    setMsg("");
  };

  const saveSettings = trpc.catalog.updateSettings.useMutation({
    onMutate: async () => {
      // Cancel an in-flight read so an older response cannot overwrite the
      // settings returned by this mutation.
      await utils.catalog.getSettings.cancel();
    },
    onSuccess: result => {
      // ใช้ค่าที่ API อ่านกลับจาก PostgreSQL เป็น source of truth และไม่ invalidate ซ้ำทันที
      // เพราะ invalidate อาจไปรอ request เก่าที่กำลังวิ่งอยู่แล้วนำค่าเก่ากลับมาทับหน้าจอ
      setPrevSettingMap(result.settings);
      setForm(result.settings);
      utils.catalog.getSettings.setData(undefined, result.settings);
      void utils.catalog.getShopLogo.invalidate();
      void utils.catalog.lanInfo.invalidate();
      setLogoData(null);
      ok("บันทึกการตั้งค่าลงฐานข้อมูลแล้ว");
    },
    onError: e => fail(e.message),
  });
  const saveAiConfig = trpc.assistant.updateConfig.useMutation({
    onSuccess: result => {
      setPrevAiConfig(result.config);
      setAiProvider(result.config.provider);
      setAiOllamaModel(result.config.ollamaModel);
      setAiDeepseekModel(result.config.deepseekModel);
      setAiDeepseekApiKey("");
      utils.assistant.config.setData(undefined, result.config);
      ok("บันทึกการตั้งค่า AI แล้ว");
    },
    onError: e => fail(e.message),
  });
  // ---------- QR ถุงเงิน (Krungthai Thungngern) ----------
  const {
    data: paymentConfig,
    isPending: paymentConfigPending,
    isError: paymentConfigError,
    error: paymentConfigQueryError,
    refetch: refetchPaymentConfig,
  } = trpc.payments.config.useQuery(undefined, { enabled: isAdmin });
  // lazy-init จาก query cache เหมือนฟอร์ม AI ด้านบน — กันฟอร์มไม่ hydrate ตอน
  // กลับเข้าหน้านี้ใน SPA session เดิม (useQuery คืน cached data ตั้งแต่ render แรก
  // ทำ prev === paymentConfig พอดี sync block ด้านล่างจึงไม่ทำงาน ฟอร์มค้างที่ค่า default)
  const [tngEnabled, setTngEnabled] = useState(
    () => paymentConfig?.thungngernEnabled ?? false
  );
  const [tngQrMode, setTngQrMode] = useState<"promptpay" | "merchant">(
    () => paymentConfig?.qrMode ?? "promptpay"
  );
  const [tngPromptpayId, setTngPromptpayId] = useState(
    () => paymentConfig?.promptpayId ?? ""
  );
  const [tngMerchantPayload, setTngMerchantPayload] = useState("");
  const [tngMerchantEditorOpen, setTngMerchantEditorOpen] = useState(false);
  const [tngApiSecret, setTngApiSecret] = useState("");
  const [tngTestResult, setTngTestResult] = useState("");
  const [prevPaymentConfig, setPrevPaymentConfig] = useState(paymentConfig);
  if (paymentConfig !== prevPaymentConfig) {
    setPrevPaymentConfig(paymentConfig);
    if (paymentConfig) {
      setTngEnabled(paymentConfig.thungngernEnabled);
      setTngQrMode(paymentConfig.qrMode);
      setTngPromptpayId(paymentConfig.promptpayId);
      setTngMerchantPayload("");
      setTngMerchantEditorOpen(false);
      setTngApiSecret("");
      setTngTestResult("");
    }
  }
  const savePaymentConfig = trpc.payments.updateConfig.useMutation({
    onSuccess: result => {
      setPrevPaymentConfig(result.config);
      setTngEnabled(result.config.thungngernEnabled);
      setTngQrMode(result.config.qrMode);
      setTngPromptpayId(result.config.promptpayId);
      setTngMerchantPayload("");
      setTngMerchantEditorOpen(false);
      setTngApiSecret("");
      utils.payments.config.setData(undefined, result.config);
      void utils.payments.thungngernStatus.invalidate();
      ok("บันทึกการตั้งค่าการชำระเงินแล้ว");
    },
    onError: e => fail(e.message),
  });
  const testPaymentConnection = trpc.payments.testConnection.useMutation({
    onSuccess: result => {
      setTngTestResult(
        result.mockMode
          ? "เชื่อมต่อโหมดจำลอง (SLIP2GO_MOCK) สำเร็จ"
          : `เชื่อมต่อสำเร็จ` +
              (result.shopName ? ` — ร้าน ${result.shopName}` : "") +
              (result.packageName ? ` · แพ็กเกจ ${result.packageName}` : "") +
              (result.packageExpiredDate
                ? ` · หมดอายุ ${result.packageExpiredDate}`
                : "") +
              (result.tokenRemaining != null
                ? ` · Token คงเหลือ ${result.tokenRemaining}`
                : "") +
              (result.estimatedQuotaSlip != null
                ? ` · เช็กสลิปได้ประมาณ ${result.estimatedQuotaSlip} ครั้ง`
                : "")
      );
      ok("ทดสอบการเชื่อมต่อ Slip2Go สำเร็จ");
    },
    onError: e => {
      setTngTestResult("");
      fail(e.message);
    },
  });
  const savePayments = () => {
    if (tngEnabled && tngQrMode === "promptpay" && !tngPromptpayId.trim()) {
      fail("กรุณาระบุ PromptPay ID ที่ผูกกับบัญชีถุงเงินก่อนเปิดใช้งาน");
      return;
    }
    if (
      tngEnabled &&
      tngQrMode === "merchant" &&
      !paymentConfig?.merchant &&
      !tngMerchantPayload.trim()
    ) {
      fail("กรุณาวาง QR ร้านค้าถุงเงิน (payload จากแอปถุงเงิน) ก่อนเปิดใช้งาน");
      return;
    }
    savePaymentConfig.mutate({
      thungngernEnabled: tngEnabled,
      promptpayId: tngPromptpayId.trim(),
      qrMode: tngQrMode,
      merchantPayload: tngMerchantPayload.trim() || undefined,
      apiSecret: tngApiSecret.trim() || undefined,
    });
  };
  const clearApiSecret = async () => {
    if (
      !(await confirmAction(
        "ลบ Slip2Go API Secret ที่บันทึกไว้สำหรับสาขานี้หรือไม่?"
      ))
    )
      return;
    savePaymentConfig.mutate({
      thungngernEnabled: tngEnabled,
      promptpayId: tngPromptpayId.trim(),
      qrMode: tngQrMode,
      merchantPayload: tngMerchantPayload.trim() || undefined,
      clearApiSecret: true,
    });
  };

  // ---------- webhook รับแจ้งเงินเข้าอัตโนมัติ ----------
  // URL สำหรับตั้งในแอปแจ้งเงินเข้า — ใช้ Supabase Edge ตามที่ frontend เรียก API อยู่
  // (desktop/dev ที่ไม่มี Supabase ใช้ origin เดียวกับเว็บ)
  const supabaseBaseUrl =
    import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const webhookUrl = paymentConfig
    ? `${
        supabaseBaseUrl
          ? `${supabaseBaseUrl}/functions/v1/pos-api/payments/incoming`
          : `${window.location.origin}/api/payments/incoming`
      }?branch=${paymentConfig.branchId}`
    : "";
  const [showWebhookToken, setShowWebhookToken] = useState(false);
  const copyText = (value: string, label: string) => {
    void navigator.clipboard?.writeText(value);
    ok(`คัดลอก${label}แล้ว`);
  };
  const regenerateWebhookToken = async () => {
    if (
      paymentConfig?.webhookConfigured &&
      !(await confirmAction(
        "สร้าง webhook token ใหม่? token เดิมที่ตั้งไว้ในแอปแจ้งเงินเข้าจะใช้ไม่ได้อีก"
      ))
    )
      return;
    savePaymentConfig.mutate(
      {
        thungngernEnabled: tngEnabled,
        promptpayId: tngPromptpayId.trim(),
        qrMode: tngQrMode,
        regenerateWebhookToken: true,
      },
      // token สร้างเสร็จแล้วต้องคัดลอกไปตั้งแอป — แสดงให้เห็นทันที
      { onSuccess: () => setShowWebhookToken(true) }
    );
  };

  const saveProduct = trpc.catalog.updateProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      utils.pos.currentShift.invalidate();
      setEditP(null);
      setInitialEditP(null);
      ok("บันทึกสินค้าแล้ว");
    },
    onError: () => setMsg(""),
  });
  const createProduct = trpc.catalog.createProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setEditP(null);
      setInitialEditP(null);
      ok("เพิ่มสินค้าแล้ว");
    },
    onError: () => setMsg(""),
  });
  const reorderProducts = trpc.catalog.reorderProducts.useMutation();

  const handleProductDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!isAdmin || !over || active.id === over.id || !products) return;
    const oldIndex = products.findIndex(product => product.id === active.id);
    const newIndex = products.findIndex(product => product.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = products;
    const next = arrayMove(products, oldIndex, newIndex);
    utils.catalog.listProducts.setData(undefined, next);
    setErr("");
    try {
      await reorderProducts.mutateAsync({
        productIds: next.map(product => product.id),
      });
      await utils.catalog.listProducts.invalidate();
      ok("บันทึกลำดับสินค้าแล้ว");
    } catch (error) {
      utils.catalog.listProducts.setData(undefined, previous);
      fail(
        error instanceof Error
          ? error.message
          : "บันทึกลำดับสินค้าไม่สำเร็จ กรุณาลองใหม่"
      );
    }
  };
  const createStaff = trpc.auth.createStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      utils.auth.listStaffAccess.invalidate();
      utils.auth.listAccessGroups.invalidate();
      setShowStaff(false);
      setNewStaff({
        username: "",
        password: "",
        name: "",
        role: "cashier",
        accessGroupId: null,
        menuPermissions: getRoleMenuPermissions("cashier"),
        branchIds: staff?.branch.id ? [staff.branch.id] : [],
      });
      ok("เพิ่มพนักงานแล้ว");
    },
    onError: e => fail(staffMutationErrorMessage(e)),
  });
  const createBranch = trpc.auth.createBranch.useMutation({
    onSuccess: () => {
      void utils.auth.listAllBranches.invalidate();
      void utils.auth.listBranches.invalidate();
      setShowBranch(false);
      setNewBranch({
        code: "",
        name: "",
        address: "",
        phone: "",
        taxId: "",
        cloneCurrentSetup: true,
      });
      ok("เพิ่มสาขาแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateBranch = trpc.auth.updateBranch.useMutation({
    onSuccess: () => {
      void utils.auth.listAllBranches.invalidate();
      void utils.auth.listBranches.invalidate();
      ok("อัปเดตสถานะสาขาแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateStaff = trpc.auth.updateStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      utils.auth.listStaffAccess.invalidate();
      utils.auth.listAccessGroups.invalidate();
      setEditS(null);
      ok("แก้ไขพนักงานแล้ว");
    },
    onError: e => fail(staffMutationErrorMessage(e)),
  });
  const deleteStaff = trpc.auth.deleteStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      utils.auth.listStaffAccess.invalidate();
      utils.auth.listAccessGroups.invalidate();
      ok("ลบพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createAccessGroup = trpc.auth.createAccessGroup.useMutation({
    onSuccess: () => {
      utils.auth.listAccessGroups.invalidate();
      setEditAccessGroup(null);
      ok("เพิ่มกลุ่มสิทธิ์แล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateAccessGroup = trpc.auth.updateAccessGroup.useMutation({
    onSuccess: () => {
      utils.auth.listAccessGroups.invalidate();
      utils.auth.listStaffAccess.invalidate();
      setEditAccessGroup(null);
      ok("แก้ไขกลุ่มสิทธิ์แล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteAccessGroup = trpc.auth.deleteAccessGroup.useMutation({
    onSuccess: () => {
      utils.auth.listAccessGroups.invalidate();
      utils.auth.listStaffAccess.invalidate();
      ok("ลบกลุ่มสิทธิ์แล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteProduct = trpc.catalog.deleteProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      ok("ลบสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteReward = trpc.membership.deleteReward.useMutation({
    onSuccess: () => {
      utils.membership.listRewards.invalidate();
      ok("ลบของรางวัลแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createPump = trpc.catalog.createPump.useMutation({
    onSuccess: () => {
      void utils.catalog.listPumps.invalidate();
      setEditPump(null);
      ok("เพิ่มตู้จ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updatePump = trpc.catalog.updatePump.useMutation({
    onSuccess: () => {
      void utils.catalog.listPumps.invalidate();
      setEditPump(null);
      ok("แก้ไขตู้จ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deletePump = trpc.catalog.deletePump.useMutation({
    onSuccess: () => {
      void utils.catalog.listPumps.invalidate();
      ok("ลบตู้จ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createNozzle = trpc.catalog.createNozzle.useMutation({
    onSuccess: () => {
      void utils.catalog.listPumps.invalidate();
      void utils.catalog.listTanks.invalidate();
      setEditN(null);
      ok("เพิ่มหัวจ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateNozzle = trpc.catalog.updateNozzleMeter.useMutation({
    onSuccess: () => {
      void utils.catalog.listPumps.invalidate();
      void utils.catalog.listTanks.invalidate();
      setEditN(null);
      ok("แก้ไขหัวจ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteNozzle = trpc.catalog.deleteNozzle.useMutation({
    onSuccess: () => {
      void utils.catalog.listPumps.invalidate();
      void utils.catalog.listTanks.invalidate();
      ok("ลบหัวจ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const saveReward = trpc.membership.upsertReward.useMutation({
    onSuccess: () => {
      utils.membership.listRewards.invalidate();
      setEditR(null);
      ok("บันทึกของรางวัลแล้ว");
    },
    onError: e => fail(e.message),
  });

  // ---------- ฐานข้อมูลบน Supabase ----------
  const {
    data: dbInfo,
    isFetching: dbInfoFetching,
    refetch: refetchDbInfo,
  } = trpc.dbadmin.dbInfo.useQuery(undefined, {
    enabled: isAdmin,
  });
  const managedBackupHealth =
    dbInfo === undefined
      ? undefined
      : resolveManagedBackupHealth(dbInfo.managedBackupHealth);
  const backupNow = trpc.dbadmin.backup.useMutation({
    onSuccess: async result => {
      await refetchDbInfo();
      ok(`สำรองข้อมูลสำเร็จ: ${result.backup.fileName}`);
    },
    onError: e => fail(e.message),
  });
  const deleteBackup = trpc.dbadmin.deleteBackup.useMutation({
    onSuccess: async result => {
      setDeleteBackupTarget(null);
      setDeleteBackupConfirmation("");
      await refetchDbInfo();
      ok(
        result.backup.warning
          ? `ลบ ${result.backup.fileName} แล้ว — ${result.backup.warning}`
          : `ลบไฟล์สำรอง ${result.backup.fileName} แล้ว`
      );
    },
    onError: e => fail(e.message),
  });
  const recordRestoreDrill = trpc.dbadmin.recordRestoreDrill.useMutation({
    onSuccess: async () => {
      setRestoreDrillOpen(false);
      setRestoreDrillForm(initialRestoreDrillForm());
      await refetchDbInfo();
      ok("บันทึกหลักฐานการซ้อมกู้คืนแล้ว");
    },
    onError: e => fail(e.message),
  });
  const downloadBackup = async (objectName: string) => {
    setDownloadingBackup(objectName);
    try {
      const result = await utils.dbadmin.readBackup.fetch({
        fileName: objectName,
      });
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = "";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingBackup("");
    }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // เลขถัดไปของเอกสาร: ส่งเฉพาะเมื่อแก้จากค่าที่โหลดมาจริงๆ
  // กันตัวนับถอยหลังกรณีมีการออกเอกสารระหว่างที่เปิดหน้านี้ค้างไว้
  const COUNTER_KEYS = ["receipt_next_no", "tax_invoice_next_no"];
  const saveAll = () => {
    const entries = Object.entries(form)
      .filter(
        ([k, v]) =>
          !INTERNAL_SETTING_KEYS.has(k) &&
          (!COUNTER_KEYS.includes(k) || v !== (settingMap?.[k] ?? ""))
      )
      .map(([key, value]) => ({ key, value }));
    if (logoData !== null) entries.push({ key: "shop_logo", value: logoData });
    saveSettings.mutate({ entries });
  };

  const saveAi = () => {
    saveAiConfig.mutate({
      provider: aiProvider,
      ollamaModel: aiOllamaModel.trim(),
      deepseekModel: aiDeepseekModel.trim(),
      deepseekApiKey: aiDeepseekApiKey.trim() || undefined,
    });
  };

  const clearAiApiKey = async () => {
    if (
      !(await confirmAction(
        "ลบ DeepSeek API Key ที่บันทึกไว้สำหรับสาขานี้หรือไม่?"
      ))
    )
      return;
    saveAiConfig.mutate({
      provider: aiProvider,
      ollamaModel: aiOllamaModel.trim(),
      deepseekModel: aiDeepseekModel.trim(),
      clearDeepseekApiKey: true,
    });
  };

  const onLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      fail("ไฟล์โลโก้ใหญ่เกิน 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // ย่อให้กว้างไม่เกิน 480px ก่อนเก็บเป็น base64 ลด payload
        const scale = Math.min(1, 480 / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas
          .getContext("2d")
          ?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogoData(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const nextPreview = (
    prefix: string | undefined,
    next: string | undefined,
    fallback: string
  ) =>
    `${prefix || fallback}${String(Math.max(1, Number(next ?? "1") || 1)).padStart(5, "0")}`;

  const logoShown = logoData !== null ? logoData : (shopLogo ?? "");

  // ระหว่างโหลด/โหลดพลาด อย่าแสดงฟอร์มค่า default — ผู้ใช้จะเข้าใจผิดว่าค่าที่ตั้งไว้หาย (เคยเกิดเหตุนี้จริง)
  if (settingsPending && !settingMap) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดการตั้งค่า…
      </div>
    );
  }
  if (settingsError && !settingMap) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-destructive">
          โหลดการตั้งค่าไม่สำเร็จ — เช็กว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วลองใหม่
        </p>
        <Button variant="outline" onClick={() => refetchSettings()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="page-heading flex items-center gap-2">
        <SettingsIcon className="w-6 h-6 text-primary" /> ตั้งค่าระบบ
      </h1>
      {settingsError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span>
            เชื่อมต่อฐานข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงค่าที่โหลดไว้ก่อนหน้า:{" "}
            {settingsQueryError?.message}
          </span>
          <Button size="sm" variant="outline" onClick={() => refetchSettings()}>
            ลองใหม่
          </Button>
        </div>
      )}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      <Tabs defaultValue="shop" className="gap-4">
        <TabsList className="w-full station-scrollbar">
          <TabsTrigger value="shop" className="flex-none sm:flex-1">
            <Store /> ร้านและเอกสาร
          </TabsTrigger>
          <TabsTrigger value="network" className="flex-none sm:flex-1">
            <Network /> เครือข่าย
          </TabsTrigger>
          <TabsTrigger value="products" className="flex-none sm:flex-1">
            <Fuel /> สินค้า
          </TabsTrigger>
          <TabsTrigger value="people" className="flex-none sm:flex-1">
            <UserCog /> ผู้ใช้และสาขา
          </TabsTrigger>
          <TabsTrigger value="rewards" className="flex-none sm:flex-1">
            <Gift /> ของรางวัล
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="pumps" className="flex-none sm:flex-1">
              <Gauge /> หัวจ่าย
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="ai" className="flex-none sm:flex-1">
              <BrainCircuit /> AI
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="payments" className="flex-none sm:flex-1">
              <Wallet /> การชำระเงิน
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="database" className="flex-none sm:flex-1">
              <Database /> ฐานข้อมูล
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="shop" className="mt-0 space-y-5">
          {/* ข้อมูลร้าน */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Store className="w-4 h-4" /> ข้อมูลร้าน
                (แสดงบนใบเสร็จ/ใบกำกับภาษี)
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>ชื่อร้าน</Label>
                <Input
                  value={form.shop_name ?? ""}
                  onChange={e => set("shop_name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>สาขา</Label>
                <Input
                  value={form.shop_branch ?? ""}
                  onChange={e => set("shop_branch", e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>ที่อยู่</Label>
                <Textarea
                  rows={2}
                  value={form.shop_address ?? ""}
                  onChange={e => set("shop_address", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>เลขประจำตัวผู้เสียภาษี</Label>
                <Input
                  value={form.tax_id ?? ""}
                  onChange={e => set("tax_id", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>โทรศัพท์</Label>
                <Input
                  value={form.shop_phone ?? ""}
                  onChange={e => set("shop_phone", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>อัตรา VAT (%)</Label>
                <Input
                  type="number"
                  value={form.vat_rate ?? "7"}
                  onChange={e => set("vat_rate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>สะสมแต้ม (กี่บาท = 1 แต้ม)</Label>
                <Input
                  type="number"
                  value={form.point_earn_per_baht ?? "25"}
                  onChange={e => set("point_earn_per_baht", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>มูลค่าแต้มตอนใช้ (1 แต้ม = กี่บาท)</Label>
                <Input
                  type="number"
                  value={form.point_redeem_value ?? "1"}
                  onChange={e => set("point_redeem_value", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  disabled={!isAdmin || saveSettings.isPending}
                  onClick={saveAll}
                >
                  บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* เลขที่เอกสาร & โลโก้ร้าน */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <FileText className="w-4 h-4" /> เลขที่เอกสาร & โลโก้ร้าน
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>คำนำหน้าเลขใบเสร็จอย่างย่อ</Label>
                <Input
                  maxLength={10}
                  value={form.receipt_prefix ?? "R"}
                  onChange={e => set("receipt_prefix", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  เอกสารถัดไป:{" "}
                  {nextPreview(form.receipt_prefix, form.receipt_next_no, "R")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>เลขถัดไปใบเสร็จอย่างย่อ</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.receipt_next_no ?? "1"}
                  onChange={e => set("receipt_next_no", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>คำนำหน้าเลขใบกำกับภาษี</Label>
                <Input
                  maxLength={10}
                  value={form.tax_invoice_prefix ?? "T"}
                  onChange={e => set("tax_invoice_prefix", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  เอกสารถัดไป:{" "}
                  {nextPreview(
                    form.tax_invoice_prefix,
                    form.tax_invoice_next_no,
                    "T"
                  )}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>เลขถัดไปใบกำกับภาษี</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.tax_invoice_next_no ?? "1"}
                  onChange={e => set("tax_invoice_next_no", e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>โลโก้ร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  {logoShown ? (
                    <img
                      src={logoShown}
                      alt="โลโก้ร้าน"
                      className="h-14 w-auto object-contain border rounded p-1 bg-white"
                    />
                  ) : (
                    <div className="h-14 w-28 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">
                      ยังไม่มีโลโก้
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!isAdmin}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <ImagePlus className="w-4 h-4 mr-1" /> เลือกรูป
                    </Button>
                    {logoShown && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!isAdmin}
                        onClick={() => setLogoData("")}
                      >
                        ลบโลโก้
                      </Button>
                    )}
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onLogoFile}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  รองรับไฟล์รูปไม่เกิน 2MB (ระบบย่อขนาดให้อัตโนมัติ) ·
                  กดบันทึกเพื่อยืนยัน
                </p>
              </div>
              <div className="sm:col-span-2">
                <Button
                  disabled={!isAdmin || saveSettings.isPending}
                  onClick={saveAll}
                >
                  บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* การพิมพ์เอกสาร (ผ่านเบราว์เซอร์) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Printer className="w-4 h-4" /> การพิมพ์เอกสาร
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 max-w-sm">
                <Label>ขนาดกระดาษใบเสร็จ (พิมพ์ผ่านเบราว์เซอร์)</Label>
                <Select
                  value={form.receipt_paper_size ?? "80"}
                  onValueChange={v => set("receipt_paper_size", v)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="80">ม้วนความร้อน 80 มม.</SelectItem>
                    <SelectItem value="58">ม้วนความร้อน 58 มม.</SelectItem>
                    <SelectItem value="a5">A5</SelectItem>
                    <SelectItem value="a4">A4</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  ใช้กับปุ่ม &quot;พิมพ์&quot; ธรรมดาบนใบเสร็จ —
                  ถ้าพิมพ์แล้วตัวอักษรใหญ่/ล้นขอบกระดาษ
                  ให้เลือกขนาดตรงนี้ให้ตรงกระดาษจริง
                </p>
              </div>
              <div className="space-y-1.5 max-w-sm">
                <Label>ขนาดกระดาษใบกำกับภาษีเต็มรูป</Label>
                <Select
                  value={form.tax_invoice_paper_size ?? "a4"}
                  onValueChange={v => set("tax_invoice_paper_size", v)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a4">A4</SelectItem>
                    <SelectItem value="a5">A5</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  ใช้กับใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูป
                  ทั้งหน้าพรีวิวและหน้าต่างพิมพ์
                </p>
              </div>
              {isDesktop && (
                <div className="flex items-center justify-between rounded-md border p-3 max-w-sm">
                  <div className="pr-3">
                    <Label
                      htmlFor="receipt_silent_print"
                      className="cursor-pointer"
                    >
                      พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      พิมพ์เงียบเข้าเครื่องพิมพ์ default ของ Windows
                      ทันทีโดยไม่เด้ง dialog (เฉพาะ desktop app —
                      ต้องตั้งเครื่องพิมพ์ที่ใช้เป็น default ไว้ก่อน)
                    </p>
                  </div>
                  <Switch
                    id="receipt_silent_print"
                    disabled={!isAdmin}
                    checked={form.receipt_silent_print === "1"}
                    onCheckedChange={v =>
                      set("receipt_silent_print", v ? "1" : "0")
                    }
                  />
                </div>
              )}
              <div>
                <Button
                  disabled={!isAdmin || saveSettings.isPending}
                  onClick={saveAll}
                >
                  <Save className="w-4 h-4 mr-2" /> บันทึกการตั้งค่า{" "}
                  {!isAdmin && "(เฉพาะแอดมิน)"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network" className="mt-0">
          {/* เครือข่าย LAN (ขายหลายเครื่องพร้อมกัน) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Network className="w-4 h-4" /> เครือข่าย LAN
                (ขายหลายเครื่องพร้อมกัน)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3 max-w-xl">
                <div>
                  <Label htmlFor="lan_enabled" className="cursor-pointer">
                    แสดง URL สำหรับเครื่องลูกที่หน้า Login
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    สวิตช์นี้ใช้แสดง URL เท่านั้น —
                    การเชื่อมต่อจริงต้องรันแอปแบบ LAN (npm run dev:lan หรือ npm
                    start) และอนุญาต Firewall
                  </p>
                </div>
                <Switch
                  id="lan_enabled"
                  disabled={!isAdmin}
                  checked={form.lan_enabled === "1"}
                  onCheckedChange={v => set("lan_enabled", v ? "1" : "0")}
                />
              </div>
              {form.lan_enabled === "1" && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-600">
                    มีผลหลังกดบันทึกแล้วรีสตาร์ทแอป — ถ้ารันแบบ dev ต้องรันด้วย{" "}
                    <code className="rounded bg-muted px-1">
                      npm run dev:lan
                    </code>{" "}
                    (Docker/production: restart container อย่างเดียว)
                  </p>
                  {lanInfo && lanInfo.urls.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        เครื่องลูกเปิดเบราว์เซอร์ไปที่:
                      </p>
                      {lanInfo.urls.map(u => (
                        <div key={u} className="flex items-center gap-2">
                          <code className="rounded bg-muted px-2 py-1 text-xs">
                            {u}
                          </code>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => {
                              void navigator.clipboard?.writeText(u);
                              ok("คัดลอก URL แล้ว");
                            }}
                          >
                            <Copy className="w-3 h-3 mr-1" /> คัดลอก
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      ไม่พบ IP ของเครื่องนี้ในเครือข่าย — ตรวจสอบการเชื่อมต่อ
                      LAN
                    </p>
                  )}
                  <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                    <li>
                      เครื่องลูกล็อกอินด้วย PIN ของพนักงานแต่ละคน และขายภายใต้
                      <span className="font-medium text-foreground">
                        กะรวมกะเดียวกัน
                      </span>{" "}
                      (เปิด/ปิดกะจากเครื่องใดเครื่องหนึ่ง)
                    </li>
                    <li>
                      ใบเสร็จพิมพ์ผ่านเบราว์เซอร์ของแต่ละเครื่อง
                      (เลือกเครื่องพิมพ์ของเครื่องนั้นตอนกดพิมพ์)
                    </li>
                    <li>
                      ครั้งแรก Windows อาจถามอนุญาต Firewall ให้กด Allow —
                      ถ้าเชื่อมไม่ได้ให้รัน CMD แบบ Administrator:{" "}
                      <code className="rounded bg-muted px-1">
                        netsh advfirewall firewall add rule name=&quot;POS
                        Pump&quot; dir=in action=allow protocol=TCP localport=
                        {lanInfo?.port ?? 3210}
                      </code>
                    </li>
                    <li>
                      ใช้เฉพาะใน LAN ที่เชื่อถือได้เท่านั้น — เครื่องใน LAN
                      ทุกเครื่องเข้าถึงระบบได้ผ่านหน้าล็อกอิน
                    </li>
                  </ul>
                </div>
              )}
              <div>
                <Button
                  disabled={!isAdmin || saveSettings.isPending}
                  onClick={saveAll}
                >
                  <Save className="w-4 h-4 mr-2" /> บันทึกการตั้งค่า{" "}
                  {!isAdmin && "(เฉพาะแอดมิน)"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="mt-0">
          {/* สินค้าและราคา */}
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <div>
                <CardTitle className="font-heading text-base flex items-center gap-2">
                  <Fuel className="w-4 h-4" /> สินค้า & ราคา
                </CardTitle>
                {isAdmin && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {reorderProducts.isPending
                      ? "กำลังบันทึกลำดับสินค้า..."
                      : "กดค้างที่ปุ่มจับ แล้วลากเพื่อสลับตำแหน่งสินค้า"}
                  </p>
                )}
              </div>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    saveProduct.reset();
                    createProduct.reset();
                    setErr("");
                    setInitialEditP(null);
                    setEditP({ ...emptyProduct });
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" /> เพิ่มสินค้า
                </Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <DndContext
                sensors={productSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleProductDragEnd}
              >
                <SortableContext
                  items={(products ?? []).map(product => product.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isAdmin && (
                          <TableHead className="w-12">
                            <span className="sr-only">ย้ายตำแหน่ง</span>
                          </TableHead>
                        )}
                        <TableHead>รหัส</TableHead>
                        <TableHead>สินค้า</TableHead>
                        <TableHead>หมวด</TableHead>
                        <TableHead className="text-right">ทุน</TableHead>
                        <TableHead className="text-right">ราคาขาย</TableHead>
                        <TableHead className="text-right">สต๊อก</TableHead>
                        <TableHead>สถานะ</TableHead>
                        {isAdmin && <TableHead></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(products ?? []).map(p => (
                        <SortableProductRow
                          key={p.id}
                          id={p.id}
                          label={p.name}
                          active={p.active}
                          enabled={isAdmin}
                          saving={reorderProducts.isPending}
                        >
                          <TableCell className="font-mono text-xs">
                            {p.code}
                          </TableCell>
                          <TableCell>
                            {p.name}{" "}
                            <span className="text-xs text-muted-foreground">
                              ({p.unit})
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            {categoryLabel[p.category]}
                          </TableCell>
                          <TableCell className="text-right">
                            ฿{fmtMoney(p.cost)}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-primary">
                            ฿{fmtMoney(p.price)}
                          </TableCell>
                          <TableCell className="text-right">
                            {p.category === "fuel"
                              ? "-"
                              : `${fmtNum(p.stockQty)}`}
                          </TableCell>
                          <TableCell>
                            {p.active ? (
                              <Badge variant="secondary">ขายอยู่</Badge>
                            ) : (
                              <Badge variant="destructive">ปิดขาย</Badge>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  title="ประวัติเปลี่ยนราคา"
                                  onClick={() => setHistP(p)}
                                >
                                  <History className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  title="แก้ไข"
                                  onClick={() => {
                                    saveProduct.reset();
                                    createProduct.reset();
                                    setErr("");
                                    setInitialEditP(p);
                                    setEditP(p);
                                  }}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive"
                                  disabled={deleteProduct.isPending}
                                  onClick={async () => {
                                    if (
                                      await confirmAction(
                                        `ยืนยันลบสินค้า "${p.name}"? (ประวัติขายเก่ายังคงอยู่)`
                                      )
                                    ) {
                                      deleteProduct.mutate({ id: p.id });
                                    }
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </SortableProductRow>
                      ))}
                    </TableBody>
                  </Table>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="people" className="mt-0 space-y-5">
          {isAdmin && (
            <Card className="border-violet-200/70 bg-gradient-to-br from-white to-violet-50/40">
              <CardHeader className="pb-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="font-heading flex items-center gap-2 text-base">
                    <UsersRound className="size-4 text-violet-600" />{" "}
                    กลุ่มสิทธิ์ผู้ใช้
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    กำหนดเมนูครั้งเดียว แล้วนำพนักงานหลายคนเข้าใช้กลุ่มเดียวกัน
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditAccessGroup({
                      name: "",
                      description: "",
                      role: "cashier",
                      menuPermissions: getRoleMenuPermissions("cashier"),
                    })
                  }
                >
                  <Plus className="mr-1 size-4" /> เพิ่มกลุ่ม
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(accessGroups ?? []).map(group => (
                    <div
                      key={group.id}
                      className="rounded-2xl border bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {group.name}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {group.description || "ไม่มีรายละเอียด"}
                          </div>
                        </div>
                        <Badge variant="secondary">
                          {roleLabel[group.role] ?? group.role}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                          {group.menuPermissions.length} เมนู
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                          {group.memberCount} คน
                        </span>
                      </div>
                      <div className="mt-3 flex justify-end gap-1 border-t pt-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          onClick={() =>
                            setEditAccessGroup({
                              id: group.id,
                              name: group.name,
                              description: group.description,
                              role: group.role,
                              menuPermissions: [...group.menuPermissions],
                            })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-destructive"
                          disabled={deleteAccessGroup.isPending}
                          onClick={async () => {
                            if (
                              await confirmAction(
                                `ยืนยันลบกลุ่ม "${group.name}"? สมาชิก ${group.memberCount} คนจะกลับไปใช้สิทธิ์รายบุคคล`
                              )
                            ) {
                              deleteAccessGroup.mutate({ id: group.id });
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card>
              <CardHeader className="flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2 font-heading text-base">
                    <Store className="size-4" /> สาขา
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    สินค้า สต็อก ยอดขาย กะ เอกสาร
                    และการตั้งค่าจะแยกจากกันตามสาขา
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowBranch(true)}
                >
                  <Plus className="mr-1 size-4" /> เพิ่มสาขา
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(allBranches ?? []).map(branch => (
                  <div
                    key={branch.id}
                    className="rounded-xl border bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={branch.active ? "default" : "secondary"}
                          >
                            {branch.code}
                          </Badge>
                          {branch.id === staff?.branch.id && (
                            <span className="text-xs font-medium text-violet-600">
                              กำลังใช้งาน
                            </span>
                          )}
                        </div>
                        <div className="mt-2 truncate font-medium">
                          {branch.name}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {branch.address || "ยังไม่ได้ระบุที่อยู่"}
                        </div>
                      </div>
                      <Switch
                        checked={branch.active}
                        disabled={
                          updateBranch.isPending ||
                          (branch.active && branch.id === staff?.branch.id)
                        }
                        onCheckedChange={active =>
                          updateBranch.mutate({ id: branch.id, active })
                        }
                        aria-label={`สถานะสาขา ${branch.name}`}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* พนักงาน */}
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <UserCog className="w-4 h-4" /> พนักงาน
              </CardTitle>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowStaff(true)}
                >
                  <Plus className="w-4 h-4 mr-1" /> เพิ่ม
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {(staffList ?? []).map(s => (
                <div
                  key={s.id}
                  className="flex items-center justify-between border rounded-lg px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {s.name}{" "}
                      {!s.active && (
                        <span className="text-xs text-destructive">
                          (ปิดใช้งาน)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      @{s.username}
                    </div>
                    {isAdmin && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-violet-600">
                        <span>
                          ใช้งานได้{" "}
                          {
                            staffMenuPermissions(
                              s.role,
                              "menuPermissions" in s
                                ? s.menuPermissions
                                : undefined
                            ).length
                          }{" "}
                          เมนู
                        </span>
                        <StaffGroupBadge
                          groupId={
                            "accessGroupId" in s ? s.accessGroupId : undefined
                          }
                          groups={accessGroups ?? []}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={s.role === "admin" ? "default" : "secondary"}
                    >
                      {roleLabel[s.role] ?? s.role}
                    </Badge>
                    {isAdmin && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditS({
                              id: s.id,
                              username: s.username,
                              name: s.name,
                              role: s.role,
                              accessGroupId:
                                "accessGroupId" in s &&
                                typeof s.accessGroupId === "number"
                                  ? s.accessGroupId
                                  : null,
                              password: "",
                              menuPermissions: staffMenuPermissions(
                                s.role,
                                "menuPermissions" in s
                                  ? s.menuPermissions
                                  : undefined
                              ),
                              branchIds:
                                "branchIds" in s && Array.isArray(s.branchIds)
                                  ? s.branchIds
                                  : [],
                            });
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={deleteStaff.isPending}
                          onClick={async () => {
                            if (
                              await confirmAction(
                                `ยืนยันลบพนักงาน "${s.name}"?`
                              )
                            )
                              deleteStaff.mutate({ id: s.id });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rewards" className="mt-0">
          {/* ของรางวัล */}
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Gift className="w-4 h-4" /> ของรางวัล
              </CardTitle>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditR({ name: "", pointsRequired: 100, stock: 10 })
                  }
                >
                  <Plus className="w-4 h-4 mr-1" /> เพิ่ม
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {(rewards ?? []).map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border rounded-lg px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.pointsRequired} แต้ม · คงเหลือ {r.stock}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() =>
                          setEditR({
                            id: r.id,
                            name: r.name,
                            pointsRequired: r.pointsRequired,
                            stock: r.stock,
                          })
                        }
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        disabled={deleteReward.isPending}
                        onClick={async () => {
                          if (
                            await confirmAction(
                              `ยืนยันลบของรางวัล "${r.name}"?`
                            )
                          )
                            deleteReward.mutate({ id: r.id });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pumps" className="mt-0">
          {/* ตู้จ่าย / หัวจ่าย (admin) */}
          {isAdmin && (
            <Card>
              <CardHeader className="gap-3 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="font-heading flex items-center gap-2 text-base">
                      <Gauge className="h-4 w-4" /> ตู้จ่าย & หัวจ่าย
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      เพิ่ม แก้ไข หรือลบตู้จ่ายและหัวจ่ายของสาขา{" "}
                      {staff?.branch.name ?? "ปัจจุบัน"}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setEditPump({ name: "" })}>
                    <Plus className="mr-1.5 h-4 w-4" /> เพิ่มตู้จ่าย
                  </Button>
                </div>
                {currentShift && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    ขณะมีกะเปิดอยู่ ระบบจะไม่อนุญาตให้เพิ่ม ลบ หรือย้ายหัวจ่าย
                    เพื่อให้ข้อมูลมิเตอร์ของกะตรงกัน
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {(pumps ?? []).length === 0 && (
                  <div className="rounded-xl border border-dashed px-4 py-10 text-center">
                    <Gauge className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">ยังไม่มีตู้จ่าย</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      กด “เพิ่มตู้จ่าย” เพื่อเริ่มตั้งค่าหัวจ่าย
                    </p>
                  </div>
                )}
                {(pumps ?? []).map(p => (
                  <section
                    key={p.id}
                    className="overflow-hidden rounded-xl border bg-card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/35 px-3 py-2.5 sm:px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                          <Gauge className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.nozzles.length} หัวจ่าย
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEditPump({ id: p.id, name: p.name })
                          }
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" /> แก้ชื่อตู้
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const firstTank = (tanks ?? []).find(tank =>
                              (products ?? []).some(
                                product =>
                                  product.id === tank.productId &&
                                  product.category === "fuel" &&
                                  product.active
                              )
                            );
                            const firstFuel = (products ?? []).find(
                              product =>
                                product.category === "fuel" && product.active
                            );
                            setEditN({
                              pumpId: p.id,
                              label: `${p.name} - หัวจ่าย ${p.nozzles.length + 1}`,
                              productId:
                                firstTank?.productId ?? firstFuel?.id ?? 0,
                              tankId: firstTank?.id ?? null,
                              meter: 0,
                              money: 0,
                            });
                          }}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> เพิ่มหัวจ่าย
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`ลบ ${p.name}`}
                          disabled={deletePump.isPending}
                          onClick={async () => {
                            if (
                              await confirmAction(
                                `ลบตู้จ่าย “${p.name}” หรือไม่?${
                                  p.nozzles.length > 0
                                    ? " ต้องลบหัวจ่ายในตู้นี้ให้หมดก่อน"
                                    : ""
                                }`
                              )
                            ) {
                              deletePump.mutate({ id: p.id });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2 p-3 sm:p-4">
                      {p.nozzles.length === 0 && (
                        <div className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
                          ตู้นี้ยังไม่มีหัวจ่าย
                        </div>
                      )}
                      {p.nozzles.map(n => (
                        <div
                          key={n.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{n.label}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {n.product?.name ?? "ไม่พบชนิดน้ำมัน"} · ถัง:{" "}
                              {n.tank?.name ?? "ยังไม่ผูกถัง"}
                              {" · "}P: ฿{fmtNum(n.currentMoney)} · L:{" "}
                              {fmtNum(n.currentMeter)}
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setEditN({
                                  id: n.id,
                                  pumpId: n.pumpId,
                                  label: n.label,
                                  productId: n.productId,
                                  tankId: n.tankId,
                                  meter: n.currentMeter,
                                  money: n.currentMoney,
                                })
                              }
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" /> แก้ไข
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`ลบ ${n.label}`}
                              disabled={deleteNozzle.isPending}
                              onClick={async () => {
                                if (
                                  await confirmAction(
                                    `ลบหัวจ่าย “${n.label}” หรือไม่? หัวจ่ายที่มีประวัติกะแล้วจะไม่สามารถลบได้`
                                  )
                                ) {
                                  deleteNozzle.mutate({ id: n.id });
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ai" className="mt-0 space-y-5">
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-heading text-base flex items-center gap-2">
                      <Gauge className="w-4 h-4" /> อ่านมิเตอร์จากภาพตอนตัดกะ
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      เลือกวิธีอ่านจอ seven-segment สำหรับสาขา{" "}
                      {staff?.branch.name ?? "ปัจจุบัน"}
                    </p>
                  </div>
                  <Badge variant="secondary">เฉพาะผู้ดูแลระบบ</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {settingsPending && !settingMap ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    กำลังโหลดการตั้งค่า…
                  </div>
                ) : (
                  <>
                    <RadioGroup
                      value={form.meter_ocr_mode || "gemini"}
                      onValueChange={value => set("meter_ocr_mode", value)}
                      className="grid gap-3 lg:grid-cols-3"
                    >
                      <Label
                        htmlFor="meter-ocr-local"
                        className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 hover:bg-muted/30"
                      >
                        <RadioGroupItem
                          id="meter-ocr-local"
                          value="local"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium">ไม่ใช้ AI</span>
                          <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                            อ่าน seven-segment ภายในเครื่องผู้ใช้
                            รูปภาพไม่ถูกส่งไปยังบริการภายนอก
                          </span>
                        </span>
                      </Label>

                      <Label
                        htmlFor="meter-ocr-gemini"
                        className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 hover:bg-muted/30"
                      >
                        <RadioGroupItem
                          id="meter-ocr-gemini"
                          value="gemini"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium">ใช้ Gemini</span>
                          <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                            ส่งภาพหน้าตู้ไปให้ Gemini อ่านทุกภาพ
                            เหมาะกับภาพหรือหน้าตู้หลายรูปแบบ
                          </span>
                        </span>
                      </Label>

                      <Label
                        htmlFor="meter-ocr-auto"
                        className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 hover:bg-muted/30"
                      >
                        <RadioGroupItem
                          id="meter-ocr-auto"
                          value="auto"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium">อัตโนมัติ</span>
                          <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                            อ่านในเครื่องก่อน และส่งเฉพาะภาพที่ผลไม่ครบ
                            หรือมีความมั่นใจต่ำไปให้ Gemini
                          </span>
                        </span>
                      </Label>
                    </RadioGroup>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={saveAll}
                        disabled={!isAdmin || saveSettings.isPending}
                      >
                        <Save className="mr-1.5 h-4 w-4" />
                        {saveSettings.isPending
                          ? "กำลังบันทึก…"
                          : "บันทึกวิธีอ่านมิเตอร์"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        ค่าเริ่มต้นของระบบคือ Gemini
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-heading text-base flex items-center gap-2">
                      <BrainCircuit className="w-4 h-4" /> ผู้ช่วย AI
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      เลือกผู้ให้บริการและโมเดลสำหรับสาขา{" "}
                      {staff?.branch.name ?? "ปัจจุบัน"}
                    </p>
                  </div>
                  <Badge variant="secondary">เฉพาะผู้ดูแลระบบ</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {aiConfigPending && !aiConfig ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    กำลังโหลดการตั้งค่า AI…
                  </div>
                ) : aiConfigError && !aiConfig ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm text-destructive">
                      โหลดการตั้งค่า AI ไม่สำเร็จ: {aiConfigQueryError?.message}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => void refetchAiConfig()}
                    >
                      <RefreshCw className="mr-1.5 h-4 w-4" /> ลองใหม่
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>ผู้ให้บริการ AI</Label>
                        <Select
                          value={aiProvider}
                          onValueChange={value =>
                            setAiProvider(value as AiProvider)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ollama">
                              Ollama — ทำงานในเครื่อง
                            </SelectItem>
                            <SelectItem value="deepseek">
                              DeepSeek — ใช้ Cloud API
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="ai-model">โมเดล</Label>
                        {aiProvider === "ollama" ? (
                          <>
                            <Input
                              id="ai-model"
                              list="ollama-model-options"
                              value={aiOllamaModel}
                              onChange={event =>
                                setAiOllamaModel(event.target.value)
                              }
                              placeholder="เช่น qwen3:4b-instruct"
                            />
                            <datalist id="ollama-model-options">
                              <option value="qwen3:4b-instruct" />
                              <option value="qwen3:8b" />
                              <option value="qwen3:14b" />
                            </datalist>
                          </>
                        ) : (
                          <>
                            <Input
                              id="ai-model"
                              list="deepseek-model-options"
                              value={aiDeepseekModel}
                              onChange={event =>
                                setAiDeepseekModel(event.target.value)
                              }
                              placeholder="เช่น deepseek-v4-flash"
                            />
                            <datalist id="deepseek-model-options">
                              <option value="deepseek-v4-flash" />
                              <option value="deepseek-v4-pro" />
                            </datalist>
                          </>
                        )}
                        <p className="text-xs text-muted-foreground">
                          เลือกจากรายการหรือพิมพ์ชื่อโมเดลที่ติดตั้ง/รองรับได้
                        </p>
                      </div>
                    </div>

                    {aiProvider === "ollama" ? (
                      <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 text-sm text-sky-900">
                        Ollama ไม่ต้องใช้ API Key และต้องเปิด Ollama
                        บนเครื่องที่รันเซิร์ฟเวอร์ PumpPOS
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-medium">
                            <KeyRound className="h-4 w-4" /> DeepSeek API Key
                          </div>
                          <Badge
                            variant={
                              aiConfig?.deepseekApiKeyConfigured
                                ? "default"
                                : "destructive"
                            }
                          >
                            {aiConfig?.deepseekApiKeyConfigured
                              ? "ตั้งค่าแล้ว"
                              : "ยังไม่ได้ตั้งค่า"}
                          </Badge>
                        </div>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={aiDeepseekApiKey}
                          onChange={event =>
                            setAiDeepseekApiKey(event.target.value)
                          }
                          placeholder={
                            aiConfig?.deepseekApiKeyConfigured
                              ? "เว้นว่างเพื่อใช้ Key เดิม"
                              : "วาง API Key ที่นี่"
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          ระบบไม่แสดง Key เดิมกลับมาที่หน้าเว็บ
                          และจะเข้ารหัสก่อนบันทึกลงฐานข้อมูล
                          {aiConfig?.apiKeySource === "environment"
                            ? " · ขณะนี้ใช้ Key สำรองจาก .env"
                            : ""}
                        </p>
                      </div>
                    )}

                    {aiProvider === "deepseek" &&
                      !aiConfig?.deepseekApiKeyConfigured &&
                      !aiDeepseekApiKey.trim() && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          กรุณาใส่ API Key ก่อนเปิดใช้ DeepSeek
                        </div>
                      )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        onClick={saveAi}
                        disabled={
                          saveAiConfig.isPending ||
                          !aiOllamaModel.trim() ||
                          !aiDeepseekModel.trim() ||
                          (aiProvider === "deepseek" &&
                            !aiConfig?.deepseekApiKeyConfigured &&
                            !aiDeepseekApiKey.trim())
                        }
                      >
                        <Save className="mr-1.5 h-4 w-4" />
                        {saveAiConfig.isPending
                          ? "กำลังบันทึก…"
                          : "บันทึกการตั้งค่า AI"}
                      </Button>
                      {aiConfig?.apiKeySource === "settings" && (
                        <Button
                          type="button"
                          variant="outline"
                          className="text-destructive"
                          onClick={clearAiApiKey}
                          disabled={saveAiConfig.isPending}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" /> ลบ API Key
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {aiConfig?.settingsSource === "settings"
                          ? "ใช้ค่าที่บันทึกสำหรับสาขานี้"
                          : "ยังใช้ค่าเริ่มต้นจากเซิร์ฟเวอร์"}
                      </span>
                    </div>

                    <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>
                        API Key เป็นข้อมูลแบบเขียนอย่างเดียว เก็บในตาราง private
                        แยกจากการตั้งค่าทั่วไป และเปิดจัดการเฉพาะบัญชี admin
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="payments" className="mt-0 space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-heading text-base flex items-center gap-2">
                <Wallet className="w-4 h-4" /> ช่องทางชำระเงินที่เปิดใช้งาน
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                เลือกช่องทางที่แสดงให้แคชเชียร์ในหน้าขาย (POS) — QR
                ถุงเงินตั้งค่าแยกที่การ์ดด้านล่าง
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {(
                [
                  ["pay_cash_enabled", "เงินสด"],
                  ["pay_qr_enabled", "QR พร้อมเพย์"],
                  ["pay_card_enabled", "บัตร"],
                  ["pay_credit_enabled", "เครดิต (ขายเชื่อ)"],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="font-medium">{label}</div>
                  <Switch
                    checked={(form[key] ?? "1") !== "0"}
                    onCheckedChange={v => set(key, v ? "1" : "0")}
                    aria-label={`เปิด/ปิดช่องทาง ${label}`}
                  />
                </div>
              ))}
              <Button
                disabled={!isAdmin || saveSettings.isPending}
                onClick={saveAll}
              >
                บันทึกช่องทางชำระเงิน {!isAdmin && "(เฉพาะแอดมิน)"}
              </Button>
            </CardContent>
          </Card>
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-heading text-base flex items-center gap-2">
                      <Wallet className="w-4 h-4" /> QR ถุงเงิน (Krungthai
                      Thungngern)
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      สร้าง QR พร้อมเพย์ล็อกยอดให้ลูกค้าสแกน
                      เงินเข้าบัญชีถุงเงินของร้าน
                      และยืนยันอัตโนมัติด้วยการสแกนสลิปผ่าน Slip2Go สำหรับสาขา{" "}
                      {staff?.branch.name ?? "ปัจจุบัน"}
                    </p>
                  </div>
                  <Badge variant="secondary">เฉพาะผู้ดูแลระบบ</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {paymentConfigPending && !paymentConfig ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    กำลังโหลดการตั้งค่าการชำระเงิน…
                  </div>
                ) : paymentConfigError && !paymentConfig ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm text-destructive">
                      โหลดการตั้งค่าการชำระเงินไม่สำเร็จ:{" "}
                      {paymentConfigQueryError?.message}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => void refetchPaymentConfig()}
                    >
                      <RefreshCw className="mr-1.5 h-4 w-4" /> ลองใหม่
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <div className="font-medium">เปิดใช้งาน QR ถุงเงิน</div>
                        <p className="text-xs text-muted-foreground">
                          แสดงช่องทาง "QR ถุงเงิน" ในหน้าขาย (POS)
                        </p>
                      </div>
                      <Switch
                        checked={tngEnabled}
                        onCheckedChange={setTngEnabled}
                        aria-label="เปิดใช้งาน QR ถุงเงิน"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>รูปแบบ QR ที่ให้ลูกค้าสแกน</Label>
                      <RadioGroup
                        value={tngQrMode}
                        onValueChange={value =>
                          setTngQrMode(value as "promptpay" | "merchant")
                        }
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        <label
                          htmlFor="tng-mode-merchant"
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${tngQrMode === "merchant" ? "border-emerald-500 bg-emerald-50/50" : ""}`}
                        >
                          <RadioGroupItem
                            id="tng-mode-merchant"
                            value="merchant"
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium">
                              QR ร้านค้าถุงเงิน (แนะนำ)
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              เงินเข้าบัญชีถุงเงินของร้านโดยตรง ใช้ QR
                              จากแอปถุงเงิน
                            </span>
                          </span>
                        </label>
                        <label
                          htmlFor="tng-mode-promptpay"
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${tngQrMode === "promptpay" ? "border-emerald-500 bg-emerald-50/50" : ""}`}
                        >
                          <RadioGroupItem
                            id="tng-mode-promptpay"
                            value="promptpay"
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium">
                              พร้อมเพย์ส่วนตัว
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              สร้าง QR จากเบอร์โทร/เลขบัตรประชาชน
                              เงินเข้าบัญชีที่ผูกพร้อมเพย์นั้น
                            </span>
                          </span>
                        </label>
                      </RadioGroup>
                    </div>

                    {tngQrMode === "promptpay" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="tng-promptpay-id">
                          PromptPay ID ที่ผูกกับบัญชีถุงเงิน
                        </Label>
                        <Input
                          id="tng-promptpay-id"
                          inputMode="numeric"
                          value={tngPromptpayId}
                          onChange={event =>
                            setTngPromptpayId(event.target.value)
                          }
                          placeholder="เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก"
                        />
                        <p className="text-xs text-muted-foreground">
                          ระบบจะสร้าง QR พร้อมเพย์จาก ID
                          นี้และล็อกยอดเงินของแต่ละบิล
                        </p>
                      </div>
                    )}

                    {tngQrMode === "merchant" && (
                      <div className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-medium">
                            <Store className="h-4 w-4" /> QR ร้านค้าถุงเงิน
                          </div>
                          <Badge
                            variant={
                              paymentConfig?.merchant
                                ? "default"
                                : "destructive"
                            }
                          >
                            {paymentConfig?.merchant
                              ? "ตั้งค่าแล้ว"
                              : "ยังไม่ได้ตั้งค่า"}
                          </Badge>
                        </div>
                        {paymentConfig?.merchant ? (
                          <div className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
                            <div>
                              <div className="text-xs text-muted-foreground">
                                รหัสร้านค้า (Ref 1)
                              </div>
                              <div className="font-mono">
                                {paymentConfig.merchant.ref1}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">
                                ชื่อบัญชี (Ref 2)
                              </div>
                              <div>{paymentConfig.merchant.ref2 || "—"}</div>
                            </div>
                            <div className="sm:col-span-2">
                              <div className="text-xs text-muted-foreground">
                                Biller ID
                              </div>
                              <div className="font-mono">
                                {paymentConfig.merchant.billerId}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            ยังไม่มี QR ร้านค้า — เปิดแอปถุงเงิน ไปที่ QR
                            รับเงินของร้าน แล้วคัดลอก payload
                            (ข้อความยาวขึ้นต้นด้วย 000201...) มาวางด้านล่าง
                          </div>
                        )}
                        <Collapsible
                          open={tngMerchantEditorOpen}
                          onOpenChange={setTngMerchantEditorOpen}
                        >
                          <CollapsibleTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              {tngMerchantEditorOpen
                                ? "ซ่อนช่องเปลี่ยน QR"
                                : paymentConfig?.merchant
                                  ? "เปลี่ยน QR ร้านค้า"
                                  : "วาง QR ร้านค้า"}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-2 space-y-1.5">
                            <Textarea
                              value={tngMerchantPayload}
                              onChange={event =>
                                setTngMerchantPayload(event.target.value)
                              }
                              placeholder="วาง payload QR ร้านค้าจากแอปถุงเงิน (ขึ้นต้นด้วย 000201...)"
                              rows={3}
                              className="font-mono text-xs"
                            />
                            <p className="text-xs text-muted-foreground">
                              เซิร์ฟเวอร์จะตรวจโครงสร้างก่อนบันทึก และใช้
                              payload นี้ฉีดยอดเงินของแต่ละบิลตอนสร้าง QR
                              เว้นว่างเพื่อใช้ของเดิม
                            </p>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    )}

                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium">
                          <KeyRound className="h-4 w-4" /> Slip2Go API Secret
                        </div>
                        <Badge
                          variant={
                            paymentConfig?.apiSecretConfigured
                              ? "default"
                              : "destructive"
                          }
                        >
                          {paymentConfig?.apiSecretConfigured
                            ? "ตั้งค่าแล้ว"
                            : "ยังไม่ได้ตั้งค่า"}
                        </Badge>
                      </div>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={tngApiSecret}
                        onChange={event => setTngApiSecret(event.target.value)}
                        placeholder={
                          paymentConfig?.apiSecretConfigured
                            ? "เว้นว่างเพื่อใช้ Secret เดิม"
                            : "วาง API Secret จาก Slip2Go Dashboard > API Connect"
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        ใช้ตรวจสลิปโอนเงินที่แคชเชียร์สแกนจากลูกค้า ระบบไม่แสดง
                        Secret เดิมกลับมาที่หน้าเว็บ
                        และจะเข้ารหัสก่อนบันทึกลงฐานข้อมูล
                        {paymentConfig?.apiKeySource === "environment"
                          ? " · ขณะนี้ใช้ Secret สำรองจาก .env"
                          : ""}
                        {paymentConfig?.mockMode
                          ? " · โหมดจำลอง (SLIP2GO_MOCK) เปิดอยู่"
                          : ""}
                      </p>
                      {!paymentConfig?.apiSecretConfigured &&
                        !tngApiSecret.trim() && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            ยังไม่มี Slip2Go API Secret — แคชเชียร์ยังกด
                            "ยืนยันเอง" ได้ แต่ระบบจะไม่ตรวจสลิปอัตโนมัติ
                          </div>
                        )}
                      {tngTestResult && (
                        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                          {tngTestResult}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-medium">
                          <BellRing className="h-4 w-4" /> แจ้งเงินเข้าอัตโนมัติ
                          (Webhook)
                        </div>
                        <Badge
                          variant={
                            paymentConfig?.webhookConfigured
                              ? "default"
                              : "secondary"
                          }
                        >
                          {paymentConfig?.webhookConfigured
                            ? "พร้อมใช้งาน"
                            : "ยังไม่ได้สร้าง token"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ใช้คู่กับแอปอ่าน Notification บนมือถือเครื่องที่ล็อกอิน
                        แอปถุงเงิน/ธนาคารของร้าน (เช่น ตังค์เข้า, PayNotify) —
                        เมื่อมีเงินเข้า แอปจะส่งยอดมาที่ URL นี้
                        ระบบจะจับคู่กับบิล QR ที่รออยู่ แล้วแจ้ง
                        &quot;เงินเข้าแล้ว&quot; พร้อมปิดบิลให้อัตโนมัติ
                        (มือถือต้องเข้าถึง URL นี้ผ่านอินเทอร์เน็ตได้)
                      </p>

                      <div className="space-y-1.5">
                        <Label>Webhook URL</Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={webhookUrl}
                            className="font-mono text-xs"
                            onFocus={event => event.target.select()}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => copyText(webhookUrl, " Webhook URL")}
                          >
                            <Copy className="w-3 h-3 mr-1" /> คัดลอก
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Webhook token</Label>
                        {paymentConfig?.webhookToken ? (
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              type={showWebhookToken ? "text" : "password"}
                              value={paymentConfig.webhookToken}
                              className="font-mono text-xs"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              aria-label={
                                showWebhookToken ? "ซ่อน token" : "แสดง token"
                              }
                              onClick={() =>
                                setShowWebhookToken(visible => !visible)
                              }
                            >
                              {showWebhookToken ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              onClick={() =>
                                copyText(
                                  paymentConfig.webhookToken ?? "",
                                  " token"
                                )
                              }
                            >
                              <Copy className="w-3 h-3 mr-1" /> คัดลอก
                            </Button>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            ยังไม่มี token — กด &quot;สร้าง token&quot; แล้วนำ
                            URL และ token ไปตั้งในแอปแจ้งเงินเข้า
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void regenerateWebhookToken()}
                          disabled={savePaymentConfig.isPending}
                        >
                          <RefreshCw className="mr-1.5 h-4 w-4" />
                          {paymentConfig?.webhookConfigured
                            ? "สร้าง token ใหม่"
                            : "สร้าง token"}
                        </Button>
                      </div>

                      <div className="rounded-lg bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
                        {`POST ${webhookUrl}
Authorization: Bearer <token>
Content-Type: application/json

{"amount": 100.00, "text": "เงินเข้า 100.00 บาท", "ref": "รหัสแจ้งเตือนจากแอป (ถ้ามี)"}`}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ยอดเงินต้องตรงกับบิลที่รออยู่พอดี 1 บิล —
                        ถ้ามีบิลยอดเดียวกันค้างอยู่หลายบิล ระบบจะไม่เดาปิดบิลให้
                        ให้สแกนสลิปยืนยันตามเดิม
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        onClick={savePayments}
                        disabled={savePaymentConfig.isPending}
                      >
                        <Save className="mr-1.5 h-4 w-4" />
                        {savePaymentConfig.isPending
                          ? "กำลังบันทึก…"
                          : "บันทึกการตั้งค่าการชำระเงิน"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => testPaymentConnection.mutate()}
                        disabled={
                          testPaymentConnection.isPending ||
                          savePaymentConfig.isPending
                        }
                      >
                        <RefreshCw
                          className={`mr-1.5 h-4 w-4 ${testPaymentConnection.isPending ? "animate-spin" : ""}`}
                        />
                        {testPaymentConnection.isPending
                          ? "กำลังทดสอบ…"
                          : "ทดสอบการเชื่อมต่อ"}
                      </Button>
                      {paymentConfig?.apiKeySource === "settings" && (
                        <Button
                          type="button"
                          variant="outline"
                          className="text-destructive"
                          onClick={clearApiSecret}
                          disabled={savePaymentConfig.isPending}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" /> ลบ API Secret
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {paymentConfig?.settingsSource === "settings"
                          ? "ใช้ค่าที่บันทึกสำหรับสาขานี้"
                          : "ยังใช้ค่าเริ่มต้นจากเซิร์ฟเวอร์"}
                      </span>
                    </div>

                    <div className="flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>
                        Slip2Go API Secret เป็นข้อมูลแบบเขียนอย่างเดียว
                        เก็บเข้ารหัสในตาราง private ฝั่งเซิร์ฟเวอร์เท่านั้น
                        หน้าเว็บและเครื่องลูกข่ายไม่เคยเห็น Secret จริง
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="database" className="mt-0">
          {/* ฐานข้อมูลและ Backup (admin) */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-heading text-base flex items-center gap-2">
                  <Database className="w-4 h-4" /> ฐานข้อมูลและการสำรองข้อมูล
                  (admin)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />{" "}
                        Supabase Backup
                      </div>
                      <Badge variant="secondary">
                        แผน {dbInfo?.supabasePlan ?? "Pro"}
                      </Badge>
                    </div>
                    <p className="text-sm">สำรองอัตโนมัติรายวันโดย Supabase</p>
                    <p className="text-xs text-muted-foreground">
                      กู้คืนย้อนหลังได้{" "}
                      {dbInfo?.supabaseDailyRetentionDays ?? 7} วัน
                    </p>
                    <div className="mt-3 flex items-start gap-2 rounded-md border bg-background/70 p-2.5">
                      {managedBackupHealth?.status === "healthy" ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      )}
                      <div className="min-w-0 text-xs">
                        <p className="font-medium">
                          {managedBackupHealth?.status === "healthy"
                            ? "สถานะปกติ"
                            : managedBackupHealth?.status === "error"
                              ? "ตรวจสถานะไม่สำเร็จ"
                              : managedBackupHealth?.status === "warning"
                                ? "ต้องตรวจสอบ"
                                : "ยังไม่ได้ตรวจยืนยัน"}
                        </p>
                        <p className="text-muted-foreground">
                          {managedBackupHealth?.message ??
                            "กำลังตรวจสอบสถานะ Backup"}
                        </p>
                        {managedBackupHealth?.latestBackupAt && (
                          <p className="mt-1 text-muted-foreground">
                            ล่าสุด{" "}
                            {fmtDateTime(managedBackupHealth.latestBackupAt)}
                          </p>
                        )}
                        {managedBackupHealth?.pitrEnabled && (
                          <Badge variant="outline" className="mt-1.5">
                            PITR เปิดใช้งาน
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium">
                        <Cloud className="h-4 w-4 text-sky-600" /> Private GCS
                      </div>
                      <Badge
                        variant={
                          dbInfo?.offsiteConfigured
                            ? "default"
                            : dbInfo?.offsiteAvailable
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {dbInfo?.offsiteConfigured
                          ? "พร้อมใช้งาน"
                          : dbInfo?.offsiteAvailable
                            ? "ยังไม่ตั้งค่า"
                            : "ไม่ได้ใช้ใน Edge"}
                      </Badge>
                    </div>
                    {dbInfo?.offsiteAvailable !== false ? (
                      <>
                        <p className="text-sm">
                          สำรอง Logical Backup{" "}
                          {dbInfo?.offsiteSchedule ?? "ทุก 6 ชั่วโมง"}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          {dbInfo?.offsiteBucket ||
                            "Private bucket กำลังรอการตั้งค่า"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          เก็บชุดปกติ {dbInfo?.offsiteDailyRetentionDays ?? 35}{" "}
                          วัน · รายเดือน{" "}
                          {dbInfo?.offsiteMonthlyRetentionDays ?? 370} วัน
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Production ใช้ Supabase Managed Backup โดยตรง หากต้องการ
                        Off-site copy ต้องรัน worker ภายนอก Edge runtime
                      </p>
                    )}
                  </div>
                </div>

                {isDesktop && (
                  <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-blue-950 sm:flex-row sm:items-center dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        ไฟล์กู้ภัยบิลออฟไลน์ในเครื่องนี้
                      </p>
                      <p className="text-xs opacity-80">
                        {desktopSyncStatus?.pendingCount
                          ? `มี ${desktopSyncStatus.pendingCount} บิลรอซิงก์ สามารถส่งออกเป็นไฟล์เข้ารหัสก่อนอัปเดตหรือซ่อมระบบ และนำกลับมาใช้ด้วยบัญชี Windows เดิม`
                          : "ไม่มีบิลค้าง สามารถนำเข้าไฟล์กู้ภัยเดิมได้เมื่อจำเป็น"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!desktopSyncStatus?.pendingCount}
                        onClick={() =>
                          void exportRecovery()
                            .then(result => {
                              if (result && !result.canceled) {
                                ok(`บันทึกไฟล์กู้ภัยแล้ว: ${result.fileName}`);
                              }
                            })
                            .catch(error =>
                              fail(
                                error instanceof Error
                                  ? error.message
                                  : String(error)
                              )
                            )
                        }
                      >
                        <Download className="mr-1.5 size-4" /> ส่งออก
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void importRecovery()
                            .then(result => {
                              if (result && !result.canceled) {
                                ok(
                                  result.importedCount > 0
                                    ? `นำเข้า ${result.importedCount} บิลแล้ว ระบบจะซิงก์ให้อัตโนมัติ`
                                    : "ไฟล์นี้ไม่มีบิลใหม่ที่ต้องนำเข้า"
                                );
                              }
                            })
                            .catch(error =>
                              fail(
                                error instanceof Error
                                  ? error.message
                                  : String(error)
                              )
                            )
                        }
                      >
                        <History className="mr-1.5 size-4" /> นำเข้า
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium">
                        <ClipboardCheck className="size-4 text-blue-600" />
                        Restore drill
                      </div>
                      <Badge
                        variant={
                          dbInfo?.lastRestoreDrill?.result === "passed" &&
                          !restoreDrillIsOverdue(
                            dbInfo.lastRestoreDrill.performedAt,
                            dbInfo.restoreDrillCadenceDays
                          )
                            ? "default"
                            : "secondary"
                        }
                      >
                        {dbInfo?.lastRestoreDrill
                          ? restoreDrillIsOverdue(
                              dbInfo.lastRestoreDrill.performedAt,
                              dbInfo.restoreDrillCadenceDays
                            )
                            ? "เกินกำหนด"
                            : dbInfo.lastRestoreDrill.result === "passed"
                              ? "ผ่าน"
                              : "ไม่ผ่าน"
                          : "ยังไม่มีหลักฐาน"}
                      </Badge>
                    </div>
                    {dbInfo?.lastRestoreDrill ? (
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>
                          ซ้อมล่าสุด{" "}
                          {fmtDateTime(dbInfo.lastRestoreDrill.performedAt)}
                        </p>
                        <p>
                          RPO {dbInfo.lastRestoreDrill.rpoMinutes} นาที · RTO{" "}
                          {dbInfo.lastRestoreDrill.rtoMinutes} นาที
                        </p>
                        <p className="break-all">
                          ฐานทดสอบ: {dbInfo.lastRestoreDrill.targetProject}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-amber-700">
                        ควรซ้อมกู้คืนและบันทึกผลอย่างน้อยทุก{" "}
                        {dbInfo?.restoreDrillCadenceDays ?? 90} วัน
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="size-4" />{" "}
                      ขอบเขตข้อมูลที่ต้องสำรองแยก
                    </div>
                    <p className="mt-2 text-xs leading-relaxed">
                      Database Backup ไม่รวมไฟล์จริงใน Supabase Storage
                      และการตั้งค่า Edge Functions, Auth, Realtime หรือ API keys
                      ต้องมีสำเนาและ runbook แยกต่างหาก
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {dbInfo?.offsiteAvailable !== false && (
                    <Button
                      type="button"
                      onClick={() => backupNow.mutate()}
                      disabled={
                        !dbInfo?.offsiteConfigured || backupNow.isPending
                      }
                    >
                      <Database className="mr-1.5 h-4 w-4" />
                      {backupNow.isPending
                        ? "กำลังสำรองข้อมูล..."
                        : "สำรองข้อมูลตอนนี้"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRestoreDrillForm(initialRestoreDrillForm());
                      setRestoreDrillOpen(true);
                    }}
                  >
                    <ClipboardCheck className="mr-1.5 size-4" />
                    บันทึกผลซ้อมกู้คืน
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refetchDbInfo()}
                    disabled={dbInfoFetching}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-4 w-4 ${dbInfoFetching ? "animate-spin" : ""}`}
                    />
                    ตรวจสอบสถานะ
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <a
                      href={
                        dbInfo?.supabaseDashboardUrl ??
                        "https://supabase.com/dashboard"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      เปิด Supabase Backups
                    </a>
                  </Button>
                </div>

                {dbInfo?.backupListError && (
                  <p className="text-sm text-destructive">
                    {dbInfo.backupListError}
                  </p>
                )}

                {dbInfo?.offsiteAvailable !== false && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        ไฟล์สำรองนอกระบบล่าสุด
                      </p>
                      <span className="text-xs text-muted-foreground">
                        ลิงก์ดาวน์โหลดมีอายุ 15 นาที
                      </span>
                    </div>
                    {dbInfo?.backups.length ? (
                      <div className="overflow-x-auto rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>วันที่สำรอง</TableHead>
                              <TableHead>ประเภท</TableHead>
                              <TableHead>ขนาด</TableHead>
                              <TableHead>SHA-256</TableHead>
                              <TableHead className="text-right">
                                จัดการ
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dbInfo.backups.slice(0, 12).map(backup => (
                              <TableRow key={backup.objectName}>
                                <TableCell className="whitespace-nowrap text-sm">
                                  {fmtDateTime(backup.createdAt)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {backupTriggerLabel(backup.trigger)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-sm">
                                  {fmtFileSize(backup.sizeBytes)}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {backup.sha256
                                    ? `${backup.sha256.slice(0, 12)}…`
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        void downloadBackup(backup.objectName)
                                      }
                                      disabled={
                                        downloadingBackup === backup.objectName
                                      }
                                    >
                                      <Download className="mr-1 h-3.5 w-3.5" />
                                      {downloadingBackup === backup.objectName
                                        ? "กำลังเตรียม..."
                                        : "ดาวน์โหลด"}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setRestoreBackupTarget(backup)
                                      }
                                    >
                                      <History className="mr-1 h-3.5 w-3.5" />
                                      Restore
                                    </Button>
                                    {backup.trigger === "manual" ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="text-destructive hover:text-destructive"
                                        title={
                                          dbInfo.offsiteDeleteEnabled
                                            ? "ลบ Manual Backup"
                                            : "ระบบ Cloud ใช้ Supabase Managed Backups"
                                        }
                                        disabled={!dbInfo.offsiteDeleteEnabled}
                                        onClick={() => {
                                          setDeleteBackupTarget(backup);
                                          setDeleteBackupConfirmation("");
                                        }}
                                      >
                                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                                        ลบ
                                      </Button>
                                    ) : (
                                      <span className="self-center whitespace-nowrap px-1 text-xs text-muted-foreground">
                                        ลบตาม Lifecycle
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                        ยังไม่มีไฟล์สำรองนอกระบบ เมื่อระบบพร้อมให้กด
                        “สำรองข้อมูลตอนนี้”
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-xs">
                    {dbInfo?.managedRestoreMessage ??
                      "การกู้คืนต้องทำลงฐานทดสอบก่อนตรวจสอบและสลับการเชื่อมต่อ ห้ามกู้ทับฐาน production โดยตรง"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={restoreDrillOpen}
        onOpenChange={open => {
          if (!recordRestoreDrill.isPending) setRestoreDrillOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-blue-600" />
              บันทึกผลซ้อมกู้คืนฐานข้อมูล
            </DialogTitle>
            <DialogDescription>
              บันทึกเฉพาะการกู้คืนลง Supabase project ทดสอบ
              ห้ามใช้ขั้นตอนนี้กู้ทับ production โดยตรง
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="restore-drill-at">วันเวลาที่ซ้อม</Label>
              <Input
                id="restore-drill-at"
                type="datetime-local"
                value={restoreDrillForm.performedAt}
                max={dateTimeLocalValue()}
                disabled={recordRestoreDrill.isPending}
                onChange={event =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    performedAt: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>ผลการซ้อม</Label>
              <Select
                value={restoreDrillForm.result}
                disabled={recordRestoreDrill.isPending}
                onValueChange={value =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    result: value as "passed" | "failed",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="passed">ผ่าน</SelectItem>
                  <SelectItem value="failed">ไม่ผ่าน</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restore-drill-rpo">RPO จริง (นาที)</Label>
              <Input
                id="restore-drill-rpo"
                type="number"
                min="0"
                max="10080"
                value={restoreDrillForm.rpoMinutes}
                disabled={recordRestoreDrill.isPending}
                onChange={event =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    rpoMinutes: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restore-drill-rto">RTO จริง (นาที)</Label>
              <Input
                id="restore-drill-rto"
                type="number"
                min="1"
                max="10080"
                value={restoreDrillForm.rtoMinutes}
                disabled={recordRestoreDrill.isPending}
                onChange={event =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    rtoMinutes: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="restore-drill-project">
                Supabase project ทดสอบ
              </Label>
              <Input
                id="restore-drill-project"
                value={restoreDrillForm.targetProject}
                placeholder="เช่น restore-drill-20260808"
                disabled={recordRestoreDrill.isPending}
                onChange={event =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    targetProject: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="restore-drill-backup">Backup/Restore point</Label>
              <Input
                id="restore-drill-backup"
                value={restoreDrillForm.backupReference}
                placeholder="วันที่ เวลา หรือรหัส Backup ที่ใช้"
                disabled={recordRestoreDrill.isPending}
                onChange={event =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    backupReference: event.target.value,
                  }))
                }
              />
            </div>

            <fieldset className="space-y-2 rounded-lg border p-3 sm:col-span-2">
              <legend className="px-1 text-sm font-medium">
                ผลตรวจความถูกต้องหลัง Restore
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {RESTORE_DRILL_CHECKS.map(item => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={restoreDrillForm.checks[item.key]}
                      disabled={recordRestoreDrill.isPending}
                      onCheckedChange={checked =>
                        setRestoreDrillForm(current => ({
                          ...current,
                          checks: {
                            ...current.checks,
                            [item.key]: checked === true,
                          },
                        }))
                      }
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              {restoreDrillForm.result === "passed" &&
                !Object.values(restoreDrillForm.checks).every(Boolean) && (
                  <p className="text-xs text-amber-700">
                    ผล “ผ่าน” ต้องตรวจครบทุกข้อ
                  </p>
                )}
            </fieldset>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="restore-drill-notes">หมายเหตุ</Label>
              <Textarea
                id="restore-drill-notes"
                value={restoreDrillForm.notes}
                maxLength={1000}
                placeholder="ปัญหาที่พบ ผลตรวจตัวอย่าง หรือขั้นตอนที่ต้องแก้ไข"
                disabled={recordRestoreDrill.isPending}
                onChange={event =>
                  setRestoreDrillForm(current => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={recordRestoreDrill.isPending}
              onClick={() => setRestoreDrillOpen(false)}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              disabled={
                recordRestoreDrill.isPending ||
                !restoreDrillForm.performedAt ||
                !restoreDrillForm.targetProject.trim() ||
                !restoreDrillForm.backupReference.trim() ||
                !Number.isFinite(Number(restoreDrillForm.rpoMinutes)) ||
                Number(restoreDrillForm.rpoMinutes) < 0 ||
                !Number.isFinite(Number(restoreDrillForm.rtoMinutes)) ||
                Number(restoreDrillForm.rtoMinutes) < 1 ||
                (restoreDrillForm.result === "passed" &&
                  !Object.values(restoreDrillForm.checks).every(Boolean))
              }
              onClick={() =>
                recordRestoreDrill.mutate({
                  performedAt: new Date(
                    restoreDrillForm.performedAt
                  ).toISOString(),
                  result: restoreDrillForm.result,
                  rpoMinutes: Number(restoreDrillForm.rpoMinutes),
                  rtoMinutes: Number(restoreDrillForm.rtoMinutes),
                  targetProject: restoreDrillForm.targetProject,
                  backupReference: restoreDrillForm.backupReference,
                  notes: restoreDrillForm.notes,
                  checks: restoreDrillForm.checks,
                })
              }
            >
              <Save className="mr-1.5 size-4" />
              {recordRestoreDrill.isPending ? "กำลังบันทึก..." : "บันทึกผล"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore ทำได้ผ่านฐานทดสอบเท่านั้น */}
      <Dialog
        open={!!restoreBackupTarget}
        onOpenChange={open => !open && setRestoreBackupTarget(null)}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-2xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Database className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Backup restore
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  Restore ลง Supabase โปรเจกต์ทดสอบ
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  กู้คืนไฟล์สำรองลงโปรเจกต์ทดสอบอย่างปลอดภัย โดยไม่แตะฐาน
                  production
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {restoreBackupTarget && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ขั้นตอนการกู้คืนอย่างปลอดภัย
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ตรวจสอบไฟล์และทำตามลำดับก่อนสลับการเชื่อมต่อ
                    </p>
                  </div>
                </div>
                <div className="space-y-4 p-4 text-sm">
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    ระบบจะไม่กู้ไฟล์นี้ทับ production โดยตรง
                    ต้องตรวจข้อมูลบนโปรเจกต์ทดสอบก่อนทุกครั้ง
                  </div>
                  <div className="space-y-1 rounded-lg border p-3">
                    <p className="font-medium">ไฟล์ที่เลือก</p>
                    <p className="break-all font-mono text-xs">
                      {restoreBackupTarget.fileName}
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      SHA-256: {restoreBackupTarget.sha256 || "ไม่ระบุ"}
                    </p>
                  </div>
                  <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                    <li>ดาวน์โหลดไฟล์และตรวจ SHA-256 ให้ตรงกับรายการ</li>
                    <li>
                      สร้าง Supabase โปรเจกต์ทดสอบ หรือใช้
                      Restore-to-New-Project จาก Supabase Backup
                    </li>
                    <li>
                      กู้ไฟล์นี้ด้วย <code>pg_restore</code> ไปยัง Session
                      pooler ของโปรเจกต์ทดสอบเท่านั้น
                    </li>
                    <li>
                      ทดสอบ Login, Dashboard, เปิดกะ, การขาย และรายงาน
                      ก่อนวางแผนสลับ DATABASE_URL
                    </li>
                  </ol>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:justify-between sm:px-5 sm:pb-3.5">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  restoreBackupTarget &&
                  void downloadBackup(restoreBackupTarget.objectName)
                }
                disabled={
                  !restoreBackupTarget ||
                  downloadingBackup === restoreBackupTarget.objectName
                }
              >
                <Download className="mr-1.5 h-4 w-4" /> ดาวน์โหลดไฟล์นี้
              </Button>
              <Button asChild type="button" variant="outline">
                <a
                  href={
                    dbInfo?.supabaseRestoreToNewProjectUrl ??
                    "https://supabase.com/dashboard"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  เปิด Restore-to-New-Project
                </a>
              </Button>
            </div>
            <Button type="button" onClick={() => setRestoreBackupTarget(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete เปิดเฉพาะ Manual Backup และต้องพิมพ์ชื่อไฟล์ยืนยัน */}
      <Dialog
        open={!!deleteBackupTarget}
        onOpenChange={open => {
          if (!open && !deleteBackup.isPending) {
            setDeleteBackupTarget(null);
            setDeleteBackupConfirmation("");
          }
        }}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Trash2 className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Delete backup
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  ยืนยันลบ Manual Backup
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  ลบไฟล์ dump และ manifest ออกจาก Private GCS อย่างถาวร
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {deleteBackupTarget && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ยืนยันการลบไฟล์สำรอง
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      พิมพ์ชื่อไฟล์ให้ตรงเพื่อปลดล็อกปุ่มลบ
                    </p>
                  </div>
                </div>
                <div className="space-y-4 p-4 text-sm">
                  <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <p>
                      ระบบจะลบทั้งไฟล์ dump และ manifest จาก Private GCS
                      โดยไฟล์ยังอยู่ใน GCS Soft Delete ตามระยะเวลาที่ bucket
                      กำหนด
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="backup-delete-confirmation"
                      className="text-xs font-semibold text-slate-700"
                    >
                      พิมพ์ชื่อไฟล์ต่อไปนี้เพื่อยืนยัน
                    </Label>
                    <p className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                      {deleteBackupTarget.fileName}
                    </p>
                    <Input
                      id="backup-delete-confirmation"
                      autoComplete="off"
                      className="bg-white"
                      value={deleteBackupConfirmation}
                      onChange={event =>
                        setDeleteBackupConfirmation(event.target.value)
                      }
                      placeholder={deleteBackupTarget.fileName}
                      disabled={deleteBackup.isPending}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              type="button"
              variant="outline"
              disabled={deleteBackup.isPending}
              onClick={() => {
                setDeleteBackupTarget(null);
                setDeleteBackupConfirmation("");
              }}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                !deleteBackupTarget ||
                deleteBackup.isPending ||
                deleteBackupConfirmation !== deleteBackupTarget.fileName
              }
              onClick={() => {
                if (!deleteBackupTarget) return;
                deleteBackup.mutate({
                  fileName: deleteBackupTarget.objectName,
                  confirmation: deleteBackupConfirmation,
                });
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {deleteBackup.isPending ? "กำลังลบ..." : "ลบไฟล์สำรอง"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog สินค้า */}
      <Dialog
        open={!!editP}
        onOpenChange={open => {
          if (!open) {
            saveProduct.reset();
            createProduct.reset();
            setErr("");
            setEditP(null);
            setInitialEditP(null);
          }
        }}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Fuel className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Product
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {editP?.id ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  กำหนดรหัส หมวด ราคา และสต๊อกของสินค้า
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editP && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Fuel className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลสินค้า
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      รหัส ชื่อ หมวดสินค้า และหน่วยนับ
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      รหัสสินค้า
                    </Label>
                    <Input
                      className="bg-white"
                      value={editP.code}
                      disabled={!!editP.id}
                      onChange={e =>
                        setEditP({ ...editP, code: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อสินค้า
                    </Label>
                    <Input
                      className="bg-white"
                      value={editP.name}
                      onChange={e =>
                        setEditP({ ...editP, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      หมวด
                    </Label>
                    <Select
                      value={editP.category}
                      onValueChange={v =>
                        setEditP({
                          ...editP,
                          category: v as typeof editP.category,
                        })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fuel">น้ำมัน</SelectItem>
                        <SelectItem value="lubricant">
                          2T/น้ำมันเครื่อง
                        </SelectItem>
                        <SelectItem value="other">สินค้าอื่นๆ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      หน่วย
                    </Label>
                    <Input
                      className="bg-white"
                      value={editP.unit}
                      onChange={e =>
                        setEditP({ ...editP, unit: e.target.value })
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Gauge className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ราคาและสต๊อก
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ราคาขาย ต้นทุน และจุดแจ้งเตือนสต๊อก
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ราคาขาย
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="bg-white"
                      value={editP.price || ""}
                      onChange={e =>
                        setEditP({
                          ...editP,
                          price: Number(e.target.value) || 0,
                        })
                      }
                    />
                    {editP.id != null &&
                      editP.category === "fuel" &&
                      currentShift?.readings.some(
                        reading => reading.product?.id === editP.id
                      ) && (
                        <p className="text-xs text-amber-700">
                          ราคาใหม่จะมีผลทันที
                          หลังเปลี่ยนราคาระหว่างกะให้ยึดมิเตอร์ P
                          เป็นยอดเงินจริงตอนปิดกะ
                        </p>
                      )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ต้นทุน
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="bg-white"
                      value={editP.cost || ""}
                      onChange={e =>
                        setEditP({
                          ...editP,
                          cost: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  {editP.category !== "fuel" && (
                    <>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-700">
                          สต๊อก
                        </Label>
                        <Input
                          type="number"
                          className="bg-white"
                          value={editP.stockQty || ""}
                          onChange={e =>
                            setEditP({
                              ...editP,
                              stockQty: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-700">
                          แจ้งเตือนเมื่อต่ำกว่า
                        </Label>
                        <Input
                          type="number"
                          className="bg-white"
                          value={editP.lowStockAt || ""}
                          onChange={e =>
                            setEditP({
                              ...editP,
                              lowStockAt: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    </>
                  )}
                  {editP.id && (
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <Label className="text-xs font-semibold text-slate-700">
                        สถานะ:
                      </Label>
                      <Button
                        size="sm"
                        variant={editP.active ? "outline" : "default"}
                        onClick={() =>
                          setEditP({ ...editP, active: !editP.active })
                        }
                      >
                        {editP.active ? "ปิดการขาย" : "เปิดการขาย"}
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
          {(saveProduct.error || createProduct.error) && (
            <div className="mx-4 mb-4 flex shrink-0 gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:mx-5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{(saveProduct.error || createProduct.error)?.message}</p>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                !editP?.name ||
                !editP?.code ||
                saveProduct.isPending ||
                createProduct.isPending
              }
              onClick={() => {
                if (!editP) return;
                if (editP.id) {
                  if (!initialEditP) return;
                  const patch = createProductUpdatePatch(
                    editP as EditableProductValues,
                    initialEditP
                  );
                  if (Object.keys(patch).length === 1) {
                    setEditP(null);
                    setInitialEditP(null);
                    ok("ไม่มีการเปลี่ยนแปลง");
                    return;
                  }
                  saveProduct.mutate(patch);
                } else {
                  createProduct.mutate({
                    code: editP.code,
                    name: editP.name,
                    category: editP.category,
                    unit: editP.unit,
                    price: editP.price,
                    cost: editP.cost,
                    stockQty: editP.stockQty,
                    lowStockAt: editP.lowStockAt,
                  });
                }
              }}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ประวัติเปลี่ยนราคา */}
      <Dialog open={!!histP} onOpenChange={o => !o && setHistP(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <History className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Price history
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  ประวัติเปลี่ยนราคา — {histP?.name}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  รายการปรับราคาย้อนหลังทั้งหมดของสินค้านี้
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <History className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    ประวัติการเปลี่ยนราคา
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    บันทึกทุกครั้งที่มีการปรับราคาขาย
                  </p>
                </div>
              </div>
              <div className="p-4">
                {(priceHist ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    ยังไม่มีการเปลี่ยนราคา
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>วันที่เวลา</TableHead>
                          <TableHead className="text-right">ราคาเดิม</TableHead>
                          <TableHead className="text-right">ราคาใหม่</TableHead>
                          <TableHead>ผู้เปลี่ยน</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(priceHist ?? []).map(h => (
                          <TableRow key={h.id}>
                            <TableCell className="text-sm">
                              {fmtDateTime(h.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              ฿{fmtMoney(h.oldPrice)}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-primary">
                              ฿{fmtMoney(h.newPrice)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {h.changedBy || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog กลุ่มสิทธิ์ */}
      <Dialog
        open={!!editAccessGroup}
        onOpenChange={open => !open && setEditAccessGroup(null)}
      >
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-3xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Access group
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {editAccessGroup?.id
                    ? "แก้ไขกลุ่มสิทธิ์"
                    : "เพิ่มกลุ่มสิทธิ์"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  สมาชิกทุกคนในกลุ่มจะเห็นและเข้าใช้งานเฉพาะเมนูที่เปิดไว้
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editAccessGroup && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <UsersRound className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลกลุ่มสิทธิ์
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อ ระดับผู้ใช้ และรายละเอียดของกลุ่ม
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อกลุ่ม
                    </Label>
                    <Input
                      className="bg-white"
                      value={editAccessGroup.name}
                      onChange={event =>
                        setEditAccessGroup({
                          ...editAccessGroup,
                          name: event.target.value,
                        })
                      }
                      placeholder="เช่น พนักงานหน้าลาน"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ระดับผู้ใช้ของกลุ่ม
                    </Label>
                    <Select
                      value={editAccessGroup.role}
                      disabled={Boolean(editAccessGroup.id)}
                      onValueChange={value =>
                        setEditAccessGroup({
                          ...editAccessGroup,
                          role: value as "manager" | "cashier",
                          menuPermissions: getRoleMenuPermissions(
                            value as "manager" | "cashier"
                          ),
                        })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cashier">พนักงานขาย</SelectItem>
                        <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      รายละเอียด
                    </Label>
                    <Input
                      className="bg-white"
                      value={editAccessGroup.description}
                      onChange={event =>
                        setEditAccessGroup({
                          ...editAccessGroup,
                          description: event.target.value,
                        })
                      }
                      placeholder="อธิบายหน้าที่หรือขอบเขตของกลุ่ม"
                    />
                  </div>
                </div>
              </section>
              <MenuPermissionEditor
                role={editAccessGroup.role}
                value={editAccessGroup.menuPermissions}
                onChange={menuPermissions =>
                  setEditAccessGroup({ ...editAccessGroup, menuPermissions })
                }
              />
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                !editAccessGroup?.name.trim() ||
                editAccessGroup.menuPermissions.length === 0 ||
                createAccessGroup.isPending ||
                updateAccessGroup.isPending
              }
              onClick={() => {
                if (!editAccessGroup) return;
                if (editAccessGroup.id) {
                  updateAccessGroup.mutate({
                    id: editAccessGroup.id,
                    name: editAccessGroup.name,
                    description: editAccessGroup.description,
                    menuPermissions: editAccessGroup.menuPermissions,
                  });
                } else {
                  createAccessGroup.mutate({
                    name: editAccessGroup.name,
                    description: editAccessGroup.description,
                    role: editAccessGroup.role,
                    menuPermissions: editAccessGroup.menuPermissions,
                  });
                }
              }}
            >
              {editAccessGroup?.id ? "บันทึกกลุ่มสิทธิ์" : "เพิ่มกลุ่มสิทธิ์"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog พนักงาน */}
      <Dialog open={showBranch} onOpenChange={setShowBranch}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Store className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    New branch
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  เพิ่มสาขา
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  ระบบจะสร้างพื้นที่ข้อมูลแยก และเริ่มเลขเอกสารของสาขาใหม่จาก 1
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Store className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    ข้อมูลสาขา
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    รหัส ชื่อ ที่อยู่ และข้อมูลติดต่อ
                  </p>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    รหัสสาขา
                  </Label>
                  <Input
                    className="bg-white"
                    value={newBranch.code}
                    onChange={event =>
                      setNewBranch({
                        ...newBranch,
                        code: event.target.value.toUpperCase(),
                      })
                    }
                    placeholder="เช่น BKK01"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    ชื่อสาขา
                  </Label>
                  <Input
                    className="bg-white"
                    value={newBranch.name}
                    onChange={event =>
                      setNewBranch({ ...newBranch, name: event.target.value })
                    }
                    placeholder="เช่น สาขากรุงเทพ"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    ที่อยู่
                  </Label>
                  <Textarea
                    className="bg-white"
                    value={newBranch.address}
                    onChange={event =>
                      setNewBranch({
                        ...newBranch,
                        address: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    โทรศัพท์
                  </Label>
                  <Input
                    className="bg-white"
                    value={newBranch.phone}
                    onChange={event =>
                      setNewBranch({ ...newBranch, phone: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    เลขประจำตัวผู้เสียภาษี
                  </Label>
                  <Input
                    className="bg-white"
                    value={newBranch.taxId}
                    onChange={event =>
                      setNewBranch({ ...newBranch, taxId: event.target.value })
                    }
                  />
                </div>
                <label className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-3 sm:col-span-2">
                  <div>
                    <div className="text-sm font-medium">
                      คัดลอกโครงสร้างจากสาขาปัจจุบัน
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      คัดลอกสินค้า หัวจ่าย ถัง รางวัล และกะงาน
                      แต่เริ่มสต็อก/มิเตอร์ที่ศูนย์
                    </div>
                  </div>
                  <Switch
                    checked={newBranch.cloneCurrentSetup}
                    onCheckedChange={cloneCurrentSetup =>
                      setNewBranch({ ...newBranch, cloneCurrentSetup })
                    }
                  />
                </label>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                newBranch.code.trim().length < 2 ||
                !newBranch.name.trim() ||
                createBranch.isPending
              }
              onClick={() => createBranch.mutate(newBranch)}
            >
              {createBranch.isPending ? "กำลังสร้างสาขา..." : "สร้างสาขา"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStaff} onOpenChange={setShowStaff}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-3xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <UsersRound className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    New staff
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  เพิ่มพนักงาน
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  กรอกข้อมูลบัญชีและเลือกเมนูที่พนักงานคนนี้สามารถใช้งานได้
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <UserCog className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    ข้อมูลบัญชีพนักงาน
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ชื่อ ชื่อผู้ใช้ รหัสผ่าน และระดับสิทธิ์
                  </p>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    ชื่อ-นามสกุล
                  </Label>
                  <Input
                    className="bg-white"
                    value={newStaff.name}
                    onChange={e =>
                      setNewStaff({ ...newStaff, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    ชื่อผู้ใช้
                  </Label>
                  <Input
                    className="bg-white"
                    value={newStaff.username}
                    onChange={e =>
                      setNewStaff({ ...newStaff, username: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    รหัสผ่าน Supabase Auth (อย่างน้อย 10 ตัว)
                  </Label>
                  <Input
                    type="password"
                    className="bg-white"
                    value={newStaff.password}
                    onChange={e =>
                      setNewStaff({ ...newStaff, password: e.target.value })
                    }
                    aria-invalid={
                      newStaff.password.length > 0 &&
                      staffPasswordValidationMessage(newStaff.password) !== null
                    }
                  />
                  {newStaff.password.length > 0 &&
                    staffPasswordValidationMessage(newStaff.password) && (
                      <p className="text-xs font-medium text-destructive">
                        {staffPasswordValidationMessage(newStaff.password)}
                      </p>
                    )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    สิทธิ์
                  </Label>
                  <Select
                    value={newStaff.role}
                    onValueChange={v =>
                      setNewStaff({
                        ...newStaff,
                        role: v as "admin" | "manager" | "cashier",
                        accessGroupId: null,
                        menuPermissions: getRoleMenuPermissions(v as StaffRole),
                      })
                    }
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cashier">พนักงานขาย</SelectItem>
                      <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                      <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
            <StaffBranchSelector
              branches={(allBranches ?? []).filter(branch => branch.active)}
              value={newStaff.branchIds}
              onChange={branchIds => setNewStaff({ ...newStaff, branchIds })}
            />
            <StaffAccessSelector
              role={newStaff.role}
              accessGroupId={newStaff.accessGroupId}
              menuPermissions={newStaff.menuPermissions}
              groups={accessGroups ?? []}
              onGroupChange={accessGroupId =>
                setNewStaff({ ...newStaff, accessGroupId })
              }
              onPermissionsChange={menuPermissions =>
                setNewStaff({ ...newStaff, menuPermissions })
              }
            />
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                !newStaff.name ||
                newStaff.username.length < 3 ||
                staffPasswordValidationMessage(newStaff.password) !== null ||
                newStaff.branchIds.length === 0 ||
                (newStaff.role !== "admin" &&
                  newStaff.accessGroupId === null &&
                  newStaff.menuPermissions.length === 0) ||
                createStaff.isPending
              }
              onClick={() => createStaff.mutate(newStaff)}
            >
              เพิ่มพนักงาน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขพนักงาน */}
      <Dialog open={!!editS} onOpenChange={o => !o && setEditS(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-3xl sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <UserCog className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Edit staff
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  แก้ไขพนักงาน
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  แก้ไขข้อมูลบัญชีและกำหนดสิทธิ์เมนูสำหรับพนักงานคนนี้
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editS && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <UserCog className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลบัญชีพนักงาน
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อ ชื่อผู้ใช้ รหัสผ่าน และระดับสิทธิ์
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อ-นามสกุล
                    </Label>
                    <Input
                      className="bg-white"
                      value={editS.name}
                      onChange={e =>
                        setEditS({ ...editS, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อผู้ใช้
                    </Label>
                    <Input
                      className="bg-white"
                      value={editS.username}
                      onChange={e =>
                        setEditS({ ...editS, username: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)
                    </Label>
                    <Input
                      type="password"
                      className="bg-white"
                      value={editS.password}
                      onChange={e =>
                        setEditS({ ...editS, password: e.target.value })
                      }
                      placeholder="อย่างน้อย 10 ตัวอักษร"
                      aria-invalid={
                        editS.password.length > 0 &&
                        staffPasswordValidationMessage(editS.password) !== null
                      }
                    />
                    {editS.password.length > 0 &&
                      staffPasswordValidationMessage(editS.password) && (
                        <p className="text-xs font-medium text-destructive">
                          {staffPasswordValidationMessage(editS.password)}
                        </p>
                      )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      สิทธิ์
                    </Label>
                    <Select
                      value={editS.role}
                      onValueChange={v =>
                        setEditS({
                          ...editS,
                          role: v as "admin" | "manager" | "cashier",
                          accessGroupId: null,
                          menuPermissions: getRoleMenuPermissions(
                            v as StaffRole
                          ),
                        })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cashier">พนักงานขาย</SelectItem>
                        <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                        <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
              <StaffBranchSelector
                branches={(allBranches ?? []).filter(branch => branch.active)}
                value={editS.branchIds}
                onChange={branchIds => setEditS({ ...editS, branchIds })}
              />
              <StaffAccessSelector
                role={editS.role}
                accessGroupId={editS.accessGroupId}
                menuPermissions={editS.menuPermissions}
                groups={accessGroups ?? []}
                onGroupChange={accessGroupId =>
                  setEditS({ ...editS, accessGroupId })
                }
                onPermissionsChange={menuPermissions =>
                  setEditS({ ...editS, menuPermissions })
                }
              />
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                !editS?.name ||
                editS.branchIds.length === 0 ||
                (editS.password.length > 0 &&
                  staffPasswordValidationMessage(editS.password) !== null) ||
                (editS.role !== "admin" &&
                  editS.accessGroupId === null &&
                  editS.menuPermissions.length === 0) ||
                updateStaff.isPending
              }
              onClick={() =>
                editS &&
                updateStaff.mutate({
                  id: editS.id,
                  name: editS.name,
                  username: editS.username,
                  role: editS.role,
                  accessGroupId: editS.accessGroupId,
                  menuPermissions: editS.menuPermissions,
                  branchIds: editS.branchIds,
                  ...(editS.password ? { password: editS.password } : {}),
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog เพิ่ม/แก้ไขตู้จ่าย */}
      <Dialog open={!!editPump} onOpenChange={o => !o && setEditPump(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editPump?.id ? "แก้ไขตู้จ่าย" : "เพิ่มตู้จ่าย"}
            </DialogTitle>
            <DialogDescription>
              ตั้งชื่อที่พนักงานเห็นในหน้ากะ เช่น “ตู้จ่าย 1”
            </DialogDescription>
          </DialogHeader>
          {editPump && (
            <div className="space-y-2 py-2">
              <Label htmlFor="pump-name">ชื่อตู้จ่าย</Label>
              <Input
                id="pump-name"
                autoFocus
                maxLength={100}
                placeholder="เช่น ตู้จ่าย 1"
                value={editPump.name}
                onChange={e =>
                  setEditPump({ ...editPump, name: e.target.value })
                }
                onKeyDown={e => {
                  if (e.key !== "Enter" || !editPump.name.trim()) return;
                  if (editPump.id) {
                    updatePump.mutate({
                      id: editPump.id,
                      name: editPump.name.trim(),
                    });
                  } else {
                    createPump.mutate({ name: editPump.name.trim() });
                  }
                }}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full sm:w-auto"
              disabled={
                !editPump?.name.trim() ||
                createPump.isPending ||
                updatePump.isPending
              }
              onClick={() => {
                if (!editPump) return;
                if (editPump.id) {
                  updatePump.mutate({
                    id: editPump.id,
                    name: editPump.name.trim(),
                  });
                } else {
                  createPump.mutate({ name: editPump.name.trim() });
                }
              }}
            >
              {editPump?.id ? "บันทึก" : "เพิ่มตู้จ่าย"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog เพิ่ม/แก้ไขหัวจ่าย */}
      <Dialog open={!!editN} onOpenChange={o => !o && setEditN(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Gauge className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Nozzle
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {editN?.id ? "แก้ไขหัวจ่าย" : "เพิ่มหัวจ่าย"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  กำหนดตู้จ่าย ชนิดน้ำมัน ถังที่ตัดสต๊อก และค่ามิเตอร์สะสม
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editN && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Fuel className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลหัวจ่าย
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อ ชนิดน้ำมัน ถังน้ำมัน และมิเตอร์
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ตู้จ่าย
                    </Label>
                    <Select
                      value={String(editN.pumpId)}
                      onValueChange={v =>
                        setEditN({ ...editN, pumpId: Number(v) })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="เลือกตู้จ่าย" />
                      </SelectTrigger>
                      <SelectContent>
                        {(pumps ?? []).map(pump => (
                          <SelectItem key={pump.id} value={String(pump.id)}>
                            {pump.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อหัวจ่าย
                    </Label>
                    <Input
                      className="bg-white"
                      value={editN.label}
                      onChange={e =>
                        setEditN({ ...editN, label: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชนิดน้ำมันที่จ่าย
                    </Label>
                    <Select
                      value={
                        editN.productId > 0
                          ? String(editN.productId)
                          : undefined
                      }
                      onValueChange={v => {
                        const productId = Number(v);
                        const firstTank = (tanks ?? []).find(
                          tank => tank.productId === productId
                        );
                        setEditN({
                          ...editN,
                          productId,
                          tankId: firstTank?.id ?? null,
                        });
                      }}
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="เลือกชนิดน้ำมัน" />
                      </SelectTrigger>
                      <SelectContent>
                        {(products ?? [])
                          .filter(p => p.category === "fuel" && p.active)
                          .map(p => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.name} ({p.code})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      ถังน้ำมันที่ตัดสต๊อก
                    </Label>
                    <Select
                      value={
                        editN.tankId != null ? String(editN.tankId) : undefined
                      }
                      onValueChange={v =>
                        setEditN({ ...editN, tankId: Number(v) })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue placeholder="เลือกถังน้ำมัน" />
                      </SelectTrigger>
                      <SelectContent>
                        {(tanks ?? [])
                          .filter(tank => tank.productId === editN.productId)
                          .map(tank => (
                            <SelectItem key={tank.id} value={String(tank.id)}>
                              {tank.name} (คงเหลือ {fmtNum(tank.currentLiters)}{" "}
                              ลิตร)
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {(tanks ?? []).filter(
                      tank => tank.productId === editN.productId
                    ).length === 0 && (
                      <p className="text-xs text-destructive">
                        ยังไม่มีถังสำหรับน้ำมันชนิดนี้ กรุณาเพิ่มถังในหน้า
                        “สต๊อก” ก่อน
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      มิเตอร์ P ปัจจุบัน (บาทสะสม)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="bg-white"
                      value={editN.money}
                      onChange={e =>
                        setEditN({
                          ...editN,
                          money: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      มิเตอร์ L ปัจจุบัน (ลิตรสะสม)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="bg-white"
                      value={editN.meter}
                      onChange={e =>
                        setEditN({
                          ...editN,
                          meter: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <p className="text-xs text-amber-600 sm:col-span-2">
                    ⚠️ แก้มิเตอร์เฉพาะกรณีค่าในระบบไม่ตรงกับหน้าตู้จ่ายจริง
                  </p>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                !editN?.label.trim() ||
                !editN.pumpId ||
                !editN.productId ||
                editN.tankId == null ||
                createNozzle.isPending ||
                updateNozzle.isPending
              }
              onClick={() => {
                if (!editN || editN.tankId == null) return;
                if (editN.id) {
                  updateNozzle.mutate({
                    id: editN.id,
                    pumpId: editN.pumpId,
                    label: editN.label.trim(),
                    productId: editN.productId,
                    tankId: editN.tankId,
                    meter: editN.meter,
                    money: editN.money,
                  });
                } else {
                  createNozzle.mutate({
                    pumpId: editN.pumpId,
                    label: editN.label.trim(),
                    productId: editN.productId,
                    tankId: editN.tankId,
                    meter: editN.meter,
                    money: editN.money,
                  });
                }
              }}
            >
              {editN?.id ? "บันทึก" : "เพิ่มหัวจ่าย"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ของรางวัล */}
      <Dialog open={!!editR} onOpenChange={o => !o && setEditR(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Gift className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Reward
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {editR?.id ? "แก้ไขของรางวัล" : "เพิ่มของรางวัล"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  กำหนดแต้มที่ใช้แลกและจำนวนคงเหลือของของรางวัล
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editR && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Gift className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      รายละเอียดของรางวัล
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อ แต้มที่ใช้แลก และสต๊อกคงเหลือ
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อของรางวัล
                    </Label>
                    <Input
                      className="bg-white"
                      value={editR.name}
                      onChange={e =>
                        setEditR({ ...editR, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      แต้มที่ใช้แลก
                    </Label>
                    <Input
                      type="number"
                      className="bg-white"
                      value={editR.pointsRequired || ""}
                      onChange={e =>
                        setEditR({
                          ...editR,
                          pointsRequired: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-700">
                      จำนวนคงเหลือ
                    </Label>
                    <Input
                      type="number"
                      className="bg-white"
                      value={editR.stock || ""}
                      onChange={e =>
                        setEditR({
                          ...editR,
                          stock: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={!editR?.name || saveReward.isPending}
              onClick={() =>
                editR && saveReward.mutate({ ...editR, active: true })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
